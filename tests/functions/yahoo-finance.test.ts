import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import { strictRateLimiter } from '../../src/services/rateLimiter';
import { cacheService } from '../../src/services/cacheService';
import { computeETag } from '../../src/utils/etag';

// Mock the dependencies
jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');
jest.mock('../../src/services/cacheService');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockStrictRateLimiter = strictRateLimiter as unknown as { isAllowed: jest.Mock; getMaxRequests: jest.Mock };
const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;

const mockYahooFinanceService = {
  getQuotes: jest.fn(),
  validateQuoteRequest: jest.fn(),
};

mockGetServiceContainer.mockReturnValue({
  yahooFinanceService: mockYahooFinanceService,
});

import { yahooFinanceHandler } from '../../src/functions/yahoo-finance';

describe('yahooFinanceHandler', () => {
  let mockContext: InvocationContext;

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

    mockStrictRateLimiter.getMaxRequests.mockReturnValue(2);
    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: true,
      remaining: 1,
      resetTime: Date.now() + 1000,
    });

    mockCacheService.get.mockReturnValue(null);
  });

  it('should return quotes for valid parameters including fields', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockResolvedValue(expectedData);

    const request = mockRequest({ symbols: 'AAPL', fields: 'regularMarketPrice' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getQuotes).toHaveBeenCalledWith(
      { symbols: ['AAPL'], fields: ['regularMarketPrice'] },
      mockContext,
    );
  });

  it('should return quotes when fields are missing (optional fields)', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150, marketCap: 2e12 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockResolvedValue(expectedData);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getQuotes).toHaveBeenCalledWith(
      { symbols: ['AAPL'], fields: undefined },
      mockContext,
    );
  });

  it('should return 400 if symbols are missing', async () => {
    const request = mockRequest({});
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Missing required parameter: symbols' });
  });

  it('should return 400 if validation fails', async () => {
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({
      isValid: false,
      error: 'Invalid symbols provided',
    });

    const request = mockRequest({ symbols: 'INVALID' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Invalid symbols provided' });
  });

  it('should return 429 if rate limit exceeded', async () => {
    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 10000,
    });

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too many requests' });
  });

  it('should handle service errors', async () => {
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockRejectedValue(new Error('Service failure'));

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error' });
  });

  it('should return 429 when Yahoo Finance returns Too Many Requests', async () => {
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    const tooManyRequestsError = Object.assign(new Error('Too Many Requests'), { code: 429 });
    mockYahooFinanceService.getQuotes.mockRejectedValue(tooManyRequestsError);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too Many Requests' });
  });

  it('should return the upstream status when the error has an axios-style response', async () => {
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    const axiosError = { response: { status: 503, statusText: 'Service Unavailable' } };
    mockYahooFinanceService.getQuotes.mockRejectedValue(axiosError);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(503);
    expect(response.jsonBody).toMatchObject({ error: 'External API error', message: 'Service Unavailable' });
  });

  it('should return 408 when the error is a timeout', async () => {
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    const timeoutError = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    mockYahooFinanceService.getQuotes.mockRejectedValue(timeoutError);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(408);
    expect(response.jsonBody).toMatchObject({ error: 'Request timeout' });
  });

  it('should return cache hit response when data is cached', async () => {
    const cachedData = { AAPL: { regularMarketPrice: 150 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(cachedData);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.jsonBody).toEqual(cachedData);
    expect(response.headers).toMatchObject({
      'X-Cache': 'HIT',
      'Cache-Control': 'max-age=60',
    });
    expect(mockYahooFinanceService.getQuotes).not.toHaveBeenCalled();
  });

  it('should perform upstream fetch on cache miss and save to cache with 60s TTL', async () => {
    const freshData = { AAPL: { regularMarketPrice: 151 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockResolvedValue(freshData);
    mockCacheService.get.mockReturnValue(null);

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.jsonBody).toEqual(freshData);
    expect(response.headers).toMatchObject({
      'X-Cache': 'MISS',
      'Cache-Control': 'max-age=60',
    });
    expect(mockYahooFinanceService.getQuotes).toHaveBeenCalled();
    expect(mockCacheService.set).toHaveBeenCalledWith('quotes:AAPL:all', freshData, 60000);
  });

  it('should return 304 Not Modified when ETag matches cached payload', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(expectedData);

    const etag = computeETag(expectedData);

    const request = mockRequest({ symbols: 'AAPL' }, { 'If-None-Match': etag });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(304);
    expect(response.headers).toMatchObject({ ETag: etag });
    expect(mockYahooFinanceService.getQuotes).not.toHaveBeenCalled();
  });

  it('should return 304 Not Modified when ETag matches freshly fetched payload', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockResolvedValue(expectedData);
    mockCacheService.get.mockReturnValue(null);

    const etag = computeETag(expectedData);

    const request = mockRequest({ symbols: 'AAPL' }, { 'If-None-Match': etag });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(304);
    expect(response.headers).toMatchObject({ ETag: etag });
    expect(mockYahooFinanceService.getQuotes).toHaveBeenCalled();
  });

  it('should return fresh data when If-None-Match does not match payload ETag', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150 } };
    mockYahooFinanceService.validateQuoteRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getQuotes.mockResolvedValue(expectedData);

    const request = mockRequest({ symbols: 'AAPL' }, { 'If-None-Match': '"different-etag"' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBeUndefined();
    expect(response.jsonBody).toEqual(expectedData);
    expect(response.headers).toMatchObject({
      ETag: computeETag(expectedData),
      'X-Cache': 'MISS',
    });
  });
});
