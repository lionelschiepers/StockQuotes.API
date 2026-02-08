// In-memory cache service with TTL support
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache: Map<string, CacheEntry<any>>;
  private readonly ttlMs: number;
  private readonly enabled: boolean;

  constructor() {
    this.cache = new Map();
    const ttlSeconds = parseInt(process.env.CACHE_TTL_SECONDS ?? '86400', 10);
    this.ttlMs = ttlSeconds * 1000;
    this.enabled = process.env.CACHE_ENABLED !== 'false';

    // Clean up expired entries every hour
    if (this.enabled) {
      const cleanupInterval = setInterval(() => this.cleanup(), 3600000);
      cleanupInterval.unref();
    }
  }

  get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (this.isExpired(key)) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) {
      return;
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    if (!this.enabled) {
      return false;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(key)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  isExpired(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return true;
    }

    const now = Date.now();
    return now > entry.timestamp + this.ttlMs;
  }

  private cleanup(): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (Date.now() > entry.timestamp + this.ttlMs) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();
