import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';
import type { RateLimitResult } from '../services/rateLimiter';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit, rateLimitHeaders } from '../http/rateLimit';
import { parseDelimitedList, parseOptionalInt } from '../http/request';
import { buildHeaders, JSON_CONTENT_TYPE } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 86400;

function badRequest(error: string, message: string, rateLimit: RateLimitResult): HttpResponseInit {
  return {
    status: 400,
    jsonBody: { error, message },
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': JSON_CONTENT_TYPE,
      ...rateLimitHeaders(apiRateLimiter, rateLimit),
    },
  };
}

export async function statementsHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger GetStatements launched');

  try {
    const rateLimit = enforceRateLimit(request, apiRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const ticker = request.query.get('ticker');
    if (!ticker) {
      return badRequest(
        'Missing required parameter: ticker',
        'Please provide a ticker symbol using the ticker query parameter (e.g., ?ticker=IBM)',
        rateLimit.result,
      );
    }

    const period = request.query.get('period');
    if (period && !['yearly', 'quarterly'].includes(period)) {
      return badRequest(
        'Invalid parameter: period',
        'Period must be either "yearly" or "quarterly". If not specified, both periods are returned.',
        rateLimit.result,
      );
    }

    const limitStatements = parseOptionalInt(request.query.get('limitStatements'));
    if (
      limitStatements !== undefined &&
      (Number.isNaN(limitStatements) || limitStatements < 1 || limitStatements > 100)
    ) {
      return badRequest(
        'Invalid parameter: limitStatements',
        'limitStatements must be a positive integer between 1 and 100.',
        rateLimit.result,
      );
    }

    const fields = parseDelimitedList(request.query.get('fields'), '|');

    const { alphaVantageService } = getServiceContainer();
    const validation = alphaVantageService.validateTicker(ticker);
    if (!validation.isValid) {
      return badRequest('Invalid ticker parameter', validation.error ?? 'Invalid ticker symbol', rateLimit.result);
    }

    const response = await alphaVantageService.getFinancialStatements(
      ticker,
      period as 'yearly' | 'quarterly' | undefined,
      limitStatements,
      fields,
      context,
    );

    const responseBody: Record<string, unknown> = { symbol: response.symbol };
    if (response.annualReports.length > 0) responseBody.annualReports = response.annualReports;
    if (response.quarterlyReports.length > 0) responseBody.quarterlyReports = response.quarterlyReports;

    return {
      status: 200,
      jsonBody: responseBody,
      headers: buildHeaders({
        limiter: apiRateLimiter,
        rateLimit: rateLimit.result,
        maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
        cacheStatus: response.cacheStatus,
        contentType: JSON_CONTENT_TYPE,
      }),
    };
  } catch (error: unknown) {
    return mapErrorToResponse(error, context, {
      logLabel: 'Error in statementsHandler:',
      fallbackMessage: 'An unexpected error occurred while fetching financial statements',
      upstreamMessage: 'Failed to fetch financial statements from Alpha Vantage',
      timeoutMessage: 'Alpha Vantage API is not responding',
      rateLimitMessage: 'Alpha Vantage API rate limit reached. Please try again later.',
    });
  }
}

app.http('statements', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'statements',
  handler: statementsHandler,
});
