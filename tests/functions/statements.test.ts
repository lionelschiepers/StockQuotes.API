import { statementsHandler } from '../../src/functions/statements';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import type { AlphaVantageService } from '../../src/services/alphaVantageService';
import type { CacheService } from '../../src/services/cacheService';
import { apiRateLimiter } from '../../src/services/rateLimiter';

// Mock the dependencies
jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockApiRateLimiter = apiRateLimiter as unknown as { isAllowed: jest.Mock };

describe('statementsHandler', () => {
  let mockContext: InvocationContext;
  let mockAlphaVantageService: jest.Mocked<AlphaVantageService>;
  let mockCacheService: jest.Mocked<CacheService>;

  const mockRequest = (query: Record<string, string>, headers: Record<string, string> = {}): HttpRequest => {
    return {
      query: {
        get: (key: string) => query[key] || null,
      },
      headers: {
        get: (key: string) => headers[key] || null,
      },
    } as unknown as HttpRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as InvocationContext;

    mockAlphaVantageService = {
      getFinancialStatements: jest.fn(),
      validateTicker: jest.fn(),
    } as unknown as jest.Mocked<AlphaVantageService>;

    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn(),
      has: jest.fn(),
      isExpired: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;

    mockGetServiceContainer.mockReturnValue({
      alphaVantageService: mockAlphaVantageService,
      cacheService: mockCacheService,
    });

    mockApiRateLimiter.isAllowed.mockReturnValue({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 60000,
    });
  });

  describe('successful requests', () => {
    const mockFinancialStatements = {
      symbol: 'IBM',
      annualReports: [
        {
          fiscalDateEnding: '2023-12-31',
          incomeStatement: { fiscalDateEnding: '2023-12-31', totalRevenue: '1000000' },
          balanceSheet: { fiscalDateEnding: '2023-12-31', totalAssets: '5000000' },
          cashFlow: { fiscalDateEnding: '2023-12-31', operatingCashflow: '150000' },
          ratio: { fiscalDateEnding: '2023-12-31', reportedEPS: '9.61' },
        },
      ],
      quarterlyReports: [
        {
          fiscalDateEnding: '2024-03-31',
          incomeStatement: { fiscalDateEnding: '2024-03-31', totalRevenue: '250000' },
          balanceSheet: { fiscalDateEnding: '2024-03-31', totalAssets: '5200000' },
          cashFlow: { fiscalDateEnding: '2024-03-31', operatingCashflow: '40000' },
          ratio: { fiscalDateEnding: '2024-03-31', reportedEPS: '1.68' },
        },
      ],
      cacheStatus: 'MISS' as const,
    };

    it('should return financial statements for valid ticker', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue(mockFinancialStatements);

      const request = mockRequest({ ticker: 'IBM' }, { 'x-forwarded-for': '127.0.0.1' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.jsonBody).toEqual({
        symbol: 'IBM',
        annualReports: mockFinancialStatements.annualReports,
        quarterlyReports: mockFinancialStatements.quarterlyReports,
      });
      expect(response.headers).toMatchObject({
        'X-Cache': 'MISS',
        'Content-Type': 'application/json',
      });
    });

    it('should return cache hit status when data is cached', async () => {
      const cachedResponse = { ...mockFinancialStatements, cacheStatus: 'HIT' as const };
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue(cachedResponse);

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.headers).toMatchObject({
        'X-Cache': 'HIT',
      });
    });

    it('should include rate limit headers in response', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue(mockFinancialStatements);

      mockApiRateLimiter.isAllowed.mockReturnValue({
        allowed: true,
        remaining: 50,
        resetTime: 1234567890000,
      });

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.headers).toMatchObject({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '50',
        'X-RateLimit-Reset': new Date(1234567890000).toISOString(),
      });
    });

    it('should set appropriate cache headers', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue(mockFinancialStatements);

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.headers).toMatchObject({
        'Cache-Control': 'max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
    });
  });

  describe('rate limiting', () => {
    it('should return 429 when rate limit exceeded', async () => {
      mockApiRateLimiter.isAllowed.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 60000,
      });

      const request = mockRequest({ ticker: 'IBM' }, { 'x-forwarded-for': '127.0.0.1' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(429);
      expect(response.jsonBody).toMatchObject({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
      });
      expect(response.headers).toHaveProperty('Retry-After');
    });

    it('should use x-real-ip header when x-forwarded-for is not present', async () => {
      mockApiRateLimiter.isAllowed.mockReturnValue({
        allowed: true,
        remaining: 99,
        resetTime: Date.now() + 60000,
      });

      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM' }, { 'x-real-ip': '192.168.1.1' });
      await statementsHandler(request, mockContext);

      expect(mockApiRateLimiter.isAllowed).toHaveBeenCalledWith('192.168.1.1');
    });

    it('should use "unknown" when no IP headers are present', async () => {
      mockApiRateLimiter.isAllowed.mockReturnValue({
        allowed: true,
        remaining: 99,
        resetTime: Date.now() + 60000,
      });

      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM' }, {});
      await statementsHandler(request, mockContext);

      expect(mockApiRateLimiter.isAllowed).toHaveBeenCalledWith('unknown');
    });
  });

  describe('parameter validation', () => {
    it('should return 400 when ticker parameter is missing', async () => {
      const request = mockRequest({});
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Missing required parameter: ticker',
      });
    });

    it('should return 400 when ticker is invalid', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({
        isValid: false,
        error: 'Invalid ticker format',
      });

      const request = mockRequest({ ticker: 'INVALID@TICKER' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Invalid ticker parameter',
        message: 'Invalid ticker format',
      });
    });

    it('should include rate limit headers in validation error responses', async () => {
      const request = mockRequest({});
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
    });
  });

  describe('error handling', () => {
    it('should handle Alpha Vantage rate limit errors', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(
        new Error('Alpha Vantage API rate limit reached'),
      );

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(429);
      expect(response.jsonBody).toMatchObject({
        error: 'API rate limit exceeded',
      });
    });

    it('should handle missing API key configuration', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(
        new Error('ALPHAVANTAGE_API_KEY environment variable is not set'),
      );

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(500);
      expect(response.jsonBody).toMatchObject({
        error: 'Configuration error',
      });
    });

    it('should handle timeout errors', async () => {
      const error = new Error('Timeout') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(error);

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(408);
      expect(response.jsonBody).toMatchObject({
        error: 'Request timeout',
      });
    });

    it('should handle ECONNABORTED timeout errors', async () => {
      const error = new Error('Connection aborted') as Error & { code: string };
      error.code = 'ECONNABORTED';
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(error);

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(408);
      expect(response.jsonBody).toMatchObject({
        error: 'Request timeout',
      });
    });

    it('should handle generic errors with response property', async () => {
      const error = {
        response: {
          status: 502,
          statusText: 'Bad Gateway',
        },
      };
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(error);

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(502);
      expect(response.jsonBody).toMatchObject({
        error: 'External API error',
      });
    });

    it('should handle unexpected errors', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(new Error('Unexpected error'));

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(500);
      expect(response.jsonBody).toMatchObject({
        error: 'Internal server error',
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue('String error');

      const request = mockRequest({ ticker: 'IBM' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(500);
      expect(response.jsonBody).toMatchObject({
        error: 'Internal server error',
      });
    });

    it('should log errors', async () => {
      const error = new Error('Test error');
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockRejectedValue(error);

      const request = mockRequest({ ticker: 'IBM' });
      await statementsHandler(request, mockContext);

      expect(mockContext.error).toHaveBeenCalledWith('Error in statementsHandler:', error);
    });
  });

  describe('ticker normalization', () => {
    it('should handle lowercase ticker', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'ibm' });
      await statementsHandler(request, mockContext);

      // The service should receive the ticker (normalization happens in service)
      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'ibm',
        null,
        undefined,
        undefined,
        mockContext,
      );
    });
  });

  describe('limitStatements parameter', () => {
    it('should return 400 for invalid limitStatements (negative)', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });

      const request = mockRequest({ ticker: 'IBM', limitStatements: '-1' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Invalid parameter: limitStatements',
      });
    });

    it('should return 400 for invalid limitStatements (zero)', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });

      const request = mockRequest({ ticker: 'IBM', limitStatements: '0' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Invalid parameter: limitStatements',
      });
    });

    it('should return 400 for invalid limitStatements (too large)', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });

      const request = mockRequest({ ticker: 'IBM', limitStatements: '101' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Invalid parameter: limitStatements',
      });
    });

    it('should return 400 for invalid limitStatements (non-numeric)', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });

      const request = mockRequest({ ticker: 'IBM', limitStatements: 'abc' });
      const response = await statementsHandler(request, mockContext);

      expect(response.status).toBe(400);
      expect(response.jsonBody).toMatchObject({
        error: 'Invalid parameter: limitStatements',
      });
    });

    it('should pass limitStatements to service when valid', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM', limitStatements: '4' });
      await statementsHandler(request, mockContext);

      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'IBM',
        null,
        4,
        undefined,
        mockContext,
      );
    });

    it('should work with both period and limitStatements', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM', period: 'yearly', limitStatements: '4' });
      await statementsHandler(request, mockContext);

      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'IBM',
        'yearly',
        4,
        undefined,
        mockContext,
      );
    });
  });

  describe('fields parameter', () => {
    it('should pass fields to service when provided', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM', fields: 'incomeStatement.grossProfit|balanceSheet.totalAssets' });
      await statementsHandler(request, mockContext);

      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'IBM',
        null,
        undefined,
        ['incomeStatement.grossProfit', 'balanceSheet.totalAssets'],
        mockContext,
      );
    });

    it('should pass empty fields array when fields param is empty string', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({ ticker: 'IBM', fields: '' });
      await statementsHandler(request, mockContext);

      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'IBM',
        null,
        undefined,
        undefined,
        mockContext,
      );
    });

    it('should work with fields and other parameters together', async () => {
      mockAlphaVantageService.validateTicker.mockReturnValue({ isValid: true });
      mockAlphaVantageService.getFinancialStatements.mockResolvedValue({
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
        cacheStatus: 'MISS',
      });

      const request = mockRequest({
        ticker: 'IBM',
        period: 'yearly',
        limitStatements: '5',
        fields: 'incomeStatement.totalRevenue|balanceSheet.totalAssets|cashFlow.operatingCashflow',
      });
      await statementsHandler(request, mockContext);

      expect(mockAlphaVantageService.getFinancialStatements).toHaveBeenCalledWith(
        'IBM',
        'yearly',
        5,
        ['incomeStatement.totalRevenue', 'balanceSheet.totalAssets', 'cashFlow.operatingCashflow'],
        mockContext,
      );
    });
  });
});
