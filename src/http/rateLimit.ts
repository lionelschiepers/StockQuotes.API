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
 * Extracts the caller's IP from the proxy headers.
 *
 * `x-forwarded-for` is a comma-separated chain (`client, proxy1, proxy2`);
 * only the left-most entry identifies the client. Using the raw header would
 * let a caller mint unlimited rate-limit buckets.
 */
export function getClientIp(request: HttpRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstHop] = forwardedFor.split(',');
    const clientIp = firstHop?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Applies the rate limiter for the calling client. On rejection the returned
 * `response` is a complete 429 payload ready to be returned by the handler.
 */
export function enforceRateLimit(request: HttpRequest, limiter: RateLimiterLike): RateLimitCheck {
  const clientIp = getClientIp(request);
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
