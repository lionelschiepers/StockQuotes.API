import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { strictRateLimiter } from '../services/rateLimiter';
import { cacheService } from '../services/cacheService';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

function buildHeaders(rateLimit: RateLimitResult, etag: string, cacheStatus?: 'HIT' | 'MISS') {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'max-age=300',
    ETag: etag,
    'X-RateLimit-Limit': strictRateLimiter.getMaxRequests().toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
  };

  if (cacheStatus) {
    headers['X-Cache'] = cacheStatus;
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function handleOptionsError(error: unknown, context: InvocationContext): HttpResponseInit {
  context.error('Error in yahooFinanceOptionsHandler:', error);

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    if (errObj.response && typeof errObj.response === 'object') {
      const response = errObj.response as Record<string, unknown>;
      return {
        status: (response.status as number) ?? 502,
        jsonBody: {
          error: 'External API error',
          message: (response.statusText as string) ?? 'Unknown error',
          status: response.status,
        },
      };
    }
    if (errObj.code === 'ECONNABORTED' || errObj.code === 'ETIMEDOUT') {
      return {
        status: 408,
        jsonBody: { error: 'Request timeout', message: 'External service is not responding' },
      };
    }
  }

  return {
    status: 500,
    jsonBody: {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    },
  };
}

export async function yahooFinanceOptionsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceOptions launched');

  try {
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
    const rateLimit = strictRateLimiter.isAllowed(clientIp);

    if (!rateLimit.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
        },
        headers: {
          'X-RateLimit-Limit': strictRateLimiter.getMaxRequests().toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
          'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
        },
      };
    }

    const ticker = request.query.get('ticker');
    const expirationDate = request.query.get('expirationDate') ?? undefined;
    const filterParam = request.query.get('filter');
    const filter = filterParam
      ? filterParam
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : undefined;
    const limitParam = request.query.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    if (!ticker) {
      return { status: 400, jsonBody: { error: 'Missing required parameter: ticker' } };
    }

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateOptionsRequest(ticker, expirationDate, filter, limit);
    if (!validation.isValid) {
      return { status: 400, jsonBody: { error: validation.error } };
    }

    const today = new Date().toISOString().split('T')[0];
    const sortedFilter = filter ? [...filter].sort((a, b) => a.localeCompare(b)).join(',') : 'all';
    const cacheKey = `options:${today}:${ticker}:${expirationDate ?? 'all'}:${sortedFilter}:${limit ?? 'all'}`;
    const etag = `"${Buffer.from(cacheKey).toString('base64')}"`;

    if (request.headers.get('If-None-Match') === etag) {
      context.log(`ETag match for ${cacheKey}, returning 304`);
      return { status: 304, headers: buildHeaders(rateLimit, etag) };
    }

    const cached = cacheService.get<unknown>(cacheKey);
    if (cached) {
      context.log(`Cache hit for ${cacheKey}`);
      return { jsonBody: cached, headers: buildHeaders(rateLimit, etag, 'HIT') };
    }

    const data = await yahooFinanceService.getOptions(
      { ticker, expirationDate, filter: filter as Array<'calls' | 'puts'>, limit },
      context,
    );
    cacheService.set(cacheKey, data);
    context.log(`Cache stored for ${cacheKey}`);

    return { jsonBody: data, headers: buildHeaders(rateLimit, etag, 'MISS') };
  } catch (error: unknown) {
    return handleOptionsError(error, context);
  }
}

app.http('yahoo-finance-stock-options', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceOptionsHandler,
});
