import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';

interface RateLimitInfo {
  remaining: number;
  resetTime: number;
}

function buildErrorResponse(
  status: number,
  error: string,
  message: string,
  rateLimit: RateLimitInfo,
): HttpResponseInit {
  return {
    status,
    jsonBody: { error, message },
    headers: {
      'X-RateLimit-Limit': apiRateLimiter.getMaxRequests().toString(),
      'X-RateLimit-Remaining': rateLimit.remaining.toString(),
      'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
    },
  };
}

function handleHandlerError(error: unknown, context: InvocationContext): HttpResponseInit {
  context.error('Error in statementsHandler:', error);

  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number; statusText?: string } };
    return {
      status: axiosError.response?.status ?? 502,
      jsonBody: {
        error: 'External API error',
        message: axiosError.response?.statusText ?? 'Failed to fetch financial statements from Alpha Vantage',
        status: axiosError.response?.status,
      },
    };
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const nodeError = error as { code?: string };
    if (nodeError.code === 'ECONNABORTED' || nodeError.code === 'ETIMEDOUT') {
      return {
        status: 408,
        jsonBody: { error: 'Request timeout', message: 'Alpha Vantage API is not responding' },
      };
    }
  }

  if (error instanceof Error) {
    const { message } = error;
    if (message.includes('rate limit')) {
      return {
        status: 429,
        jsonBody: {
          error: 'API rate limit exceeded',
          message: 'Alpha Vantage API rate limit reached. Please try again later.',
        },
      };
    }
    if (message.includes('not set')) {
      return {
        status: 500,
        jsonBody: {
          error: 'Configuration error',
          message: 'ALPHAVANTAGE_API_KEY environment variable is not configured',
        },
      };
    }
    if (message.includes('Invalid')) {
      return { status: 400, jsonBody: { error: 'Invalid request', message } };
    }
    return { status: 500, jsonBody: { error: 'Internal server error', message } };
  }

  return {
    status: 500,
    jsonBody: {
      error: 'Internal server error',
      message: 'An unexpected error occurred while fetching financial statements',
    },
  };
}

export async function statementsHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger GetStatements launched');

  try {
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
    const rateLimit = apiRateLimiter.isAllowed(clientIp);

    if (!rateLimit.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
        },
        headers: {
          'X-RateLimit-Limit': apiRateLimiter.getMaxRequests().toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
          'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
        },
      };
    }

    const ticker = request.query.get('ticker');
    if (!ticker) {
      return buildErrorResponse(
        400,
        'Missing required parameter: ticker',
        'Please provide a ticker symbol using the ticker query parameter (e.g., ?ticker=IBM)',
        rateLimit,
      );
    }

    const period = request.query.get('period');
    if (period && !['yearly', 'quarterly'].includes(period)) {
      return buildErrorResponse(
        400,
        'Invalid parameter: period',
        'Period must be either "yearly" or "quarterly". If not specified, both periods are returned.',
        rateLimit,
      );
    }

    const limitParam = request.query.get('limitStatements');
    let limitStatements: number | undefined;
    if (limitParam) {
      limitStatements = Number.parseInt(limitParam, 10);
      if (Number.isNaN(limitStatements) || limitStatements < 1 || limitStatements > 100) {
        return buildErrorResponse(
          400,
          'Invalid parameter: limitStatements',
          'limitStatements must be a positive integer between 1 and 100.',
          rateLimit,
        );
      }
    }

    const fieldsParam = request.query.get('fields');
    const fields = fieldsParam
      ? fieldsParam
          .split('|')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : undefined;

    const { alphaVantageService } = getServiceContainer();
    const validation = alphaVantageService.validateTicker(ticker);
    if (!validation.isValid) {
      return buildErrorResponse(400, 'Invalid ticker parameter', validation.error!, rateLimit);
    }

    const response = await alphaVantageService.getFinancialStatements(
      ticker,
      period as 'yearly' | 'quarterly' | undefined,
      limitStatements,
      fields && fields.length > 0 ? fields : undefined,
      context,
    );

    const responseBody: Record<string, unknown> = { symbol: response.symbol };
    if (response.annualReports.length > 0) responseBody.annualReports = response.annualReports;
    if (response.quarterlyReports.length > 0) responseBody.quarterlyReports = response.quarterlyReports;

    return {
      status: 200,
      jsonBody: responseBody,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=86400',
        'X-Cache': response.cacheStatus,
        'X-RateLimit-Limit': apiRateLimiter.getMaxRequests().toString(),
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
      },
    };
  } catch (error: unknown) {
    return handleHandlerError(error, context);
  }
}

app.http('statements', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'statements',
  handler: statementsHandler,
});
