import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';

export async function statementsHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger GetStatements launched');

  try {
    // Extract client IP for rate limiting
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    // Apply rate limiting (100 requests per minute like exchange-rate-ecb)
    const rateLimitResult = apiRateLimiter.isAllowed(clientIp);

    if (!rateLimitResult.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        },
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString(),
        },
      };
    }

    // Extract and validate ticker parameter
    const ticker = request.query.get('ticker');

    if (!ticker) {
      return {
        status: 400,
        jsonBody: {
          error: 'Missing required parameter: ticker',
          message: 'Please provide a ticker symbol using the ticker query parameter (e.g., ?ticker=IBM)',
        },
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
        },
      };
    }

    // Extract and validate period parameter
    const period = request.query.get('period');
    const validPeriods = ['yearly', 'quarterly'];

    if (period && !validPeriods.includes(period)) {
      return {
        status: 400,
        jsonBody: {
          error: 'Invalid parameter: period',
          message: 'Period must be either "yearly" or "quarterly". If not specified, both periods are returned.',
        },
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
        },
      };
    }

    // Extract and validate limitStatements parameter
    const limitStatementsParam = request.query.get('limitStatements');
    let limitStatements: number | undefined;

    if (limitStatementsParam) {
      limitStatements = parseInt(limitStatementsParam, 10);
      if (isNaN(limitStatements) || limitStatements < 1 || limitStatements > 100) {
        return {
          status: 400,
          jsonBody: {
            error: 'Invalid parameter: limitStatements',
            message: 'limitStatements must be a positive integer between 1 and 100.',
          },
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
          },
        };
      }
    }

    // Get services from container
    const { alphaVantageService } = getServiceContainer();

    // Validate ticker using service
    const validation = alphaVantageService.validateTicker(ticker);
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: {
          error: 'Invalid ticker parameter',
          message: validation.error,
        },
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
        },
      };
    }

    // Fetch financial statements with period filter and statement limit
    const response = await alphaVantageService.getFinancialStatements(
      ticker,
      period as 'yearly' | 'quarterly' | undefined,
      limitStatements,
      context,
    );

    // Build response body based on period filter
    const responseBody: Record<string, unknown> = {
      symbol: response.symbol,
    };

    // Only include reports if they exist (non-empty arrays)
    if (response.annualReports.length > 0) {
      responseBody.annualReports = response.annualReports;
    }
    if (response.quarterlyReports.length > 0) {
      responseBody.quarterlyReports = response.quarterlyReports;
    }

    // Return successful response with cache status header
    return {
      status: 200,
      jsonBody: responseBody,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=86400', // 24 hours since data doesn't change frequently
        'X-Cache': response.cacheStatus,
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
      },
    };
  } catch (error: unknown) {
    context.error('Error in statementsHandler:', error);

    // Handle different error types
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { status?: number; statusText?: string } };
      // External API error
      return {
        status: axiosError.response?.status || 502,
        jsonBody: {
          error: 'External API error',
          message: axiosError.response?.statusText || 'Failed to fetch financial statements from Alpha Vantage',
          status: axiosError.response?.status,
        },
      };
    } else if (error && typeof error === 'object' && 'code' in error) {
      const nodeError = error as { code?: string };
      if (nodeError.code === 'ECONNABORTED' || nodeError.code === 'ETIMEDOUT') {
        // Timeout error
        return {
          status: 408,
          jsonBody: { error: 'Request timeout', message: 'Alpha Vantage API is not responding' },
        };
      }
    }

    // Handle Alpha Vantage specific errors
    if (error instanceof Error) {
      const errorMessage = error.message;

      if (errorMessage.includes('rate limit')) {
        return {
          status: 429,
          jsonBody: {
            error: 'API rate limit exceeded',
            message: 'Alpha Vantage API rate limit reached. Please try again later.',
          },
        };
      }

      if (errorMessage.includes('not set')) {
        return {
          status: 500,
          jsonBody: {
            error: 'Configuration error',
            message: 'ALPHAVANTAGE_API_KEY environment variable is not configured',
          },
        };
      }

      if (errorMessage.includes('Invalid')) {
        return {
          status: 400,
          jsonBody: {
            error: 'Invalid request',
            message: errorMessage,
          },
        };
      }

      // Default internal server error with message
      return {
        status: 500,
        jsonBody: {
          error: 'Internal server error',
          message: errorMessage,
        },
      };
    }

    // Default internal server error
    return {
      status: 500,
      jsonBody: {
        error: 'Internal server error',
        message: 'An unexpected error occurred while fetching financial statements',
      },
    };
  }
}

app.http('statements', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'statements',
  handler: statementsHandler,
});
