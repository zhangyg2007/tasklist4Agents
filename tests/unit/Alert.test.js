import { describe, test, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { Alert } from '../../src/models/Alert.js';

describe('Alert', () => {
  let db, alertModel, userId, taskId;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        token TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'human',
        capabilities TEXT DEFAULT '[]',
        callback_url TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        parent_id INTEGER REFERENCES tasks(id),
        assigned_to INTEGER REFERENCES users(id),
        result TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id INTEGER REFERENCES users(id),
        error_type TEXT NOT NULL,
        error_message TEXT,
        error_detail TEXT,
        severity TEXT NOT NULL DEFAULT 'error' CHECK(severity IN ('warn','error','critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        fix_task_id INTEGER REFERENCES tasks(id),
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    userId = db.prepare("INSERT INTO users (username, token, role) VALUES ('test', 'tok', 'agent')").run().lastInsertRowid;
    taskId = db.prepare("INSERT INTO tasks (user_id, title) VALUES (?, 'test task')").run(userId).lastInsertRowid;
    alertModel = new Alert(db);
  });

  describe('create', () => {
    test('creates an alert with required fields', () => {
      const r = alertModel.create({
        taskId,
        agentId: userId,
        errorType: 'timeout',
        errorMessage: 'Request timed out'
      });
      expect(r.lastInsertRowid).toBeGreaterThan(0);

      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(r.lastInsertRowid);
      expect(alert.task_id).toBe(taskId);
      expect(alert.agent_id).toBe(userId);
      expect(alert.error_type).toBe('timeout');
      expect(alert.error_message).toBe('Request timed out');
      expect(alert.severity).toBe('error');
      expect(alert.status).toBe('open');
    });

    test('creates an alert with explicit severity', () => {
      const r = alertModel.create({
        taskId,
        agentId: userId,
        errorType: 'crash',
        errorMessage: 'Process crashed',
        severity: 'critical'
      });
      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(r.lastInsertRowid);
      expect(alert.severity).toBe('critical');
    });

    test('creates an alert without agent_id (system alert)', () => {
      const r = alertModel.create({
        taskId,
        agentId: null,
        errorType: 'system',
        errorMessage: 'System error'
      });
      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(r.lastInsertRowid);
      expect(alert.agent_id).toBeNull();
    });

    test('rejects invalid severity', () => {
      expect(() => alertModel.create({
        taskId,
        agentId: userId,
        errorType: 'test',
        errorMessage: 'msg',
        severity: 'invalid'
      })).toThrow();
    });
  });

  describe('findById', () => {
    test('returns alert by id', () => {
      const r = alertModel.create({ taskId, agentId: userId, errorType: '500', errorMessage: 'Server error' });
      const alert = alertModel.findById(r.lastInsertRowid);
      expect(alert.error_type).toBe('500');
    });

    test('returns undefined for non-existent alert', () => {
      expect(alertModel.findById(999)).toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      alertModel.create({ taskId, agentId: userId, errorType: '404', errorMessage: 'Not found', severity: 'warn' });
      alertModel.create({ taskId, agentId: userId, errorType: '500', errorMessage: 'Server error', severity: 'error' });
      alertModel.create({ taskId, agentId: userId, errorType: 'crash', errorMessage: 'Crash', severity: 'critical' });
    });

    test('lists all alerts with pagination', () => {
      const r = alertModel.list({ page: 1, limit: 10 });
      expect(r.rows).toHaveLength(3);
      expect(r.total).toBe(3);
    });

    test('filters by status', () => {
      db.prepare("UPDATE alerts SET status = 'acknowledged' WHERE error_type = '404'").run();
      const r = alertModel.list({ filters: { status: 'open' } });
      expect(r.rows).toHaveLength(2);
    });

    test('filters by severity', () => {
      const r = alertModel.list({ filters: { severity: 'critical' } });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].error_type).toBe('crash');
    });

    test('filters by task_id', () => {
      const task2Id = db.prepare("INSERT INTO tasks (user_id, title) VALUES (?, 'task2')").run(userId).lastInsertRowid;
      alertModel.create({ taskId: task2Id, agentId: userId, errorType: 'test', errorMessage: 'test' });
      const r = alertModel.list({ filters: { task_id: taskId } });
      expect(r.rows).toHaveLength(3);
    });

    test('filters by agent_id', () => {
      const user2Id = db.prepare("INSERT INTO users (username, token, role) VALUES ('agent2', 'tok2', 'agent')").run().lastInsertRowid;
      alertModel.create({ taskId, agentId: user2Id, errorType: 'test', errorMessage: 'test' });
      const r = alertModel.list({ filters: { agent_id: userId } });
      expect(r.rows).toHaveLength(3);
    });

    test('paginates correctly', () => {
      const r = alertModel.list({ page: 1, limit: 2 });
      expect(r.rows).toHaveLength(2);
      expect(r.total).toBe(3);
      expect(r.page).toBe(1);
    });
  });

  describe('update', () => {
    test('updates alert status', () => {
      const r = alertModel.create({ taskId, agentId: userId, errorType: 'timeout', errorMessage: 'Timeout' });
      alertModel.update(r.lastInsertRowid, { status: 'acknowledged' });
      const alert = alertModel.findById(r.lastInsertRowid);
      expect(alert.status).toBe('acknowledged');
    });

    test('links fix_task_id', () => {
      const r = alertModel.create({ taskId, agentId: userId, errorType: 'timeout', errorMessage: 'Timeout' });
      const fixTaskId = db.prepare("INSERT INTO tasks (user_id, title, parent_id) VALUES (?, 'fix', ?)").run(userId, taskId).lastInsertRowid;
      alertModel.update(r.lastInsertRowid, { status: 'resolved', fix_task_id: fixTaskId });
      const alert = alertModel.findById(r.lastInsertRowid);
      expect(alert.status).toBe('resolved');
      expect(alert.fix_task_id).toBe(fixTaskId);
    });

    test('returns 0 changes for empty fields', () => {
      const r = alertModel.create({ taskId, agentId: userId, errorType: 'test', errorMessage: 'test' });
      const result = alertModel.update(r.lastInsertRowid, {});
      expect(result.changes).toBe(0);
    });
  });

  describe('countByStatus', () => {
    test('returns count of open alerts', () => {
      alertModel.create({ taskId, agentId: userId, errorType: 'a', errorMessage: 'a' });
      alertModel.create({ taskId, agentId: userId, errorType: 'b', errorMessage: 'b' });
      db.prepare("UPDATE alerts SET status = 'resolved' WHERE error_type = 'a'").run();
      expect(alertModel.countByStatus('open')).toBe(1);
    });
  });
});
