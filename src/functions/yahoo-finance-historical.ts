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
    'Cache-Control': 'max-age=3600',
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

function handleHistoricalError(error: unknown, context: InvocationContext): HttpResponseInit {
  context.error('Error in yahooFinanceHistoricalHandler:', error);

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

export async function yahooFinanceHistoricalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceHistorical launched');

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
    const from = request.query.get('from');
    const to = request.query.get('to');
    const interval = request.query.get('interval') ?? undefined;
    const fieldsParam = request.query.get('fields');
    const fields = fieldsParam ? fieldsParam.split(/[|,]/).filter((f) => f.length > 0) : undefined;

    if (!ticker) {
      return { status: 400, jsonBody: { error: 'Missing required parameter: ticker' } };
    }

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateHistoricalRequest(ticker, from ?? '', to ?? '', interval, fields);
    if (!validation.isValid) {
      return { status: 400, jsonBody: { error: validation.error } };
    }

    const today = new Date().toISOString().split('T')[0];
    const sortedFields = fields ? [...fields].sort((a, b) => a.localeCompare(b)).join(',') : 'all';
    const cacheKey = `hist:${today}:${ticker}:${from}:${to}:${interval ?? '1d'}:${sortedFields}`;
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

    const data = await yahooFinanceService.getHistoricalData(
      { ticker, from: from!, to: to!, interval, fields },
      context,
    );
    cacheService.set(cacheKey, data);
    context.log(`Cache stored for ${cacheKey}`);

    return { jsonBody: data, headers: buildHeaders(rateLimit, etag, 'MISS') };
  } catch (error: unknown) {
    return handleHistoricalError(error, context);
  }
}

app.http('yahoo-finance-historical', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceHistoricalHandler,
});
