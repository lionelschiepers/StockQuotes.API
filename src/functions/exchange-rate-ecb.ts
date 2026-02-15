import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { exchangeRateService } from '../services/exchangeRateService';
import { apiRateLimiter } from '../services/rateLimiter';

export async function exchangeRateEcbHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger GetExchangeRates launched');

  try {
    // Extract client IP for rate limiting
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';

    // Apply rate limiting
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
          'X-RateLimit-Limit': apiRateLimiter.getMaxRequests().toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString(),
        },
      };
    }

    // Validate request using service
    const validation = exchangeRateService.validateRequest();
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error },
      };
    }

    const response = await exchangeRateService.getDailyRates(context);

    return {
      status: 200,
      body: response.data,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.contentType,
        'Cache-Control': 'max-age=3600',
        'X-RateLimit-Limit': apiRateLimiter.getMaxRequests().toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString(),
      },
    };
  } catch (error: unknown) {
    context.error('Error in exchangeRateEcbHandler:', error);

    // Handle different error types
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { status?: number; statusText?: string } };
      // External API error
      return {
        status: axiosError.response?.status ?? 502,
        jsonBody: {
          error: 'External API error',
          message: axiosError.response?.statusText ?? 'Failed to fetch exchange rates',
          status: axiosError.response?.status,
        },
      };
    } else if (error && typeof error === 'object' && 'code' in error) {
      const nodeError = error as { code?: string };
      if (nodeError.code === 'ECONNABORTED' || nodeError.code === 'ETIMEDOUT') {
        // Timeout error
        return {
          status: 408,
          jsonBody: { error: 'Request timeout', message: 'ECB service is not responding' },
        };
      }
    }

    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred while fetching exchange rates';
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

app.http('exchange-rate-ecb', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: exchangeRateEcbHandler,
});
