import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';
import { respondWithCache } from '../http/cache';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit } from '../http/rateLimit';
import { parseDelimitedList, parseOptionalInt } from '../http/request';
import { buildHeaders, JSON_CONTENT_TYPE } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 300;
const CACHE_TTL_MS = 300 * 1000;

export async function yahooFinanceOptionsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceOptions launched');

  try {
    const rateLimit = enforceRateLimit(request, apiRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const ticker = request.query.get('ticker');
    const expirationDate = request.query.get('expirationDate') ?? undefined;
    const expirationDatesCount = parseOptionalInt(request.query.get('expirationDatesCount'));
    const filterParam = parseDelimitedList(request.query.get('filter'));
    const limit = parseOptionalInt(request.query.get('limit'));

    if (!ticker) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required parameter: ticker' },
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_CONTENT_TYPE },
      };
    }

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateOptionsRequest(
      ticker,
      expirationDate,
      expirationDatesCount,
      filterParam,
      limit,
    );
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error },
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_CONTENT_TYPE },
      };
    }

    const today = new Date().toISOString().split('T')[0];
    const sortedFilter = filterParam ? [...filterParam].sort((a, b) => a.localeCompare(b)).join(',') : 'all';
    const cacheKey = `options:${today}:${ticker}:${expirationDate ?? 'all'}:${expirationDatesCount ?? 'all'}:${sortedFilter}:${limit ?? 'all'}`;

    return await respondWithCache({
      request,
      context,
      cacheKey,
      ttlMs: CACHE_TTL_MS,
      fetch: () =>
        yahooFinanceService.getOptions(
          {
            ticker,
            expirationDate,
            expirationDatesCount,
            filter: filterParam as Array<'calls' | 'puts'> | undefined,
            limit,
          },
          context,
        ),
      headers: ({ etag, cacheStatus, hasBody }) =>
        buildHeaders({
          limiter: apiRateLimiter,
          rateLimit: rateLimit.result,
          maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
          etag,
          cacheStatus,
          contentType: hasBody ? JSON_CONTENT_TYPE : undefined,
        }),
    });
  } catch (error: unknown) {
    return mapErrorToResponse(error, context, {
      logLabel: 'Error in yahooFinanceOptionsHandler:',
      fallbackMessage: 'An unexpected error occurred',
      upstreamMessage: 'Unknown error',
      timeoutMessage: 'External service is not responding',
      rateLimitMessage: 'Yahoo Finance rate limit exceeded. Please try again later.',
    });
  }
}

app.http('yahoo-finance-stock-options', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceOptionsHandler,
});
