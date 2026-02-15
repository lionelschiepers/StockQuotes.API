import { yahooFinanceHistoricalHandler } from '../../src/functions/yahoo-finance-historical';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import type { YahooFinanceService } from '../../src/services/yahooFinanceService';
import { strictRateLimiter } from '../../src/services/rateLimiter';
import { cacheService } from '../../src/services/cacheService';

// Mock the dependencies
jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');
jest.mock('../../src/services/cacheService');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockStrictRateLimiter = strictRateLimiter as unknown as { isAllowed: jest.Mock; getMaxRequests: jest.Mock };
const mockCacheService = cacheService as unknown as { get: jest.Mock; set: jest.Mock };

describe('yahooFinanceHistoricalHandler', () => {
  let mockContext: InvocationContext;
  let mockYahooFinanceService: jest.Mocked<YahooFinanceService>;

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

    mockYahooFinanceService = {
      getHistoricalData: jest.fn(),
      validateHistoricalRequest: jest.fn(),
    } as unknown as jest.Mocked<YahooFinanceService>;

    mockGetServiceContainer.mockReturnValue({
      yahooFinanceService: mockYahooFinanceService,
    });

    mockStrictRateLimiter.getMaxRequests.mockReturnValue(2);
    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: true,
      remaining: 1,
      resetTime: Date.now() + 1000,
    });

    mockCacheService.get.mockReturnValue(null);
    mockCacheService.set.mockImplementation(() => {});
  });

  it('should return historical data for valid parameters', async () => {
    const expectedData = { quotes: [{ date: '2024-01-01', close: 100 }] };
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02', interval: '1w' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBeUndefined(); // defaults to 200
    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getHistoricalData).toHaveBeenCalledWith(
      { ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02', interval: '1w' },
      mockContext,
    );
    expect(mockCacheService.set).toHaveBeenCalled();
    expect(response.headers).toMatchObject({ 'X-Cache': 'MISS' });
  });

  it('should return cached data when available', async () => {
    const cachedData = { quotes: [{ date: '2024-01-01', close: 100 }] };
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(cachedData);

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBeUndefined();
    expect(response.jsonBody).toEqual(cachedData);
    expect(mockYahooFinanceService.getHistoricalData).not.toHaveBeenCalled();
    expect(response.headers).toMatchObject({ 'X-Cache': 'HIT' });
  });

  it('should pass fields to the service if provided', async () => {
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockResolvedValue({ quotes: [] });

    const request = mockRequest({
      ticker: 'AAPL',
      from: '2024-01-01',
      to: '2024-01-02',
      fields: 'close,volume',
    });
    await yahooFinanceHistoricalHandler(request, mockContext);

    expect(mockYahooFinanceService.getHistoricalData).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ['close', 'volume'],
      }),
      mockContext,
    );
  });

  it('should support pipe delimiter for fields', async () => {
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockResolvedValue({ quotes: [] });

    const request = mockRequest({
      ticker: 'AAPL',
      from: '2024-01-01',
      to: '2024-01-02',
      fields: 'open|close',
    });
    await yahooFinanceHistoricalHandler(request, mockContext);

    expect(mockYahooFinanceService.getHistoricalData).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ['open', 'close'],
      }),
      mockContext,
    );
  });

  it('should return 400 if ticker is missing', async () => {
    const request = mockRequest({ from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Missing required parameter: ticker' });
  });

  it('should return 400 if validation fails', async () => {
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({
      isValid: false,
      error: 'Invalid date format',
    });

    const request = mockRequest({ ticker: 'AAPL', from: 'invalid', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Invalid date format' });
  });

  it('should return 429 if rate limit exceeded', async () => {
    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 10000,
    });

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too many requests' });
  });

  it('should handle service errors', async () => {
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockRejectedValue(new Error('Service failure'));

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error' });
  });

  it('should return ETag header in response', async () => {
    const expectedData = { quotes: [{ date: '2024-01-01', close: 100 }] };
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.headers).toHaveProperty('ETag');
    expect((response.headers as Record<string, string>)['ETag']).toMatch(/^"[A-Za-z0-9+/]+={0,2}"$/);
  });

  it('should return 304 Not Modified when If-None-Match matches ETag', async () => {
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });

    // Calculate expected ETag
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `hist:${today}:AAPL:2024-01-01:2024-01-02:1d:all`;
    const expectedETag = `"${Buffer.from(cacheKey).toString('base64')}"`;

    const request = mockRequest(
      { ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' },
      { 'If-None-Match': expectedETag },
    );
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBe(304);
    expect(response.jsonBody).toBeUndefined();
    expect(response.headers).toHaveProperty('ETag', expectedETag);
    expect(mockYahooFinanceService.getHistoricalData).not.toHaveBeenCalled();
    expect(mockCacheService.get).not.toHaveBeenCalled();
  });

  it('should return fresh data when If-None-Match does not match ETag', async () => {
    const expectedData = { quotes: [{ date: '2024-01-01', close: 100 }] };
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getHistoricalData.mockResolvedValue(expectedData);

    const request = mockRequest(
      { ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' },
      { 'If-None-Match': '"different-etag"' },
    );
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBeUndefined();
    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getHistoricalData).toHaveBeenCalled();
  });

  it('should return cached data with ETag when cache hit occurs', async () => {
    const cachedData = { quotes: [{ date: '2024-01-01', close: 100 }] };
    mockYahooFinanceService.validateHistoricalRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(cachedData);

    const request = mockRequest({ ticker: 'AAPL', from: '2024-01-01', to: '2024-01-02' });
    const response = await yahooFinanceHistoricalHandler(request, mockContext);

    expect(response.status).toBeUndefined();
    expect(response.jsonBody).toEqual(cachedData);
    expect(response.headers).toHaveProperty('ETag');
    expect((response.headers as Record<string, string>)['ETag']).toMatch(/^"[A-Za-z0-9+/]+={0,2}"$/);
  });
});
