import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { getServiceContainer } from '../di/container';
import { apiRateLimiter } from '../services/rateLimiter';
import { mapErrorToResponse } from '../http/errors';
import { enforceRateLimit } from '../http/rateLimit';
import { buildHeaders } from '../http/response';

const CACHE_MAX_AGE_SECONDS = 3600;

export async function exchangeRateEcbHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('HTTP trigger GetExchangeRates launched');

  try {
    const rateLimit = enforceRateLimit(request, apiRateLimiter);
    if (!rateLimit.allowed) {
      return rateLimit.response;
    }

    const { exchangeRateService } = getServiceContainer();
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
      headers: buildHeaders({
        limiter: apiRateLimiter,
        rateLimit: rateLimit.result,
        maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
        contentType: response.contentType,
      }),
    };
  } catch (error: unknown) {
    return mapErrorToResponse(error, context, {
      logLabel: 'Error in exchangeRateEcbHandler:',
      fallbackMessage: 'An unexpected error occurred while fetching exchange rates',
      upstreamMessage: 'Failed to fetch exchange rates',
      timeoutMessage: 'ECB service is not responding',
      rateLimitMessage: 'Exchange rate service rate limit exceeded. Please try again later.',
    });
  }
}

app.http('exchange-rate-ecb', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: exchangeRateEcbHandler,
});
