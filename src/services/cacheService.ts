import * as fs from 'node:fs';
import * as path from 'node:path';

// In-memory cache service with TTL support and optional disk persistence
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly cache: Map<string, CacheEntry<any>>;
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  private readonly persistenceEnabled: boolean;
  private readonly cacheDir: string;
  private readonly maxEntries: number;
  private readonly maxDiskEntries: number;

  constructor() {
    this.cache = new Map();
    const ttlSeconds = Number.parseInt(process.env.CACHE_TTL_SECONDS ?? '86400', 10);
    this.ttlMs = ttlSeconds * 1000;
    this.enabled = process.env.CACHE_ENABLED !== 'false';
    this.persistenceEnabled = process.env.CACHE_PERSISTENCE_ENABLED === 'true';
    this.cacheDir = process.env.CACHE_DIR ?? path.join(process.cwd(), '.cache');
    this.maxEntries = this.parsePositiveInt(process.env.CACHE_MAX_ENTRIES, 1000);
    this.maxDiskEntries = this.parsePositiveInt(process.env.CACHE_MAX_DISK_ENTRIES, 5000);

    if (this.enabled && this.persistenceEnabled) {
      this.ensureCacheDir();
    }

    // Clean up expired entries every hour
    if (this.enabled) {
      const cleanupInterval = setInterval(() => this.cleanup(), 3600000);
      cleanupInterval.unref();
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return fallback;
    }

    return parsed;
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
    const sanitizedKey = key.replaceAll(/[:|]/g, '-').replaceAll(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.cacheDir, `${sanitizedKey}.json`);
  }

  private loadFromDisk<T>(key: string): CacheEntry<T> | null {
    if (!this.persistenceEnabled) {
      return null;
    }
    const filePath = this.getCacheFilePath(key);
    try {
      if (fs.existsSync(filePath)) {
        const fileData = fs.readFileSync(filePath, 'utf8');
        const entry = JSON.parse(fileData) as CacheEntry<T>;
        if (entry && !this.isEntryExpired(entry)) {
          this.setInMemory(key, entry);
          return entry;
        }
        this.deleteDiskEntry(key);
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  private isEntryExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() > entry.timestamp + this.ttlMs;
  }

  get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(key) ?? this.loadFromDisk<T>(key);

    if (!entry || this.isEntryExpired(entry)) {
      if (entry) {
        this.delete(key);
      }
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

    this.setInMemory(key, entry);

    // Persist to disk if enabled
    if (this.persistenceEnabled) {
      try {
        const filePath = this.getCacheFilePath(key);
        fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
        this.enforceDiskLimit();
      } catch {
        // Ignore write errors
      }
    }
  }

  private setInMemory<T>(key: string, entry: CacheEntry<T>): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, entry);
    this.enforceMemoryLimit();
  }

  private enforceMemoryLimit(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  private enforceDiskLimit(): void {
    if (!this.persistenceEnabled || !fs.existsSync(this.cacheDir)) {
      return;
    }

    try {
      const files = fs
        .readdirSync(this.cacheDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const filePath = path.join(this.cacheDir, file);
          const stats = fs.statSync(filePath);
          return { filePath, mtimeMs: stats.mtimeMs };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs);

      const overflowCount = files.length - this.maxDiskEntries;
      if (overflowCount <= 0) {
        return;
      }

      for (let index = 0; index < overflowCount; index++) {
        fs.unlinkSync(files[index].filePath);
      }
    } catch {
      // Ignore disk limit enforcement errors
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

    const entry = this.cache.get(key) ?? this.loadFromDisk(key);
    return !!entry && !this.isEntryExpired(entry);
  }

  isExpired(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      // If not in memory, we don't check disk here (has() or get() should have loaded it)
      return true;
    }

    return this.isEntryExpired(entry);
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

  private cleanupDisk(now: number): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        return;
      }
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.cacheDir, file);
          const stats = fs.statSync(filePath);
          if (now > stats.mtimeMs + this.ttlMs) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch {
      // Ignore disk cleanup errors
    }
  }

  private cleanup(): void {
    const now = Date.now();

    // Cleanup memory
    for (const [key, entry] of this.cache.entries()) {
      if (this.isEntryExpired(entry)) {
        this.delete(key);
      }
    }

    // Cleanup disk (optional, could be expensive if many files)
    if (this.persistenceEnabled) {
      this.cleanupDisk(now);
    }
  }
}
// Export singleton instance
export const cacheService = new CacheService();
