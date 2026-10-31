import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { strictRateLimiter } from '../services/rateLimiter';
import { respondWithCache } from '../http/cache';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit } from '../http/rateLimit';
import { parseDelimitedList } from '../http/request';
import { buildHeaders, JSON_CONTENT_TYPE } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 3600;

export async function yahooFinanceHistoricalHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceHistorical launched');

  try {
    const rateLimit = enforceRateLimit(request, strictRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const ticker = request.query.get('ticker');
    const from = request.query.get('from') ?? '';
    const to = request.query.get('to') ?? '';
    const interval = request.query.get('interval') ?? undefined;
    const fields = parseDelimitedList(request.query.get('fields'), /[|,]/);

    if (!ticker) {
      return { status: 400, jsonBody: { error: 'Missing required parameter: ticker' } };
    }

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateHistoricalRequest(ticker, from, to, interval, fields);
    if (!validation.isValid) {
      return { status: 400, jsonBody: { error: validation.error } };
    }

    const today = new Date().toISOString().split('T')[0];
    const sortedFields = fields ? [...fields].sort((a, b) => a.localeCompare(b)).join(',') : 'all';
    const cacheKey = `hist:${today}:${ticker}:${from}:${to}:${interval ?? '1d'}:${sortedFields}`;

    return await respondWithCache({
      request,
      context,
      cacheKey,
      fetch: () => yahooFinanceService.getHistoricalData({ ticker, from, to, interval, fields }, context),
      headers: ({ etag, cacheStatus, hasBody }) =>
        buildHeaders({
          limiter: strictRateLimiter,
          rateLimit: rateLimit.result,
          maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
          etag,
          cacheStatus,
          contentType: hasBody ? JSON_CONTENT_TYPE : undefined,
        }),
    });
  } catch (error: unknown) {
    return mapErrorToResponse(error, context, {
      logLabel: 'Error in yahooFinanceHistoricalHandler:',
      fallbackMessage: 'An unexpected error occurred',
      upstreamMessage: 'Unknown error',
      timeoutMessage: 'External service is not responding',
      rateLimitMessage: 'Yahoo Finance rate limit exceeded. Please try again later.',
    });
  }
}

app.http('yahoo-finance-historical', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceHistoricalHandler,
});
