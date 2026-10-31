import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';
import { respondWithCache } from '../http/cache';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit } from '../http/rateLimit';
import { parseDelimitedList } from '../http/request';
import { buildHeaders, JSON_CONTENT_TYPE } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 300;
const CACHE_TTL_MS = 300 * 1000;

export async function yahooFinanceSummaryHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger YahooFinanceSummary launched');

  try {
    const rateLimit = enforceRateLimit(request, apiRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const ticker = request.query.get('ticker');
    const modules = parseDelimitedList(request.query.get('modules'));

    if (!ticker) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required parameter: ticker' },
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_CONTENT_TYPE },
      };
    }

    const { yahooFinanceService } = getServiceContainer();
    const validation = yahooFinanceService.validateSummaryRequest(ticker, modules);
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error },
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': JSON_CONTENT_TYPE },
      };
    }

    const sortedModules = modules ? [...modules].sort((a, b) => a.localeCompare(b)).join(',') : 'default';
    const cacheKey = `summary:${ticker}:${sortedModules}`;

    return await respondWithCache({
      request,
      context,
      cacheKey,
      ttlMs: CACHE_TTL_MS,
      fetch: () => yahooFinanceService.getQuoteSummary({ ticker, modules }, context),
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
      logLabel: 'Error in yahooFinanceSummaryHandler:',
      fallbackMessage: 'An unexpected error occurred',
      upstreamMessage: 'Unknown error',
      timeoutMessage: 'External service is not responding',
      rateLimitMessage: 'Yahoo Finance rate limit exceeded. Please try again later.',
    });
  }
}

app.http('yahoo-finance-summary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: yahooFinanceSummaryHandler,
});
