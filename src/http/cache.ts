import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { cacheService } from '../services/cacheService';
import { computeETag } from '../utils/etag';

export interface CacheHeaderInfo {
  etag: string;
  cacheStatus?: 'HIT' | 'MISS';
  /** False for 304 responses, which carry no body. */
  hasBody: boolean;
}

export interface CachedJsonOptions<T> {
  request: HttpRequest;
  context: InvocationContext;
  cacheKey: string;
  /** Omit to use the cache service default TTL. */
  ttlMs?: number;
  headers: (info: CacheHeaderInfo) => Record<string, string>;
  fetch: () => Promise<T>;
}

/**
 * Serves a JSON payload through the cache with ETag/304 support.
 *
 * Flow: cache hit -> compare ETag -> 304 or HIT response; cache miss ->
 * fetch upstream, store, then compare ETag before returning a MISS response.
 */
export async function respondWithCache<T>(options: CachedJsonOptions<T>): Promise<HttpResponseInit> {
  const { request, context, cacheKey, ttlMs, headers, fetch } = options;
  const incomingEtag = request.headers.get('If-None-Match');

  const cached = cacheService.get<T>(cacheKey);
  if (cached) {
    const etag = computeETag(cached);
    if (incomingEtag === etag) {
      context.log(`ETag match for ${cacheKey}, returning 304`);
      return { status: 304, headers: headers({ etag, hasBody: false }) };
    }

    context.log(`Cache hit for ${cacheKey}`);
    return { jsonBody: cached, headers: headers({ etag, cacheStatus: 'HIT', hasBody: true }) };
  }

  const data = await fetch();

  if (ttlMs === undefined) {
    cacheService.set(cacheKey, data);
  } else {
    cacheService.set(cacheKey, data, ttlMs);
  }
  context.log(`Cache stored for ${cacheKey}`);

  const etag = computeETag(data);
  if (incomingEtag === etag) {
    context.log(`ETag match for ${cacheKey}, returning 304`);
    return { status: 304, headers: headers({ etag, hasBody: false }) };
  }

  return { jsonBody: data, headers: headers({ etag, cacheStatus: 'MISS', hasBody: true }) };
}
