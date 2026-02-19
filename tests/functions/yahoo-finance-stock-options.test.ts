import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import { strictRateLimiter } from '../../src/services/rateLimiter';
import { cacheService } from '../../src/services/cacheService';

jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');
jest.mock('../../src/services/cacheService');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockStrictRateLimiter = strictRateLimiter as unknown as { isAllowed: jest.Mock; getMaxRequests: jest.Mock };
const mockCacheService = cacheService as unknown as { get: jest.Mock; set: jest.Mock };

import { yahooFinanceOptionsHandler } from '../../src/functions/yahoo-finance-stock-options';

describe('yahooFinanceOptionsHandler', () => {
  let mockContext: InvocationContext;
  let mockYahooFinanceService: {
    getOptions: jest.Mock;
    validateOptionsRequest: jest.Mock;
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
      getOptions: jest.fn(),
      validateOptionsRequest: jest.fn(),
    };

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

  it('should return options data for valid ticker', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      calls: [],
      puts: [],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      {
        ticker: 'AAPL',
        expirationDate: undefined,
        expirationDatesCount: undefined,
        filter: undefined,
        limit: undefined,
      },
      mockContext,
    );
  });

  it('should return options data with expirationDatesCount', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21'), new Date('2025-03-28')],
      strikes: [150, 155, 160],
      options: [
        { expirationDate: new Date('2025-03-21'), calls: [], puts: [] },
        { expirationDate: new Date('2025-03-28'), calls: [], puts: [] },
      ],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', expirationDatesCount: '2' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      2,
      undefined,
      undefined,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      { ticker: 'AAPL', expirationDate: undefined, expirationDatesCount: 2, filter: undefined, limit: undefined },
      mockContext,
    );
  });

  it('should return options data filtered by calls only', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      options: [{ expirationDate: new Date('2025-03-21'), calls: [{ strike: 150 }] }],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', filter: 'calls' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      undefined,
      ['calls'],
      undefined,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      {
        ticker: 'AAPL',
        expirationDate: undefined,
        expirationDatesCount: undefined,
        filter: ['calls'],
        limit: undefined,
      },
      mockContext,
    );
  });

  it('should return options data filtered by puts only', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      options: [{ expirationDate: new Date('2025-03-21'), puts: [{ strike: 150 }] }],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', filter: 'puts' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      undefined,
      ['puts'],
      undefined,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      {
        ticker: 'AAPL',
        expirationDate: undefined,
        expirationDatesCount: undefined,
        filter: ['puts'],
        limit: undefined,
      },
      mockContext,
    );
  });

  it('should return options data with both calls and puts filter', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      options: [{ expirationDate: new Date('2025-03-21'), calls: [{ strike: 150 }], puts: [{ strike: 150 }] }],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', filter: 'calls,puts' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      undefined,
      ['calls', 'puts'],
      undefined,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      {
        ticker: 'AAPL',
        expirationDate: undefined,
        expirationDatesCount: undefined,
        filter: ['calls', 'puts'],
        limit: undefined,
      },
      mockContext,
    );
  });

  it('should return 400 for invalid filter values', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({
      isValid: false,
      error: 'Invalid filter values: invalid. Valid values are: calls, puts',
    });

    const request = mockRequest({ ticker: 'AAPL', filter: 'invalid' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Invalid filter values: invalid. Valid values are: calls, puts' });
  });

  it('should return options data with expiration date', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      calls: [],
      puts: [],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', expirationDate: '2025-03-21' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      {
        ticker: 'AAPL',
        expirationDate: '2025-03-21',
        expirationDatesCount: undefined,
        filter: undefined,
        limit: undefined,
      },
      mockContext,
    );
  });

  it('should return options data with limit parameter', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      quote: { regularMarketPrice: 155 },
      options: [{ expirationDate: new Date('2025-03-21'), calls: [{ strike: 160 }], puts: [{ strike: 150 }] }],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', limit: '4' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      undefined,
      undefined,
      4,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      { ticker: 'AAPL', expirationDate: undefined, expirationDatesCount: undefined, filter: undefined, limit: 4 },
      mockContext,
    );
  });

  it('should return options data with filter and limit parameters', async () => {
    const expectedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160, 165, 170],
      quote: { regularMarketPrice: 158 },
      options: [{ expirationDate: new Date('2025-03-21'), calls: [{ strike: 160 }, { strike: 165 }] }],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockResolvedValue(expectedData);

    const request = mockRequest({ ticker: 'AAPL', filter: 'calls', limit: '2' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(expectedData);
    expect(mockYahooFinanceService.validateOptionsRequest).toHaveBeenCalledWith(
      'AAPL',
      undefined,
      undefined,
      ['calls'],
      2,
    );
    expect(mockYahooFinanceService.getOptions).toHaveBeenCalledWith(
      { ticker: 'AAPL', expirationDate: undefined, expirationDatesCount: undefined, filter: ['calls'], limit: 2 },
      mockContext,
    );
  });

  it('should return 400 for invalid limit value', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({
      isValid: false,
      error: 'Limit must be an integer between 1 and 50',
    });

    const request = mockRequest({ ticker: 'AAPL', limit: '100' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Limit must be an integer between 1 and 50' });
  });

  it('should return 400 for invalid expirationDatesCount value', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({
      isValid: false,
      error: 'expirationDatesCount must be an integer between 1 and 12',
    });

    const request = mockRequest({ ticker: 'AAPL', expirationDatesCount: '20' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'expirationDatesCount must be an integer between 1 and 12' });
  });

  it('should return 400 if both expirationDate and expirationDatesCount are provided', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({
      isValid: false,
      error: 'Cannot specify both expirationDate and expirationDatesCount',
    });

    const request = mockRequest({ ticker: 'AAPL', expirationDate: '2025-03-21', expirationDatesCount: '2' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Cannot specify both expirationDate and expirationDatesCount' });
  });

  it('should return 400 if ticker is missing', async () => {
    const request = mockRequest({});
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Missing required parameter: ticker' });
  });

  it('should return 400 if validation fails', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({
      isValid: false,
      error: 'Invalid expiration date',
    });

    const request = mockRequest({ ticker: 'AAPL', expirationDate: 'invalid-date' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'Invalid expiration date' });
  });

  it('should return 429 if rate limit exceeded', async () => {
    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 10000,
    });

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(429);
    expect(response.jsonBody).toMatchObject({ error: 'Too many requests' });
  });

  it('should return cached data on cache hit', async () => {
    const cachedData = {
      underlyingSymbol: 'AAPL',
      expirationDates: [new Date('2025-03-21')],
      strikes: [150, 155, 160],
      calls: [],
      puts: [],
    };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockCacheService.get.mockReturnValue(cachedData);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.jsonBody).toEqual(cachedData);
    expect(mockCacheService.get).toHaveBeenCalled();
    expect(mockYahooFinanceService.getOptions).not.toHaveBeenCalled();
  });

  it('should return 304 on ETag match', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });

    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `options:${today}:AAPL:all:all:all:all`;
    const etag = `"${Buffer.from(cacheKey).toString('base64')}"`;

    const request = mockRequest({ ticker: 'AAPL' }, { 'If-None-Match': etag });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(304);
  });

  it('should handle service errors', async () => {
    const apiError = new Error('Service failure') as Error & { response?: { status: number; statusText: string } };
    apiError.response = { status: 502, statusText: 'Bad Gateway' };
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockRejectedValue(apiError);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(502);
    expect(response.jsonBody).toMatchObject({ error: 'External API error' });
  });

  it('should handle timeout errors', async () => {
    const timeoutError = new Error('Timeout') as Error & { code: string };
    timeoutError.code = 'ECONNABORTED';
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockRejectedValue(timeoutError);

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(408);
    expect(response.jsonBody).toMatchObject({ error: 'Request timeout' });
  });

  it('should handle generic errors', async () => {
    mockYahooFinanceService.validateOptionsRequest.mockReturnValue({ isValid: true });
    mockYahooFinanceService.getOptions.mockRejectedValue(new Error('Unknown error'));

    const request = mockRequest({ ticker: 'AAPL' });
    const response = await yahooFinanceOptionsHandler(request, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error' });
  });
});
