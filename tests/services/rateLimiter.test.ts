import { RateLimiter } from '../../src/services/rateLimiter';

describe('RateLimiter', () => {
  it('allows requests up to the limit within a window', () => {
    const limiter = new RateLimiter(1000, 3);

    expect(limiter.isAllowed('client')).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.isAllowed('client')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.isAllowed('client')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.isAllowed('client')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('tracks clients independently', () => {
    const limiter = new RateLimiter(1000, 1);

    expect(limiter.isAllowed('a').allowed).toBe(true);
    expect(limiter.isAllowed('b').allowed).toBe(true);
    expect(limiter.isAllowed('a').allowed).toBe(false);
  });

  it('resets the window once it elapses', async () => {
    const limiter = new RateLimiter(20, 1);

    expect(limiter.isAllowed('client').allowed).toBe(true);
    expect(limiter.isAllowed('client').allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(limiter.isAllowed('client').allowed).toBe(true);
  });

  it('evicts the oldest client when the tracking cap is reached', () => {
    const limiter = new RateLimiter(1000, 5, 2);

    expect(limiter.isAllowed('a').allowed).toBe(true);
    expect(limiter.isAllowed('b').allowed).toBe(true);

    // Cap reached: 'a' is evicted before 'c' is recorded.
    expect(limiter.isAllowed('c').allowed).toBe(true);

    // 'a' is treated as a brand-new client again.
    expect(limiter.isAllowed('a')).toMatchObject({ allowed: true, remaining: 4 });
  });
});
