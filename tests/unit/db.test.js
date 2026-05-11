import { describe, it, expect, afterAll } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

describe('db', () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const defaultDb = join(dataDir, 'app.db');

  afterAll(() => {
    // Clean up default db created during tests
    try {
      if (existsSync(defaultDb)) {
        rmSync(defaultDb);
      }
      // Remove data dir if empty
      if (existsSync(dataDir)) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
      }
    } catch {}
  });

  describe('initDb()', () => {
    it('creates data directory if it does not exist', () => {
      const tmpDir = join(tmpdir(), 'demo1-test-' + Date.now());
      const dbPath = join(tmpDir, 'nested', 'data', 'test.db');

      try {
        const db = initDb(dbPath);
        expect(existsSync(join(tmpDir, 'nested', 'data'))).toBe(true);
        db.close();
      } finally {
        if (existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });

    it('uses default path when dbPath is undefined (falsy branch)', () => {
      const db = initDb(undefined);
      expect(db).toBeDefined();
      expect(existsSync(defaultDb)).toBe(true);
      db.close();
    });
  });
});
