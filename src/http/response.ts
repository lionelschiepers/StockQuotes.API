import type { RateLimiterLike, RateLimitResult } from '../services/rateLimiter';
import { rateLimitHeaders } from './rateLimit';

export const JSON_CONTENT_TYPE = 'application/json';

export interface ResponseHeaderOptions {
  limiter: RateLimiterLike;
  rateLimit: RateLimitResult;
  maxAgeSeconds: number;
  etag?: string;
  cacheStatus?: 'HIT' | 'MISS';
  contentType?: string;
}

/** Builds the common CORS, caching and rate-limit response headers. */
export function buildHeaders(options: ResponseHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': `max-age=${options.maxAgeSeconds}`,
    ...rateLimitHeaders(options.limiter, options.rateLimit),
  };

  if (options.etag) {
    headers.ETag = options.etag;
  }
  if (options.cacheStatus) {
    headers['X-Cache'] = options.cacheStatus;
  }
  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  }

  return headers;
}
