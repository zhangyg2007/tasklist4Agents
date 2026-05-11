import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { sendCallback, getCallbackStatus, retryFailedCallbacks } from '../../src/controllers/webhook.js';

describe('webhook', () => {
  let db;
  let userId;
  let originalFetch;

  beforeEach(() => {
    db = initDb(':memory:');
    originalFetch = global.fetch;
    userId = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('wh-user','tok-wh','human')"
    ).run().lastInsertRowid;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('sendCallback()', () => {
    it('does nothing when task does not exist', () => {
      expect(() => sendCallback(db, 99999, 'http://hook.local')).not.toThrow();
    });

    it('sends POST to callback URL and updates status on success', async () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('CB Task', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT OR IGNORE INTO callback_queue (task_id, url) VALUES (?, ?)"
      ).run(taskId, 'http://hook.local');

      let fetchUrl;
      let fetchBody;
      global.fetch = (url, opts) => {
        fetchUrl = url;
        fetchBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, statusText: 'OK' });
      };

      sendCallback(db, taskId, 'http://hook.local');
      await new Promise(r => setTimeout(r, 50));

      expect(fetchUrl).toBe('http://hook.local');
      expect(fetchBody.task_id).toBe(taskId);
      expect(fetchBody.status).toBe('in_progress');

      const status = getCallbackStatus(db, taskId);
      expect(status.status).toBe('sent');
    });

    it('updates status to failed on HTTP error', async () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('CB Fail', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT OR IGNORE INTO callback_queue (task_id, url) VALUES (?, ?)"
      ).run(taskId, 'http://hook.local');

      global.fetch = () => Promise.resolve({ ok: false, statusText: 'Not Found' });

      sendCallback(db, taskId, 'http://hook.local');
      await new Promise(r => setTimeout(r, 50));

      const status = getCallbackStatus(db, taskId);
      expect(status.status).toBe('failed');
      expect(status.last_error).toBe('Not Found');
    });

    it('updates status to failed on network error', async () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('CB Net Fail', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT OR IGNORE INTO callback_queue (task_id, url) VALUES (?, ?)"
      ).run(taskId, 'http://hook.local');

      global.fetch = () => Promise.reject(new Error('Network error'));

      sendCallback(db, taskId, 'http://hook.local');
      await new Promise(r => setTimeout(r, 50));

      const status = getCallbackStatus(db, taskId);
      expect(status.status).toBe('failed');
      expect(status.last_error).toBe('Network error');
    });
  });

  describe('getCallbackStatus()', () => {
    it('returns undefined when no callback entry exists', () => {
      const result = getCallbackStatus(db, 99999);
      expect(result).toBeUndefined();
    });

    it('returns the latest callback status entry', () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('CB Status', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT INTO callback_queue (task_id, url, status) VALUES (?, ?, ?)"
      ).run(taskId, 'http://hook.local', 'pending');

      const result = getCallbackStatus(db, taskId);
      expect(result.task_id).toBe(taskId);
      expect(result.status).toBe('pending');
    });
  });

  describe('retryFailedCallbacks()', () => {
    it('retries failed callbacks with less than 3 retries', async () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('Retry Task', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT INTO callback_queue (task_id, url, status, retries) VALUES (?, ?, 'failed', 1)"
      ).run(taskId, 'http://hook.local');

      let fetchCalled = 0;
      global.fetch = () => {
        fetchCalled++;
        return Promise.resolve({ ok: true, statusText: 'OK' });
      };

      retryFailedCallbacks(db);
      await new Promise(r => setTimeout(r, 50));

      expect(fetchCalled).toBe(1);
    });

    it('does not retry callbacks with 3 or more retries', () => {
      const taskId = db.prepare(
        "INSERT INTO tasks (title, user_id, status) VALUES (?, ?, ?)"
      ).run('Max Retry', userId, 'in_progress').lastInsertRowid;

      db.prepare(
        "INSERT INTO callback_queue (task_id, url, status, retries) VALUES (?, ?, 'failed', 3)"
      ).run(taskId, 'http://hook.local');

      let fetchCalled = 0;
      global.fetch = () => { fetchCalled++; return Promise.resolve({ ok: true }); };

      retryFailedCallbacks(db);
      expect(fetchCalled).toBe(0);
    });

    it('does nothing when no failed callbacks exist', () => {
      expect(() => retryFailedCallbacks(db)).not.toThrow();
    });
  });
});
