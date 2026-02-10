import * as fs from 'fs';
import * as path from 'path';

// In-memory cache service with TTL support and optional disk persistence
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache: Map<string, CacheEntry<any>>;
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  private readonly persistenceEnabled: boolean;
  private readonly cacheDir: string;

  constructor() {
    this.cache = new Map();
    const ttlSeconds = parseInt(process.env.CACHE_TTL_SECONDS ?? '86400', 10);
    this.ttlMs = ttlSeconds * 1000;
    this.enabled = process.env.CACHE_ENABLED !== 'false';
    this.persistenceEnabled = process.env.CACHE_PERSISTENCE_ENABLED === 'true';
    this.cacheDir = process.env.CACHE_DIR ?? path.join(process.cwd(), '.cache');

    if (this.enabled && this.persistenceEnabled) {
      this.ensureCacheDir();
    }

    // Clean up expired entries every hour
    if (this.enabled) {
      const cleanupInterval = setInterval(() => this.cleanup(), 3600000);
      cleanupInterval.unref();
    }
  }

  private ensureCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (error) {
      console.error(`Failed to create cache directory: ${this.cacheDir}`, error);
    }
  }

  private getCacheFilePath(key: string): string {
    const sanitizedKey = key.replace(/[:|]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.cacheDir, `${sanitizedKey}.json`);
  }

  get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    // Try in-memory first
    let entry = this.cache.get(key);

    // Try disk if not in-memory and persistence is enabled
    if (!entry && this.persistenceEnabled) {
      const filePath = this.getCacheFilePath(key);
      try {
        if (fs.existsSync(filePath)) {
          const fileData = fs.readFileSync(filePath, 'utf8');
          entry = JSON.parse(fileData);
          if (entry) {
            // Check if disk entry is expired before putting in memory
            const now = Date.now();
            if (now > entry.timestamp + this.ttlMs) {
              this.deleteDiskEntry(key);
              return null;
            }
            // Put back into memory
            this.cache.set(key, entry);
          }
        }
      } catch {
        // Ignore read errors, treat as miss
        return null;
      }
    }

    if (!entry) {
      return null;
    }

    if (this.isExpired(key)) {
      this.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) {
      return;
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };

    // Set in memory
    this.cache.set(key, entry);

    // Persist to disk if enabled
    if (this.persistenceEnabled) {
      try {
        const filePath = this.getCacheFilePath(key);
        fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
      } catch {
        // Ignore write errors
      }
    }
  }

  clear(): void {
    this.cache.clear();
    if (this.persistenceEnabled && fs.existsSync(this.cacheDir)) {
      try {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.cacheDir, file));
          }
        }
      } catch {
        // Ignore clear errors
      }
    }
  }

  has(key: string): boolean {
    if (!this.enabled) {
      return false;
    }

    if (this.cache.has(key)) {
      return !this.isExpired(key);
    }

    if (this.persistenceEnabled) {
      const filePath = this.getCacheFilePath(key);
      if (fs.existsSync(filePath)) {
        // We could read it to check expiry, or just return true and let get() handle it
        // For has(), we'll check expiry to be accurate
        try {
          const fileData = fs.readFileSync(filePath, 'utf8');
          const entry = JSON.parse(fileData);
          const now = Date.now();
          if (now <= entry.timestamp + this.ttlMs) {
            return true;
          }
          this.deleteDiskEntry(key);
        } catch {
          return false;
        }
      }
    }

    return false;
  }

  isExpired(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      // If not in memory, we don't check disk here (has() or get() should have loaded it)
      return true;
    }

    const now = Date.now();
    return now > entry.timestamp + this.ttlMs;
  }

  private delete(key: string): void {
    this.cache.delete(key);
    this.deleteDiskEntry(key);
  }

  private deleteDiskEntry(key: string): void {
    if (this.persistenceEnabled) {
      const filePath = this.getCacheFilePath(key);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore delete errors
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();

    // Cleanup memory
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + this.ttlMs) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.delete(key);
    }

    // Cleanup disk (optional, could be expensive if many files)
    if (this.persistenceEnabled && fs.existsSync(this.cacheDir)) {
      try {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(this.cacheDir, file);
            const stats = fs.statSync(filePath);
            // This is a bit of a heuristic since we'd need to parse JSON to get exact timestamp
            // but file mtime is a good proxy
            if (now > stats.mtimeMs + this.ttlMs) {
              fs.unlinkSync(filePath);
            }
          }
        }
      } catch {
        // Ignore disk cleanup errors
      }
    }
  }
}
// Export singleton instance
export const cacheService = new CacheService();
