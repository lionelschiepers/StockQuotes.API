import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { strictRateLimiter } from '../services/rateLimiter';
import { respondWithCache } from '../http/cache';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit } from '../http/rateLimit';
import { parseDelimitedList } from '../http/request';
import { buildHeaders, JSON_CONTENT_TYPE } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 60;
const CACHE_TTL_MS = 60 * 1000;

// sample call: http://localhost:7071/api/yahoo-finance?symbols=MSFT&fields=regularMarketPrice
export async function yahooFinanceHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinance launched');

  try {
    const rateLimit = enforceRateLimit(request, strictRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const symbolsParam = request.query.get('symbols');
    if (!symbolsParam) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required parameter: symbols' },
      };
    }

    const querySymbols = parseDelimitedList(symbolsParam) ?? [];
    const queryFields = parseDelimitedList(request.query.get('fields'));

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateQuoteRequest(querySymbols, queryFields);
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error },
      };
    }

    const sortedSymbols = [...querySymbols].sort((a, b) => a.localeCompare(b)).join(',');
    const sortedFields = queryFields ? [...queryFields].sort((a, b) => a.localeCompare(b)).join(',') : 'all';
    const cacheKey = `quotes:${sortedSymbols}:${sortedFields}`;

    return await respondWithCache({
      request,
      context,
      cacheKey,
      ttlMs: CACHE_TTL_MS,
      fetch: () => yahooFinanceService.getQuotes({ symbols: querySymbols, fields: queryFields }, context),
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
      logLabel: 'Error in yahooFinanceHandler:',
      fallbackMessage: 'An unexpected error occurred',
      upstreamMessage: 'Unknown error',
      timeoutMessage: 'External service is not responding',
      rateLimitMessage: 'Yahoo Finance rate limit exceeded. Please try again later.',
    });
  }
}

app.http('yahoo-finance', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: yahooFinanceHandler,
});
