import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { strictRateLimiter } from '../services/rateLimiter';
import { cacheService } from '../services/cacheService';

// sample call: http://localhost:7071/api/yahoo-finance-historical?ticker=MSFT&from=2024-01-01&to=2024-12-31
export async function yahooFinanceHistoricalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceHistorical launched');

  const { yahooFinanceService } = getServiceContainer();

  try {
    // Extract client IP for rate limiting
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';

    // Apply rate limiting
    const rateLimitResult = strictRateLimiter.isAllowed(clientIp);

    if (!rateLimitResult.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        },
        headers: {
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString(),
        },
      };
    }

    // Validate input parameters
    const ticker = request.query.get('ticker');
    const from = request.query.get('from');
    const to = request.query.get('to');
    const interval = request.query.get('interval') ?? undefined;
    const fieldsParam = request.query.get('fields');
    const fields = fieldsParam ? fieldsParam.split(/[|,]/).filter((f) => f.length > 0) : undefined;

    if (!ticker) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required parameter: ticker' },
      };
    }

    // Validate request using service
    const validation = yahooFinanceService.validateHistoricalRequest(ticker, from ?? '', to ?? '', interval, fields);
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error },
      };
    }

    // Check cache first
    const cacheKey = `hist:${ticker}:${from}:${to}:${interval ?? '1d'}:${fields ? [...fields].sort().join(',') : 'all'}`;
    const etag = `"${Buffer.from(cacheKey).toString('base64')}"`;

    // Check for conditional request (ETag match)
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch === etag) {
      context.log(`ETag match for ${cacheKey}, returning 304`);
      return {
        status: 304,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=3600',
          ETag: etag,
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
        },
      };
    }

    const cached = cacheService.get<unknown>(cacheKey);
    if (cached) {
      context.log(`Cache hit for ${cacheKey}`);
      return {
        jsonBody: cached,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=3600',
          'Content-Type': 'application/json',
          ETag: etag,
          'X-Cache': 'HIT',
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
        },
      };
    }

    const responseMessage = await yahooFinanceService.getHistoricalData(
      { ticker, from: from!, to: to!, interval, fields },
      context,
    );

    // Store in cache
    cacheService.set(cacheKey, responseMessage);
    context.log(`Cache stored for ${cacheKey}`);

    return {
      jsonBody: responseMessage,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=3600',
        'Content-Type': 'application/json',
        ETag: etag,
        'X-Cache': 'MISS',
        'X-RateLimit-Limit': '20',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
      },
    };
  } catch (error: unknown) {
    context.error('Error in yahooFinanceHistoricalHandler:', error);

    // Handle different error types
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { status?: number; statusText?: string } };
      // External API error
      return {
        status: axiosError.response?.status ?? 502,
        jsonBody: {
          error: 'External API error',
          message: axiosError.response?.statusText ?? 'Unknown error',
          status: axiosError.response?.status,
        },
      };
    } else if (error && typeof error === 'object' && 'code' in error) {
      const nodeError = error as { code?: string };
      if (nodeError.code === 'ECONNABORTED' || nodeError.code === 'ETIMEDOUT') {
        // Timeout error
        return {
          status: 408,
          jsonBody: { error: 'Request timeout', message: 'External service is not responding' },
        };
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    // Internal server error
    return {
      status: 500,
      jsonBody: {
        error: 'Internal server error',
        message: errorMessage,
      },
    };
  }
}

app.http('yahoo-finance-historical', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceHistoricalHandler,
});
