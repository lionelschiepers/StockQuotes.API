import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { RateLimiterLike, RateLimitResult } from '../services/rateLimiter';

export type RateLimitCheck =
  { allowed: true; result: RateLimitResult } | { allowed: false; response: HttpResponseInit };

export function rateLimitHeaders(limiter: RateLimiterLike, result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': limiter.getMaxRequests().toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
  };
}

/**
 * Applies the rate limiter for the calling client. On rejection the returned
 * `response` is a complete 429 payload ready to be returned by the handler.
 */
export function enforceRateLimit(request: HttpRequest, limiter: RateLimiterLike): RateLimitCheck {
  const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const result = limiter.isAllowed(clientIp);

  if (result.allowed) {
    return { allowed: true, result };
  }

  const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
  return {
    allowed: false,
    response: {
      status: 429,
      jsonBody: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter,
      },
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        ...rateLimitHeaders(limiter, result),
        'Retry-After': retryAfter.toString(),
      },
    },
  };
}
