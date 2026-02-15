import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../../src/di/container';
import type { YahooFinanceService } from '../../src/services/yahooFinanceService';
import { strictRateLimiter } from '../../src/services/rateLimiter';

// Mock the dependencies
jest.mock('../../src/di/container');
jest.mock('../../src/services/rateLimiter');

const mockGetServiceContainer = getServiceContainer as jest.Mock;
const mockStrictRateLimiter = strictRateLimiter as unknown as { isAllowed: jest.Mock };

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

    mockStrictRateLimiter.isAllowed.mockReturnValue({
      allowed: true,
      remaining: 19,
      resetTime: Date.now() + 60000,
    });
  });

  it('should return quotes for valid parameters including fields', async () => {
    const expectedData = { AAPL: { regularMarketPrice: 150 } };
    (mockYahooFinanceService.validateQuoteRequest as jest.Mock).mockReturnValue({ isValid: true });
    (mockYahooFinanceService.getQuotes as jest.Mock).mockResolvedValue(expectedData);

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
    (mockYahooFinanceService.validateQuoteRequest as jest.Mock).mockReturnValue({ isValid: true });
    (mockYahooFinanceService.getQuotes as jest.Mock).mockResolvedValue(expectedData);

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
    (mockYahooFinanceService.validateQuoteRequest as jest.Mock).mockReturnValue({
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
    (mockYahooFinanceService.validateQuoteRequest as jest.Mock).mockReturnValue({ isValid: true });
    (mockYahooFinanceService.getQuotes as jest.Mock).mockRejectedValue(new Error('Service failure'));

    const request = mockRequest({ symbols: 'AAPL' });
    const response = await yahooFinanceHandler(request, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody).toMatchObject({ error: 'Internal server error' });
  });
});
