import { CacheService } from '../../src/services/cacheService';

describe('CacheService', () => {
  let cacheService: CacheService;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    jest.resetModules();
    process.env = { ...originalEnv };

    // Create a fresh instance for each test
    cacheService = new CacheService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('get and set operations', () => {
    it('should store and retrieve data', () => {
      const key = 'test-key';
      const data = { foo: 'bar', num: 123 };

      cacheService.set(key, data);
      const result = cacheService.get(key);

      expect(result).toEqual(data);
    });

    it('should return null for non-existent key', () => {
      const result = cacheService.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle multiple keys independently', () => {
      cacheService.set('independent-key-1', 'value1');
      cacheService.set('independent-key-2', 'value2');

      expect(cacheService.get('independent-key-1')).toBe('value1');
      expect(cacheService.get('independent-key-2')).toBe('value2');
    });

    it('should overwrite existing key', () => {
      const key = 'test-key';
      cacheService.set(key, 'initial-value');
      cacheService.set(key, 'updated-value');

      expect(cacheService.get(key)).toBe('updated-value');
    });
  });

  describe('has operation', () => {
    it('should return true for existing key', () => {
      cacheService.set('test-key', 'value');
      expect(cacheService.has('test-key')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cacheService.has('non-existent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      // Set very short TTL
      process.env.CACHE_TTL_SECONDS = '0';
      cacheService = new CacheService();

      cacheService.set('expiring-key', 'value');

      // Wait a bit for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cacheService.has('expiring-key')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should return null for expired entries', async () => {
      // Set very short TTL
      process.env.CACHE_TTL_SECONDS = '0';
      cacheService = new CacheService();

      cacheService.set('expiring-key', 'value');

      // Wait a bit for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = cacheService.get('expiring-key');
      expect(result).toBeNull();
    });

    it('should respect custom TTL from environment', () => {
      process.env.CACHE_TTL_SECONDS = '3600'; // 1 hour
      cacheService = new CacheService();

      cacheService.set('key', 'value');

      // Should not be expired immediately
      expect(cacheService.isExpired('key')).toBe(false);
      expect(cacheService.has('key')).toBe(true);
    });

    it('should use default TTL of 24 hours when not specified', () => {
      delete process.env.CACHE_TTL_SECONDS;
      cacheService = new CacheService();

      cacheService.set('key', 'value');

      // Should not be expired immediately
      expect(cacheService.isExpired('key')).toBe(false);
    });
  });

  describe('clear operation', () => {
    it('should remove all entries', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      cacheService.set('key3', 'value3');

      cacheService.clear();

      expect(cacheService.get('key1')).toBeNull();
      expect(cacheService.get('key2')).toBeNull();
      expect(cacheService.get('key3')).toBeNull();
      expect(cacheService.has('key1')).toBe(false);
    });

    it('should work on empty cache', () => {
      expect(() => cacheService.clear()).not.toThrow();
    });
  });

  describe('isExpired operation', () => {
    it('should return true for non-existent key', () => {
      expect(cacheService.isExpired('non-existent')).toBe(true);
    });

    it('should return false for fresh entries', () => {
      cacheService.set('fresh-key', 'value');
      expect(cacheService.isExpired('fresh-key')).toBe(false);
    });
  });

  describe('disabled cache', () => {
    it('should not store data when disabled', () => {
      process.env.CACHE_ENABLED = 'false';
      cacheService = new CacheService();

      cacheService.set('key', 'value');

      expect(cacheService.get('key')).toBeNull();
      expect(cacheService.has('key')).toBe(false);
    });

    it('should return null on get when disabled', () => {
      process.env.CACHE_ENABLED = 'false';
      cacheService = new CacheService();

      expect(cacheService.get('any-key')).toBeNull();
    });

    it('should return false on has when disabled', () => {
      process.env.CACHE_ENABLED = 'false';
      cacheService = new CacheService();

      expect(cacheService.has('any-key')).toBe(false);
    });
  });

  describe('complex data types', () => {
    it('should handle objects', () => {
      const complexObject = {
        nested: { array: [1, 2, 3], object: { a: 'b' } },
        date: new Date('2024-01-01'),
        number: 123.45,
      };

      cacheService.set('complex', complexObject);
      const result = cacheService.get('complex');

      expect(result).toEqual(complexObject);
    });

    it('should handle arrays', () => {
      const array = [{ id: 1 }, { id: 2 }, { id: 3 }];

      cacheService.set('array-key', array);
      const result = cacheService.get('array-key');

      expect(result).toEqual(array);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle null and undefined values', () => {
      cacheService.set('null-key', null);
      cacheService.set('undefined-key', undefined);

      expect(cacheService.get('null-key')).toBeNull();
      expect(cacheService.get('undefined-key')).toBeUndefined();
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent reads and writes', async () => {
      const operations: Array<Promise<void>> = [];

      // Concurrent writes
      for (let i = 0; i < 100; i++) {
        operations.push(Promise.resolve(cacheService.set(`key-${i}`, `value-${i}`)));
      }

      // Concurrent reads
      for (let i = 0; i < 100; i++) {
        operations.push(
          Promise.resolve().then(() => {
            cacheService.get(`key-${i}`);
          }),
        );
      }

      await expect(Promise.all(operations)).resolves.not.toThrow();
    });

    it('should maintain data integrity with concurrent access', async () => {
      const key = 'shared-key';

      // Write different values concurrently
      const writePromises = [
        Promise.resolve(cacheService.set(key, 'value-1')),
        Promise.resolve(cacheService.set(key, 'value-2')),
        Promise.resolve(cacheService.set(key, 'value-3')),
      ];

      await Promise.all(writePromises);

      // Read should return one of the values (last write wins)
      const result = cacheService.get(key);
      expect(['value-1', 'value-2', 'value-3']).toContain(result);
    });
  });
});
