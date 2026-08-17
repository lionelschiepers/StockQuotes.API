import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import { apiRateLimiter } from '../../src/services/rateLimiter';
import { cacheService } from '../../src/services/cacheService';
import { computeETag } from '../../src/utils/etag';

jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');
jest.mock('../../src/services/cacheService');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockApiRateLimiter = apiRateLimiter as unknown as { isAllowed: jest.Mock; getMaxRequests: jest.Mock };
const mockCacheService = cacheService as unknown as { get: jest.Mock; set: jest.Mock };

import { yahooFinanceSummaryHandler } from '../../src/functions/yahoo-finance-summary';

describe('yahooFinanceSummaryHandler', () => {
  let mockContext: InvocationContext;
  let mockYahooFinanceService: {
    getQuoteSummary: jest.Mock;
    validateSummaryRequest: jest.Mock;
  };

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
      getQuoteSummary: jest.fn(),
      validateSummaryRequest: jest.fn(),
    };

    mockGetServiceContainer.mockReturnValue({
      yahooFinanceService: mockYahooFinanceService,
    });

    mockApiRateLimiter.getMaxRequests.mockReturnValue(10);
    mockApiRateLimiter.isAllowed.mockReturnValue({
      allowed: true,
      remaining: 9,
      resetTime: Date.now() + 1000,
    });

    mockCacheService.get.mockReturnValue(null);
    mockCacheService.set.mockImplementation(() => {});
  });

  it('should return summary data for a valid ticker', async () => {
    const expectedData = {
      financialData: { targetMeanPrice: 200, recommendationKey: 'buy' },
      defaultKeyStatistics: { shortPercentOfFloat: 0.01 },
      recommendationTrend: { trend: [] },
    };
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateSummaryRequest).toHaveBeenCalledWith('AAPL', undefined);
    expect(mockYahooFinanceService.getQuoteSummary).toHaveBeenCalledWith(
      { ticker: 'AAPL', modules: undefined },
      mockContext,
    );
    expect(mockCacheService.set).toHaveBeenCalledWith('summary:AAPL:default', expectedData, 300000);
  });

  it('should return summary data with requested modules', async () => {
    const expectedData = { financialData: { targetMeanPrice: 200 } };
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', modules: 'financialData,recommendationTrend' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateSummaryRequest).toHaveBeenCalledWith('AAPL', [
      'financialData',
      'recommendationTrend',
    ]);
    expect(mockYahooFinanceService.getQuoteSummary).toHaveBeenCalledWith(
      { ticker: 'AAPL', modules: ['financialData', 'recommendationTrend'] },
      mockContext,
    );
  });

  it('should return 400 if ticker is missing', async () => {
    const request = mockRequest({});
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Missing required parameter: ticker' });
  });

  it('should return 400 if validation fails', async () => {
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({
      isValid: false,
      error: 'Invalid modules: bogus',
    });

    const request = mockRequest({ ticker: 'AAPL', modules: 'bogus' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Invalid modules: bogus' });
  });

  it('should return 429 if rate limit exceeded', async () => {
    mockApiRateLimiter.isAllowed.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 10000,
    });

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too many requests' });
  });

  it('should return cached data on cache hit', async () => {
    const cachedData = { financialData: { targetMeanPrice: 200 } };
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(cachedData);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.jsonBody).toEqual(cachedData);
    expect(mockCacheService.get).toHaveBeenCalled();
    expect(mockYahooFinanceService.getQuoteSummary).not.toHaveBeenCalled();
  });

  it('should return 304 on ETag match', async () => {
    const expectedData = { financialData: { targetMeanPrice: 200 } };
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockResolvedValue(expectedData);

    const etag = computeETag(expectedData);

    const request = mockRequest({ ticker: 'AAPL' }, { 'If-None-Match': etag });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(304);
    expect(response.headers).toMatchObject({ ETag: etag });
  });

  it('should handle service errors', async () => {
    const apiError = new Error('Service failure') as Error & { response?: { status: number; statusText: string } };
    apiError.response = { status: 502, statusText: 'Bad Gateway' };
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockRejectedValue(apiError);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(502);
    expect(response.jsonBody).toMatchObject({ error: 'External API error' });
  });

  it('should handle timeout errors', async () => {
    const timeoutError = new Error('Timeout') as Error & { code: string };
    timeoutError.code = 'ECONNABORTED';
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockRejectedValue(timeoutError);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(408);
    expect(response.jsonBody).toMatchObject({ error: 'Request timeout' });
  });

  it('should return 429 when Yahoo Finance returns Too Many Requests', async () => {
    const tooManyRequestsError = Object.assign(new Error('Too Many Requests'), { code: 429 });
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockRejectedValue(tooManyRequestsError);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too Many Requests' });
  });

  it('should handle generic errors', async () => {
    mockYahooFinanceService.validateSummaryRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuoteSummary.mockRejectedValue(new Error('Unknown error'));

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceSummaryHandler(request, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error' });
  });
});
