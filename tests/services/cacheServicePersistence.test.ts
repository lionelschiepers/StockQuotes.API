import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CacheService } from '../../src/services/cacheService';

describe('CacheService disk persistence', () => {
  let cacheDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockquotes-cache-'));
    process.env = {
      ...originalEnv,
      CACHE_ENABLED: 'true',
      CACHE_PERSISTENCE_ENABLED: 'true',
      CACHE_DIR: cacheDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('stores long keys under a fixed-length sha256 filename', () => {
    const service = new CacheService();
    const key = `quotes:${'A'.repeat(400)}:${'f'.repeat(300)}`;

    service.set(key, { ok: true });

    const files = fs.readdirSync(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${createHash('sha256').update(key).digest('hex')}.json`);
    expect(files[0]).toHaveLength(69);
  });

  it('reads persisted entries back in a fresh instance', () => {
    const key = 'quotes:AAPL:regularMarketPrice';
    new CacheService().set(key, { price: 123.45 });

    expect(new CacheService().get(key)).toEqual({ price: 123.45 });
  });

  it('prunes the disk at most once per interval', () => {
    const service = new CacheService();
    // The service wraps node:fs, so spy on the real module object.
    const realFs = jest.requireActual<typeof fs>('node:fs');
    const readdirSpy = jest.spyOn(realFs, 'readdirSync');

    service.set('a', 1);
    service.set('b', 2);
    service.set('c', 3);

    expect(readdirSpy).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    service.set('d', 4);

    expect(readdirSpy).toHaveBeenCalledTimes(2);
  });
});
