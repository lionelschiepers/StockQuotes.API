// Simple in-memory rate limiter for Azure Functions
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export interface RateLimiterLike {
  getMaxRequests(): number;
  isAllowed(identifier: string): RateLimitResult;
}

export class RateLimiter implements RateLimiterLike {
  private readonly requests: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxTrackedClients: number;

  constructor(windowMs: number = 5000, maxRequests: number = 100, maxTrackedClients: number = 10_000) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.maxTrackedClients = maxTrackedClients;

    // Clean up expired entries every minute
    const cleanupInterval = setInterval(() => this.cleanup(), 60000);
    cleanupInterval.unref();
  }

  getMaxRequests(): number {
    return this.maxRequests;
  }

  isAllowed(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now > entry.resetTime) {
      // New entry or expired window
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      this.evictIfFull();
      this.requests.set(identifier, newEntry);

      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: newEntry.resetTime,
      };
    }

    // Existing entry within window
    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
      };
    }

    // Increment count
    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetTime: entry.resetTime,
    };
  }

  /**
   * Bounds memory when clients are keyed by attacker-controlled headers:
   * drop expired entries first, then the oldest tracked client.
   */
  private evictIfFull(): void {
    if (this.requests.size < this.maxTrackedClients) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }

    while (this.requests.size >= this.maxTrackedClients) {
      const oldestKey = this.requests.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.requests.delete(oldestKey);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

// Export singleton instances with different limits
export const apiRateLimiter = new RateLimiter(1000, 10); // 10 requests per second
export const strictRateLimiter = new RateLimiter(1000, 4); // 4 requests per second for heavy endpoints
