import { describe, test, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { listAlerts, getAlert, updateAlert, reportError } from '../../src/controllers/alertController.js';

function mockRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { if (res._status === null) res._status = 200; res._body = body; return res; };
  return res;
}

describe('alertController', () => {
  let db, userId, taskId, alertId, agentId;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
        token TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'human',
        capabilities TEXT DEFAULT '[]', callback_url TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        parent_id INTEGER REFERENCES tasks(id), assigned_to INTEGER REFERENCES users(id),
        result TEXT, due_date TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id INTEGER REFERENCES users(id), error_type TEXT NOT NULL, error_message TEXT, error_detail TEXT,
        severity TEXT NOT NULL DEFAULT 'error' CHECK(severity IN ('warn','error','critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        fix_task_id INTEGER REFERENCES tasks(id), created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    userId = db.prepare("INSERT INTO users (username, token, role) VALUES ('owner', 'tok1', 'human')").run().lastInsertRowid;
    agentId = db.prepare("INSERT INTO users (username, token, role) VALUES ('agent1', 'tok2', 'agent')").run().lastInsertRowid;
    taskId = db.prepare("INSERT INTO tasks (user_id, title) VALUES (?, 'test task')").run(userId).lastInsertRowid;
    alertId = db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, error_message, severity) VALUES (?, ?, '500', 'Server error', 'error')").run(taskId, agentId).lastInsertRowid;
  });

  describe('listAlerts', () => {
    test('returns all alerts', () => {
      const req = { db, query: {} };
      const res = mockRes();
      listAlerts(req, res);
      expect(res._status).toBe(200);
      expect(res._body.alerts).toHaveLength(1);
      expect(res._body.total).toBe(1);
    });

    test('filters by status', () => {
      const req = { db, query: { status: 'open' } };
      const res = mockRes();
      listAlerts(req, res);
      expect(res._body.alerts).toHaveLength(1);
    });

    test('paginates', () => {
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, error_message) VALUES (?, ?, '404', 'nf')").run(taskId, agentId);
      const req = { db, query: { page: '1', limit: '1' } };
      const res = mockRes();
      listAlerts(req, res);
      expect(res._body.alerts).toHaveLength(1);
      expect(res._body.total).toBe(2);
    });
  });

  describe('getAlert', () => {
    test('returns alert by id', () => {
      const req = { db, params: { id: String(alertId) } };
      const res = mockRes();
      getAlert(req, res);
      expect(res._status).toBe(200);
      expect(res._body.error_type).toBe('500');
    });

    test('returns 404 for non-existent alert', () => {
      const req = { db, params: { id: '999' } };
      const res = mockRes();
      getAlert(req, res);
      expect(res._status).toBe(404);
    });
  });

  describe('updateAlert', () => {
    test('updates alert status', () => {
      const req = { db, params: { id: String(alertId) }, body: { status: 'acknowledged' } };
      const res = mockRes();
      updateAlert(req, res);
      expect(res._status).toBe(200);
      expect(res._body.status).toBe('acknowledged');
    });

    test('returns 400 for invalid status', () => {
      const req = { db, params: { id: String(alertId) }, body: { status: 'invalid' } };
      const res = mockRes();
      updateAlert(req, res);
      expect(res._status).toBe(400);
    });
  });

  describe('reportError', () => {
    test('reports error on assigned task', () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const req = {
        db,
        taskId,
        user: { id: agentId },
        body: { error_type: 'timeout', error_message: 'Request timed out after 5s' }
      };
      const res = mockRes();
      reportError(req, res);
      expect(res._status).toBe(201);
      expect(res._body.alert_id).toBeGreaterThan(0);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      expect(task.status).toBe('error');
    });

    test('returns 404 for non-existent task', () => {
      const req = {
        db,
        taskId: 999,
        user: { id: agentId },
        body: { error_type: 'test', error_message: 'test' }
      };
      const res = mockRes();
      reportError(req, res);
      expect(res._status).toBe(404);
    });

    test('returns 403 when not assigned to task', () => {
      const otherAgentId = db.prepare("INSERT INTO users (username, token, role) VALUES ('other', 'tok3', 'agent')").run().lastInsertRowid;
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const req = {
        db,
        taskId,
        user: { id: otherAgentId },
        body: { error_type: 'test', error_message: 'test' }
      };
      const res = mockRes();
      reportError(req, res);
      expect(res._status).toBe(403);
    });

    test('creates fix subtask when auto-dispatch enabled', () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const req = {
        db,
        taskId,
        user: { id: agentId },
        body: {
          error_type: '500',
          error_message: 'Internal server error',
          auto_create_fix: true
        }
      };
      const res = mockRes();
      reportError(req, res);
      expect(res._status).toBe(201);
      expect(res._body.fix_task_id).toBeGreaterThan(0);

      const fixTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(res._body.fix_task_id);
      expect(fixTask.parent_id).toBe(taskId);
      expect(fixTask.assigned_to).toBe(agentId);
      expect(fixTask.status).toBe('assigned');
    });
  });
});
