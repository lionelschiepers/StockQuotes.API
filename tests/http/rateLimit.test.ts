import type { HttpRequest } from '@azure/functions';
import { enforceRateLimit, getClientIp } from '../../src/http/rateLimit';
import type { RateLimiterLike } from '../../src/services/rateLimiter';

function mockRequest(headers: Record<string, string>): HttpRequest {
  return { headers: new Headers(headers) } as unknown as HttpRequest;
}

describe('getClientIp', () => {
  it('uses the first hop of a comma-separated x-forwarded-for chain', () => {
    const request = mockRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' });

    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('trims whitespace around the forwarded address', () => {
    expect(getClientIp(mockRequest({ 'x-forwarded-for': '  198.51.100.7  ' }))).toBe('198.51.100.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(mockRequest({ 'x-real-ip': '192.168.1.1' }))).toBe('192.168.1.1');
  });

  it('ignores an empty x-forwarded-for value', () => {
    expect(getClientIp(mockRequest({ 'x-forwarded-for': '   ', 'x-real-ip': '192.168.1.2' }))).toBe('192.168.1.2');
  });

  it('returns "unknown" when no client headers are present', () => {
    expect(getClientIp(mockRequest({}))).toBe('unknown');
  });
});

describe('enforceRateLimit', () => {
  it('keys the limiter by the first forwarded hop', () => {
    const isAllowed = jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetTime: Date.now() + 1000 });
    const limiter: RateLimiterLike = { getMaxRequests: () => 10, isAllowed };

    const check = enforceRateLimit(mockRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), limiter);

    expect(check.allowed).toBe(true);
    expect(isAllowed).toHaveBeenCalledWith('203.0.113.5');
  });

  it('returns a 429 response when the limiter rejects the client', () => {
    const retryAt = Date.now() + 2000;
    const limiter: RateLimiterLike = {
      getMaxRequests: () => 10,
      isAllowed: () => ({ allowed: false, remaining: 0, resetTime: retryAt }),
    };

    const check = enforceRateLimit(mockRequest({}), limiter);

    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.response.status).toBe(429);
      expect(check.response.headers).toMatchObject({ 'Retry-After': expect.any(String) });
    }
  });
});
