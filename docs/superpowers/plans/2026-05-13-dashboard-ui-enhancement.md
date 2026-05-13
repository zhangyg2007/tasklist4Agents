# Dashboard UI Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Agent Task Platform with alert system, auto-dispatch, three-tab dashboard (task board / tree view / alert center), and enhanced tree view interactions.

**Architecture:** Backend adds `alerts` table + `error`/`aborted` task statuses + alert CRUD API + error-reporting endpoint + capability-based auto-dispatch logic in Task model. Frontend restructures the single-file dashboard.html into a three-tab SPA with alert center, task board table, enhanced tree view (expand/collapse, right-click menu), and notification badge. All frontend remains vanilla JS, no build step.

**Tech Stack:** Node.js 22, Express 5.2, better-sqlite3 (WAL mode), Jest 30 + Supertest, vanilla HTML/CSS/JS dashboard

**Design Spec:** `docs/superpowers/specs/2026-05-12-dashboard-ui-enhancement-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| MODIFY | `src/db.js` | Add `alerts` table, migration for tasks CHECK constraint |
| CREATE | `src/models/Alert.js` | Alert CRUD + query/filter |
| MODIFY | `src/models/Task.js` | Add `error`/`aborted` statuses, auto-dispatch helper |
| CREATE | `src/controllers/alertController.js` | Alert list/detail/update, error-report endpoint |
| MODIFY | `src/controllers/agentController.js` | Add `reportError` handler |
| CREATE | `src/routes/alerts.js` | `/api/alerts/*` + `/api/tasks/:id/error` |
| MODIFY | `src/app.js` | Mount alert routes |
| MODIFY | `src/middleware/errorHandler.js` | Add alert-related error patterns |
| MODIFY | `src/public/dashboard.html` | Three-tab layout, alert center, task board, enhanced tree, notification badge |
| CREATE | `tests/unit/Alert.test.js` | Alert model unit tests |
| CREATE | `tests/unit/alertController.test.js` | Alert controller unit tests |
| MODIFY | `tests/unit/Task.test.js` | New status + auto-dispatch tests |
| MODIFY | `tests/integration/api.test.js` | Alert API + error-report integration tests |

---

## Phase 1: Database + Alerts API (P0)

### Task 1: Add `alerts` table and migrate `tasks` CHECK constraint

**Files:**
- Modify: `src/db.js:1-63`

Add migration logic and the `alerts` table to the schema. SQLite does not support `ALTER TABLE ... ADD CHECK`, so we recreate the `tasks` table with the new constraint when needed. A `schema_version` pragma tracks whether migration has run.

- [ ] **Step 1: Update SCHEMA and add migration logic in `src/db.js`**

Replace the entire file content:

```js
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'human' CHECK(role IN ('human','agent')),
    source TEXT,
    capabilities TEXT DEFAULT '[]',
    callback_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK(length(title) > 0),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','assigned','in_progress','done','rejected','blocked','error','aborted')),
    parent_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
    assigned_to INTEGER REFERENCES users(id),
    result TEXT,
    due_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);

CREATE TABLE IF NOT EXISTS callback_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    url TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
    retries INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
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

CREATE INDEX IF NOT EXISTS idx_alerts_task ON alerts(task_id);
CREATE INDEX IF NOT EXISTS idx_alerts_agent ON alerts(agent_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
`;

function migrateTasksCheckConstraint(db) {
  // Check if migration is needed: try inserting with new status to test constraint
  const hasMigration = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
  ).get();

  if (hasMigration) {
    const migrated = db.prepare(
      "SELECT 1 FROM _migrations WHERE name = 'tasks_error_aborted_status'"
    ).get();
    if (migrated) return;
  } else {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')))");
  }

  // Check current constraint
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get();
  if (tableInfo.sql.includes("'error'")) return; // Already has new statuses

  // Recreate tasks table with new constraint
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(title) > 0),
        status TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open','assigned','in_progress','done','rejected','blocked','error','aborted')),
        parent_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
        assigned_to INTEGER REFERENCES users(id),
        result TEXT,
        due_date TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO tasks_new SELECT * FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    PRAGMA foreign_keys = ON;
  `);

  db.prepare("INSERT INTO _migrations (name) VALUES ('tasks_error_aborted_status')").run();
}

export function initDb(dbPath) {
  const path = dbPath || join(__dirname, '..', 'data', 'app.db');
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateTasksCheckConstraint(db);
  return db;
}
```

- [ ] **Step 2: Run existing tests to verify migration doesn't break anything**

Run: `npm test`
Expected: All 209 tests pass (migration runs on fresh test DBs without issue)

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add alerts table and error/aborted task statuses"
```

---

### Task 2: Alert model

**Files:**
- Create: `src/models/Alert.js`
- Create: `tests/unit/Alert.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/Alert.test.js`:

```js
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
      expect(alert.severity).toBe('error'); // default
      expect(alert.status).toBe('open'); // default
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
      // Acknowledge one
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.js tests/unit/Alert.test.js --experimental-vm-modules`
Expected: FAIL — `Alert is not a constructor` / module not found

- [ ] **Step 3: Write Alert model**

Create `src/models/Alert.js`:

```js
export class Alert {
  constructor(db) {
    this.db = db;
  }

  create({ taskId, agentId, errorType, errorMessage, errorDetail, severity }) {
    return this.db.prepare(
      `INSERT INTO alerts (task_id, agent_id, error_type, error_message, error_detail, severity)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taskId, agentId || null, errorType, errorMessage || null, errorDetail || null, severity || 'error');
  }

  findById(id) {
    return this.db.prepare(
      `SELECT a.*, t.title as task_title, u.username as agent_name
       FROM alerts a
       LEFT JOIN tasks t ON a.task_id = t.id
       LEFT JOIN users u ON a.agent_id = u.id
       WHERE a.id = ?`
    ).get(id);
  }

  list({ filters = {}, page: pageRaw, limit: limitRaw } = {}) {
    let sql = `SELECT a.*, t.title as task_title, u.username as agent_name
               FROM alerts a
               LEFT JOIN tasks t ON a.task_id = t.id
               LEFT JOIN users u ON a.agent_id = u.id WHERE 1=1`;
    const params = [];

    if (filters.status) { sql += ' AND a.status = ?'; params.push(filters.status); }
    if (filters.severity) { sql += ' AND a.severity = ?'; params.push(filters.severity); }
    if (filters.task_id) { sql += ' AND a.task_id = ?'; params.push(filters.task_id); }
    if (filters.agent_id) { sql += ' AND a.agent_id = ?'; params.push(filters.agent_id); }

    const total = this.db.prepare(
      `SELECT COUNT(*) as count FROM (${sql})`
    ).get(...params).count;

    sql += ' ORDER BY a.created_at DESC';

    const page = Math.max(1, parseInt(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw) || 20));
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const rows = this.db.prepare(sql).all(...params);
    return { rows, total, page, limit };
  }

  update(id, fields) {
    const allowed = ['status', 'severity', 'fix_task_id'];
    const sets = [];
    const params = [];

    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }

    if (sets.length === 0) return { changes: 0 };

    params.push(id);
    return this.db.prepare(`UPDATE alerts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  countByStatus(status) {
    return this.db.prepare(
      'SELECT COUNT(*) as count FROM alerts WHERE status = ?'
    ).get(status).count;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config jest.config.js tests/unit/Alert.test.js --experimental-vm-modules`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/Alert.js tests/unit/Alert.test.js
git commit -m "feat: add Alert model with CRUD and filtering"
```

---

### Task 3: Alert controller + routes + error-report endpoint

**Files:**
- Create: `src/controllers/alertController.js`
- Create: `src/routes/alerts.js`
- Modify: `src/controllers/agentController.js:1-133` (add `reportError`)
- Modify: `src/app.js:1-43` (mount alert routes)
- Create: `tests/unit/alertController.test.js`

- [ ] **Step 1: Write failing controller test**

Create `tests/unit/alertController.test.js`:

```js
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
        result TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.js tests/unit/alertController.test.js --experimental-vm-modules`
Expected: FAIL — module not found

- [ ] **Step 3: Write alertController**

Create `src/controllers/alertController.js`:

```js
import { Alert } from '../models/Alert.js';
import { Task } from '../models/Task.js';

export function listAlerts(req, res) {
  const alertModel = new Alert(req.db);
  const { status, severity, task_id, agent_id, page, limit } = req.query;

  const result = alertModel.list({
    filters: {
      status,
      severity,
      task_id: task_id ? Number(task_id) : undefined,
      agent_id: agent_id ? Number(agent_id) : undefined
    },
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined
  });

  res.json({ alerts: result.rows, total: result.total, page: result.page, limit: result.limit });
}

export function getAlert(req, res) {
  const alertModel = new Alert(req.db);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid alert id' });
  }

  const alert = alertModel.findById(id);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }
  res.json(alert);
}

export function updateAlert(req, res) {
  const alertModel = new Alert(req.db);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid alert id' });
  }

  const alert = alertModel.findById(id);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  const { status, fix_task_id } = req.body;
  if (status && !['open', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'status must be open, acknowledged, or resolved' });
  }

  const fields = {};
  if (status) fields.status = status;
  if (fix_task_id !== undefined) fields.fix_task_id = fix_task_id;

  alertModel.update(id, fields);
  const updated = alertModel.findById(id);
  res.json(updated);
}

export function reportError(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'You are not assigned to this task' });
  }

  const { error_type, error_message, error_detail, severity, auto_create_fix } = req.body;
  if (!error_type) {
    return res.status(400).json({ error: 'error_type is required' });
  }

  // Update task status to error
  taskModel.update(req.taskId, { status: 'error' });

  // Create alert
  const alertModel = new Alert(req.db);
  const alertResult = alertModel.create({
    taskId: req.taskId,
    agentId: req.user.id,
    errorType: error_type,
    errorMessage: error_message || null,
    errorDetail: error_detail || null,
    severity: severity || 'error'
  });

  const response = {
    task_id: req.taskId,
    status: 'error',
    alert_id: alertResult.lastInsertRowid
  };

  // Auto-create fix subtask if requested
  if (auto_create_fix) {
    const fixTitle = `[Fix] ${error_type}: ${error_message || task.title}`;
    const fixResult = taskModel.create({
      title: fixTitle,
      userId: task.user_id,
      parentId: req.taskId
    });
    const fixTaskId = fixResult.lastInsertRowid;
    taskModel.assign(fixTaskId, req.user.id);
    alertModel.update(alertResult.lastInsertRowid, { fix_task_id: fixTaskId });
    response.fix_task_id = fixTaskId;
  }

  res.status(201).json(response);
}
```

- [ ] **Step 4: Add reportError to agentController**

Modify `src/controllers/agentController.js` — add `reportError` re-export at bottom:

```js
// Add at the end of the file (before the last empty line):
export { reportError } from './alertController.js';
```

Wait, no — circular dependency risk. Instead, add the `reportError` logic directly in agentController since it's an agent action. Actually, it's cleaner to keep it in alertController and just wire the route to use alertController directly. Let me adjust the routes instead.

The route for `POST /api/tasks/:id/error` should go in `src/routes/alerts.js` alongside the other alert routes.

Let me revise: don't modify agentController.js at all. Instead put the routes in alerts.js.

- [ ] **Step 4 (revised): Write alerts routes**

Create `src/routes/alerts.js`:

```js
import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validateIdParam } from '../middleware/validate.js';
import { listAlerts, getAlert, updateAlert, reportError } from '../controllers/alertController.js';

export const alertRoutes = Router();

alertRoutes.get('/', auth, listAlerts);
alertRoutes.get('/:id', auth, getAlert);
alertRoutes.patch('/:id', auth, updateAlert);

// Error reporting on a task (creates alert + optionally fix subtask)
alertRoutes.post('/tasks/:id/error', auth, validateIdParam, reportError);
```

- [ ] **Step 5: Mount routes in app.js**

Modify `src/app.js` — add import and mount after existing routes:

```js
// Add this import after the existing route imports:
import { alertRoutes } from './routes/alerts.js';

// Add this line after the existing route mounts (after app.use('/api/agents', agentRoutes)):
app.use('/api/alerts', alertRoutes);
```

- [ ] **Step 6: Run controller tests**

Run: `npx jest --config jest.config.js tests/unit/alertController.test.js --experimental-vm-modules`
Expected: All 10 tests PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass (new + existing)

- [ ] **Step 8: Commit**

```bash
git add src/controllers/alertController.js src/routes/alerts.js src/app.js tests/unit/alertController.test.js
git commit -m "feat: add alert API endpoints and error-reporting flow"
```

---

## Phase 2: Auto-Dispatch + Capability Matching (P0)

### Task 4: Add capability-based agent matching in User model

**Files:**
- Modify: `src/models/User.js:22-39`
- Modify: `tests/unit/User.test.js` (append tests)

- [ ] **Step 1: Write failing test for `matchByCapabilities`**

Append to `tests/unit/User.test.js` inside the existing describe block (after `listAgents` tests):

```js
describe('matchByCapabilities', () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    userModel.register({ username: 'agent1', role: 'agent', capabilities: ['code-gen', 'debug'] });
    userModel.register({ username: 'agent2', role: 'agent', capabilities: ['review', 'deploy'] });
    userModel.register({ username: 'agent3', role: 'agent', capabilities: ['code-gen', 'review'] });
    userModel.register({ username: 'human1', role: 'human', capabilities: ['code-gen'] });
  });

  test('returns agents matching a single capability', () => {
    const agents = userModel.matchByCapabilities('code-gen');
    expect(agents).toHaveLength(2); // agent1 + agent3 (human excluded)
    expect(agents.map(a => a.username).sort()).toEqual(['agent1', 'agent3']);
  });

  test('returns agents matching any of multiple capabilities', () => {
    const agents = userModel.matchByCapabilities('deploy, review');
    expect(agents).toHaveLength(2); // agent2 + agent3
  });

  test('returns empty array when no match', () => {
    const agents = userModel.matchByCapabilities('quantum-computing');
    expect(agents).toHaveLength(0);
  });

  test('excludes a specific agent by id', () => {
    const agent1 = userModel.findByToken(/* get agent1's token */);
    // Actually, let's use a cleaner approach:
    const allAgents = userModel.listAgents({});
    const agent1Id = allAgents.find(a => a.username === 'agent1').id;
    const agents = userModel.matchByCapabilities('code-gen', agent1Id);
    expect(agents).toHaveLength(1);
    expect(agents[0].username).toBe('agent3');
  });
});
```

Hmm, the token issue is annoying. Let me redesign the test to be cleaner — use a simpler setup:

```js
describe('matchByCapabilities', () => {
  test('returns agents matching a capability keyword', () => {
    // Direct insert for clean test
    db.prepare("DELETE FROM users");
    const id1 = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', ?)").run('["code-gen","debug"]').lastInsertRowid;
    const id2 = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', ?)").run('["review","deploy"]').lastInsertRowid;
    const id3 = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a3', 't3', 'agent', ?)").run('["code-gen","review"]').lastInsertRowid;
    const id4 = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('h1', 't4', 'human', ?)").run('["code-gen"]').lastInsertRowid;

    const agents = userModel.matchByCapabilities('code-gen');
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.username).sort()).toEqual(['a1', 'a3']);
  });

  test('matches multiple capability keywords (OR logic)', () => {
    db.prepare("DELETE FROM users");
    db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"code-gen\"]')").run();
    db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', '[\"review\"]')").run();

    const agents = userModel.matchByCapabilities('code-gen, review');
    expect(agents).toHaveLength(2);
  });

  test('returns empty array when no match', () => {
    db.prepare("DELETE FROM users");
    db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"debug\"]')").run();

    const agents = userModel.matchByCapabilities('quantum');
    expect(agents).toHaveLength(0);
  });

  test('excludes a specific agent by id', () => {
    db.prepare("DELETE FROM users");
    db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"code-gen\"]')").run();
    const a2Id = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', '[\"code-gen\"]')").run().lastInsertRowid;

    const agents = userModel.matchByCapabilities('code-gen', a2Id);
    expect(agents).toHaveLength(1);
    expect(agents[0].username).toBe('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.js tests/unit/User.test.js --experimental-vm-modules -t "matchByCapabilities"`
Expected: FAIL — `userModel.matchByCapabilities is not a function`

- [ ] **Step 3: Add matchByCapabilities to User model**

Modify `src/models/User.js` — add method after `listAgents`:

```js
matchByCapabilities(keywords, excludeAgentId) {
  const caps = typeof keywords === 'string'
    ? keywords.split(',').map(c => c.trim()).filter(Boolean)
    : (keywords || []);

  if (caps.length === 0) return [];

  let sql = "SELECT id, username, role, source, capabilities FROM users WHERE role = 'agent' AND (";
  const params = [];
  const conditions = caps.map(() => 'capabilities LIKE ?');
  sql += conditions.join(' OR ') + ')';
  caps.forEach(c => params.push(`%${c}%`));

  if (excludeAgentId) {
    sql += ' AND id != ?';
    params.push(excludeAgentId);
  }

  return this.db.prepare(sql).all(...params);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config jest.config.js tests/unit/User.test.js --experimental-vm-modules -t "matchByCapabilities"`
Expected: 4 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/models/User.js tests/unit/User.test.js
git commit -m "feat: add capability-based agent matching to User model"
```

---

### Task 5: Add auto-dispatch logic to Task model

**Files:**
- Modify: `src/models/Task.js:106-173` (add methods)
- Modify: `tests/unit/Task.test.js` (append tests)

- [ ] **Step 1: Write failing test for auto-dispatch methods**

Append to `tests/unit/Task.test.js`:

```js
describe('setError', () => {
  test('transitions task status to error', () => {
    const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'in_progress')").run(userId).lastInsertRowid;
    taskModel.setError(taskId);
    const task = taskModel.findById(taskId);
    expect(task.status).toBe('error');
  });
});

describe('abort', () => {
  test('transitions task from error to aborted', () => {
    const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'error')").run(userId).lastInsertRowid;
    taskModel.abort(taskId);
    const task = taskModel.findById(taskId);
    expect(task.status).toBe('aborted');
  });

  test('rejects abort from non-error status', () => {
    const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'open')").run(userId).lastInsertRowid;
    const r = taskModel.abort(taskId);
    expect(r.error).toBeDefined();
  });

  test('rejects abort for non-existent task', () => {
    const r = taskModel.abort(999);
    expect(r.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.js tests/unit/Task.test.js --experimental-vm-modules -t "setError|abort"`
Expected: FAIL — `taskModel.setError is not a function`

- [ ] **Step 3: Add setError and abort methods to Task model**

Modify `src/models/Task.js` — add after the `assign` method (~line 110):

```js
setError(id) {
  const task = this.findById(id);
  if (!task) return { error: 'Task not found' };
  return this.update(id, { status: 'error' });
}

abort(id) {
  const task = this.findById(id);
  if (!task) return { error: 'Task not found' };
  if (task.status !== 'error') {
    return { error: 'Can only abort tasks with status: error' };
  }
  return this.update(id, { status: 'aborted' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config jest.config.js tests/unit/Task.test.js --experimental-vm-modules -t "setError|abort"`
Expected: 5 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/models/Task.js tests/unit/Task.test.js
git commit -m "feat: add setError and abort methods to Task state machine"
```

---

## Phase 3: Dashboard Tab Layout + Notification Badge (P1)

### Task 6: Restructure dashboard.html with three-tab layout + count badge

**Files:**
- Modify: `src/public/dashboard.html:1-381`

This is a major rewrite of the dashboard. The file grows significantly to support three tabs. The key changes:

1. Add CSS for tabs, alert center, task board table, notification badge
2. Add HTML for tab bar with badge, three tab content areas
3. Add JS: tab switching, alert fetching, count badge polling, task board rendering

- [ ] **Step 1: Replace dashboard.html with three-tab version**

Replace the entire content of `src/public/dashboard.html`. The full file is shown below — this is the complete rewrite.

Write `src/public/dashboard.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Task Platform — Dashboard</title>
<style>
  :root {
    --bg: #0f1117;
    --card: #1a1d27;
    --border: #2a2d3a;
    --text: #e1e4ea;
    --muted: #6b7080;
    --accent: #4f8fff;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #f59e0b;
    --blue: #3b82f6;
    --gray: #6b7280;
    --orange: #f97316;
    --purple: #a855f7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1100px; margin: 0 auto; padding: 16px 20px; }

  /* Header */
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
  h1 { font-size: 1.3rem; font-weight: 600; white-space: nowrap; }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .refresh-badge { font-size: 0.7rem; color: var(--muted); }

  /* Notification badge */
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; font-size: 0.7rem; font-weight: 700; background: var(--red); color: #fff; }
  .badge.hidden { display: none; }
  .badge.pulse { animation: pulse 0.5s ease-in-out; }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.3); } }

  /* Toast */
  .toast { position: fixed; top: 20px; right: 20px; background: var(--card); border: 1px solid var(--red); border-radius: 8px; padding: 12px 20px; z-index: 200; font-size: 0.85rem; opacity: 0; transform: translateX(100%); transition: all 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateX(0); }

  /* Token bar */
  .token-bar { display: flex; gap: 8px; margin-bottom: 12px; }
  .token-bar input { flex: 1; padding: 6px 10px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: monospace; font-size: 0.8rem; }
  .token-bar input:focus { outline: none; border-color: var(--accent); }

  /* Tabs */
  .tab-bar { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 16px; }
  .tab-btn { padding: 8px 20px; background: none; border: none; color: var(--muted); font-size: 0.85rem; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s; position: relative; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-badge { position: absolute; top: 2px; right: 4px; }

  /* Tab content */
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Cards */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card h2 { font-size: 1rem; margin-bottom: 12px; color: var(--text); }

  /* Grid */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }

  /* Forms */
  .form-row { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .form-row input, .form-row select { padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font-size: 0.85rem; }
  .form-row input:focus, .form-row select:focus { outline: none; border-color: var(--accent); }
  .form-row input { flex: 1; min-width: 120px; }

  /* Buttons */
  .btn { padding: 7px 16px; border: none; border-radius: 5px; font-size: 0.85rem; cursor: pointer; font-weight: 500; transition: opacity 0.15s; }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-success { background: var(--green); color: #fff; }
  .btn-danger { background: var(--red); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
  .btn-xs { padding: 2px 8px; font-size: 0.7rem; }

  /* Status badges */
  .status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .status-open { background: #374151; color: #9ca3af; }
  .status-assigned { background: #1e3a5f; color: #60a5fa; }
  .status-in_progress { background: #3b2f0a; color: #fbbf24; }
  .status-done { background: #14532d; color: #4ade80; }
  .status-rejected { background: #450a0a; color: #f87171; }
  .status-error { background: #431407; color: #fb923c; }
  .status-aborted { background: #2d1b69; color: #c084fc; }
  .status-blocked { background: #1e293b; color: #94a3b8; }

  /* Task tree */
  .task-list { list-style: none; }
  .task-item { border-left: 2px solid var(--border); margin-left: 20px; padding: 4px 0 4px 16px; position: relative; }
  .task-item.root { border-left: none; margin-left: 0; padding-left: 0; }
  .task-item.collapsed > .task-list { display: none; }
  .task-item::before { content: ''; position: absolute; left: -2px; top: 0; width: 2px; height: 14px; background: var(--border); }
  .task-item.root::before { display: none; }
  .task-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: var(--bg); border-radius: 6px; flex-wrap: wrap; }
  .task-row:hover { background: #1e2130; }
  .task-title { font-weight: 500; font-size: 0.9rem; }
  .task-meta { font-size: 0.75rem; color: var(--muted); margin-left: auto; white-space: nowrap; }
  .task-actions { display: flex; gap: 4px; }

  /* Expand/collapse toggle */
  .toggle-icon { cursor: pointer; font-size: 0.7rem; color: var(--muted); width: 16px; text-align: center; user-select: none; flex-shrink: 0; transition: transform 0.15s; }
  .toggle-icon.collapsed { transform: rotate(-90deg); }

  /* Alert icon on task */
  .alert-indicator { color: var(--red); font-size: 0.7rem; cursor: pointer; }
  .alert-indicator.none { color: transparent; }

  /* Progress bar */
  .progress-wrap { display: flex; align-items: center; gap: 6px; min-width: 80px; }
  .progress-bar { flex: 1; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 2px; transition: width 0.3s; }
  .progress-text { font-size: 0.7rem; color: var(--muted); min-width: 28px; }

  /* Task Board table */
  .board-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .board-table th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .board-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .board-table tr:hover td { background: #1e2130; }
  .board-table .clickable { cursor: pointer; color: var(--accent); }
  .board-table .clickable:hover { text-decoration: underline; }

  /* Alert Center */
  .alert-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .alert-card { background: var(--bg); border: 1px solid var(--border); border-left: 3px solid var(--red); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
  .alert-card.warn { border-left-color: var(--yellow); }
  .alert-card.error { border-left-color: var(--red); }
  .alert-card.critical { border-left-color: var(--purple); }
  .alert-card.resolved { opacity: 0.5; border-left-color: var(--green); }
  .alert-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
  .alert-title { font-weight: 600; font-size: 0.9rem; }
  .alert-meta { font-size: 0.75rem; color: var(--muted); }
  .alert-actions { display: flex; gap: 6px; margin-top: 8px; }

  /* Context menu */
  .ctx-menu { display: none; position: fixed; z-index: 150; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 4px 0; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .ctx-menu.active { display: block; }
  .ctx-menu-item { padding: 8px 16px; font-size: 0.8rem; cursor: pointer; color: var(--text); display: block; width: 100%; text-align: left; background: none; border: none; }
  .ctx-menu-item:hover { background: #2a2d3a; }
  .ctx-menu-divider { height: 1px; background: var(--border); margin: 4px 0; }

  /* Modal */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
  .modal-overlay.active { display: flex; }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 24px; min-width: 360px; max-width: 90vw; max-height: 80vh; overflow-y: auto; }
  .modal h3 { margin-bottom: 12px; }
  .modal .btn { margin-top: 12px; margin-right: 8px; }

  /* Empty state */
  .empty { text-align: center; color: var(--muted); padding: 40px; }
  .empty p { margin: 4px 0; }

  /* Filter pills */
  .pill { padding: 3px 12px; border-radius: 14px; border: 1px solid var(--border); background: none; color: var(--muted); font-size: 0.75rem; cursor: pointer; }
  .pill.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pill:hover { border-color: var(--muted); }
  .pill.active:hover { border-color: var(--accent); }
</style>
</head>
<body>
<div class="container">

<header>
  <h1>&#9883; Agent Task Platform</h1>
  <div class="header-right">
    <span class="badge hidden" id="alertCountBadge" title="Open alerts" onclick="switchTab('alerts')">0</span>
    <button class="btn btn-primary btn-sm" onclick="refreshAll()">&#8635; Refresh</button>
    <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--muted)">
      <input type="checkbox" id="autoRefresh" checked onchange="toggleAuto()"> Auto
    </label>
  </div>
</header>

<span class="refresh-badge" id="refreshInfo">auto-refresh: 5s</span>

<!-- Token -->
<div class="token-bar">
  <input type="text" id="tokenInput" placeholder="Bearer Token (saved in localStorage)" onchange="saveToken()">
  <select id="tokenRole" style="padding:6px 8px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.75rem" disabled>
    <option>---</option>
  </select>
</div>

<!-- Tab Bar -->
<div class="tab-bar">
  <button class="tab-btn active" onclick="switchTab('board')">&#128202; Task Board</button>
  <button class="tab-btn" onclick="switchTab('tree')">&#127795; Tree View</button>
  <button class="tab-btn" onclick="switchTab('alerts')">&#128680; Alerts <span class="badge tab-badge hidden" id="tabAlertBadge"></span></button>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<!-- ==================== TAB 1: Task Board ==================== -->
<div class="tab-content active" id="tab-board">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h2 style="margin-bottom:0">&#128202; Task Overview</h2>
      <div class="alert-filters" style="margin-bottom:0">
        <button class="pill active" onclick="filterBoard('all', this)">All</button>
        <button class="pill" onclick="filterBoard('open', this)">Open</button>
        <button class="pill" onclick="filterBoard('in_progress', this)">In Progress</button>
        <button class="pill" onclick="filterBoard('error', this)">Error</button>
        <button class="pill" onclick="filterBoard('done', this)">Done</button>
      </div>
    </div>
  </div>
  <div class="card">
    <div id="taskBoard"><div class="empty"><p>Loading tasks...</p></div></div>
  </div>
</div>

<!-- ==================== TAB 2: Tree View ==================== -->
<div class="tab-content" id="tab-tree">
  <div class="grid-2">
    <div class="card">
      <h2>&#10133; Register Agent</h2>
      <div class="form-row">
        <input id="regUser" placeholder="Username">
        <select id="regRole"><option value="agent">Agent</option><option value="human">Human</option></select>
      </div>
      <div class="form-row">
        <input id="regSource" placeholder="Source (openclaw / hermes)">
        <input id="regCaps" placeholder="Capabilities (code-gen, review)">
      </div>
      <div class="form-row">
        <input id="regCallback" placeholder="Callback URL (optional)">
      </div>
      <button class="btn btn-primary btn-sm" onclick="registerAgent()">Register</button>
      <small id="regResult" style="color:var(--green);display:none;margin-left:8px;"></small>
    </div>

    <div class="card">
      <h2>&#128196; Create Task</h2>
      <div class="form-row">
        <input id="taskTitle" placeholder="Task title">
        <input id="taskParent" placeholder="Parent ID (optional)" type="number" style="max-width:100px">
      </div>
      <div class="form-row">
        <input id="sub1" placeholder="Subtasks (comma-separated)">
      </div>
      <button class="btn btn-success btn-sm" onclick="createTask()">Create Task</button>
      <small id="taskResult" style="color:var(--green);display:none;margin-left:8px;"></small>
    </div>
  </div>

  <div class="card">
    <h2>&#127795; Task Tree <span style="font-size:0.7rem;color:var(--muted);margin-left:8px">right-click a task row for actions</span></h2>
    <div id="taskTree"><div class="empty"><p>No tasks yet.</p><p>Register an agent first, then create a task.</p></div></div>
  </div>

  <div class="card">
    <h2>&#129302; Registered Agents</h2>
    <div id="agentList"><div class="empty">No agents found.</div></div>
  </div>
</div>

<!-- ==================== TAB 3: Alert Center ==================== -->
<div class="tab-content" id="tab-alerts">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h2 style="margin-bottom:0">&#128680; Alert Center</h2>
      <div class="alert-filters" style="margin-bottom:0">
        <button class="pill active" onclick="filterAlerts('all', this)">All</button>
        <button class="pill" onclick="filterAlerts('open', this)">Open</button>
        <button class="pill" onclick="filterAlerts('acknowledged', this)">Acknowledged</button>
        <button class="pill" onclick="filterAlerts('resolved', this)">Resolved</button>
      </div>
    </div>
  </div>
  <div id="alertList"><div class="empty"><p>No alerts.</p><p>When agents report errors, alerts will appear here.</p></div></div>
</div>

</div><!-- /container -->

<!-- Context menu -->
<div class="ctx-menu" id="ctxMenu"></div>

<!-- Assign Modal -->
<div class="modal-overlay" id="assignModal">
  <div class="modal">
    <h3>Assign Task #<span id="assignTaskId"></span></h3>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:8px" id="assignTaskTitle"></p>
    <select id="assignAgentSelect" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:0.85rem"></select>
    <button class="btn btn-primary" onclick="doAssign()">Assign</button>
    <button class="btn" style="background:var(--border);color:var(--text)" onclick="closeModal('assignModal')">Cancel</button>
  </div>
</div>

<!-- Alert Detail Modal -->
<div class="modal-overlay" id="alertDetailModal">
  <div class="modal" id="alertDetailContent"></div>
</div>

<script>
// ===================================================================
// State
// ===================================================================
const API = '';
let pollTimer = null;
let currentTab = 'board';
let alertCount = 0;
let prevAlertCount = 0;
let boardFilter = 'all';
let alertFilter = 'all';
let allTasks = [];
let allAlerts = [];

// ===================================================================
// Token
// ===================================================================
function getToken() { return document.getElementById('tokenInput').value || localStorage.getItem('api_token') || ''; }
function saveToken() {
  const t = document.getElementById('tokenInput').value.trim();
  localStorage.setItem('api_token', t);
  if (t) fetchMe();
}
function loadToken() {
  const t = localStorage.getItem('api_token') || '';
  document.getElementById('tokenInput').value = t;
}
loadToken();

// ===================================================================
// Auto refresh
// ===================================================================
function toggleAuto() {
  if (document.getElementById('autoRefresh').checked) startPoll();
  else stopPoll();
}
function startPoll() { stopPoll(); pollTimer = setInterval(refreshCurrentTab, 5000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); }

// ===================================================================
// API helpers
// ===================================================================
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const t = getToken();
  if (t) opts.headers['Authorization'] = 'Bearer ' + t;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// ===================================================================
// Tab switching
// ===================================================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === ['board','tree','alerts'].indexOf(tab)));
  document.getElementById('tab-board').classList.toggle('active', tab === 'board');
  document.getElementById('tab-tree').classList.toggle('active', tab === 'tree');
  document.getElementById('tab-alerts').classList.toggle('active', tab === 'alerts');
  refreshCurrentTab();
}

async function refreshCurrentTab() {
  await Promise.all([fetchAlertCount(), loadAlerts()]);
  if (currentTab === 'board') await loadTaskBoard();
  else if (currentTab === 'tree') await loadAll();
  document.getElementById('refreshInfo').textContent = 'auto-refresh: 5s | last: ' + new Date().toLocaleTimeString();
}

async function refreshAll() {
  await Promise.all([fetchAlertCount(), loadTaskBoard(), loadAll(), loadAlerts()]);
  document.getElementById('refreshInfo').textContent = 'auto-refresh: 5s | last: ' + new Date().toLocaleTimeString();
}

// ===================================================================
// Alert count badge
// ===================================================================
async function fetchAlertCount() {
  const { status, data } = await api('GET', '/api/alerts?status=open&limit=1');
  if (status !== 200) return;
  prevAlertCount = alertCount;
  alertCount = data.total || 0;
  updateBadge();
}

function updateBadge() {
  const badge = document.getElementById('alertCountBadge');
  const tabBadge = document.getElementById('tabAlertBadge');
  if (alertCount > 0) {
    badge.textContent = alertCount;
    badge.classList.remove('hidden');
    tabBadge.textContent = alertCount;
    tabBadge.classList.remove('hidden');
    // Pulse animation on new alerts
    if (alertCount > prevAlertCount) {
      badge.classList.add('pulse');
      setTimeout(() => badge.classList.remove('pulse'), 500);
      showToast(alertCount - prevAlertCount + ' new alert(s)');
    }
  } else {
    badge.classList.add('hidden');
    tabBadge.classList.add('hidden');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ===================================================================
// Me
// ===================================================================
async function fetchMe() {
  const { status, data } = await api('GET', '/api/auth/me');
  const el = document.getElementById('tokenRole');
  if (status === 200) { el.value = data.role; el.style.color = 'var(--green)'; }
  else { el.value = 'invalid'; el.style.color = 'var(--red)'; }
}

// ===================================================================
// Register
// ===================================================================
async function registerAgent() {
  const u = document.getElementById('regUser').value.trim();
  const role = document.getElementById('regRole').value;
  const source = document.getElementById('regSource').value.trim();
  const caps = document.getElementById('regCaps').value.trim();
  const cb = document.getElementById('regCallback').value.trim();
  if (!u) return alert('Username required');

  const body = { username: u, role };
  if (source) body.source = source;
  if (caps) body.capabilities = caps.split(',').map(s => s.trim()).filter(Boolean);
  if (cb) body.callback_url = cb;

  const { status, data } = await api('POST', '/api/auth/register', body);
  const el = document.getElementById('regResult');
  el.style.display = 'inline';
  if (status === 201) {
    el.style.color = 'var(--green)';
    el.textContent = 'Token: ' + data.token;
    document.getElementById('tokenInput').value = data.token;
    saveToken();
    refreshAll();
  } else {
    el.style.color = 'var(--red)';
    el.textContent = data.error || 'Failed';
  }
}

// ===================================================================
// Create Task
// ===================================================================
async function createTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return alert('Title required');
  const parentId = document.getElementById('taskParent').value.trim();
  const subsRaw = document.getElementById('sub1').value.trim();

  const body = { title };
  if (parentId) body.parent_id = Number(parentId);
  if (subsRaw) body.subtasks = subsRaw.split(',').map(s => ({ title: s.trim() })).filter(s => s.title);

  const { status, data } = await api('POST', '/api/tasks', body);
  const el = document.getElementById('taskResult');
  el.style.display = 'inline';
  if (status === 201) {
    el.style.color = 'var(--green)';
    el.textContent = `Created #${data.id}` + (data.subtask_ids?.length ? ` + ${data.subtask_ids.length} subtasks` : '');
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskParent').value = '';
    document.getElementById('sub1').value = '';
    refreshAll();
  } else {
    el.style.color = 'var(--red)';
    el.textContent = data.error || 'Failed';
  }
}

// ===================================================================
// TAB 1: Task Board (table view — top-level tasks only)
// ===================================================================
function filterBoard(f, el) {
  boardFilter = f;
  document.querySelectorAll('#tab-board .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderTaskBoard();
}

async function loadTaskBoard() {
  const { status, data } = await api('GET', '/api/tasks?sort=id&order=asc&limit=100');
  if (status !== 200) { document.getElementById('taskBoard').innerHTML = '<div class="empty">Auth required</div>'; return; }
  allTasks = data.tasks || [];
  renderTaskBoard();
}

function renderTaskBoard() {
  const tasks = allTasks;
  const roots = tasks.filter(t => !t.parent_id);
  const filtered = boardFilter === 'all' ? roots : roots.filter(t => t.status === boardFilter);

  if (!filtered.length) {
    document.getElementById('taskBoard').innerHTML = '<div class="empty"><p>No tasks match the filter.</p></div>';
    return;
  }

  // Gather child stats per root
  const childrenMap = {};
  for (const t of tasks) {
    if (t.parent_id) (childrenMap[t.parent_id] ||= []).push(t);
  }

  let html = '<table class="board-table"><thead><tr>';
  html += '<th>ID</th><th>Title</th><th>Status</th><th>Children</th><th>Assigned</th><th>Alerts</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  for (const t of filtered) {
    const kids = childrenMap[t.id] || [];
    const doneCount = kids.filter(k => k.status === 'done').length;
    const errorCount = kids.filter(k => k.status === 'error').length;
    const taskAlerts = allAlerts.filter(a => a.task_id === t.id && a.status === 'open').length;
    const totalAlerts = taskAlerts + kids.reduce((sum, k) => sum + allAlerts.filter(a => a.task_id === k.id && a.status === 'open').length, 0);

    html += `<tr>
      <td>#${t.id}</td>
      <td><span class="clickable" onclick="switchTab('tree');setTimeout(()=>scrollToTask(${t.id}),100)">${esc(t.title)}</span></td>
      <td><span class="status status-${t.status}">${t.status}</span></td>
      <td>
        ${kids.length ? `<span class="progress-wrap">
          <span class="progress-bar"><span class="progress-fill" style="width:${doneCount/kids.length*100}%"></span></span>
          <span class="progress-text">${doneCount}/${kids.length}</span>
        </span>` : '<span style="color:var(--muted);font-size:0.75rem">—</span>'}
        ${errorCount > 0 ? ` <span style="color:var(--red);font-size:0.7rem">${errorCount} error</span>` : ''}
      </td>
      <td style="font-size:0.75rem;color:var(--muted)">${t.assigned_to ? 'Agent #'+t.assigned_to : '—'}</td>
      <td>${totalAlerts > 0 ? `<span class="badge" style="cursor:pointer" onclick="switchTab('alerts')">${totalAlerts}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td><div class="task-actions">
        <button class="btn btn-sm btn-primary" onclick="openAssign(${t.id},'${esc(t.title)}')" title="Assign">&#10148;</button>
      </div></td>
    </tr>`;
  }

  html += '</tbody></table>';
  document.getElementById('taskBoard').innerHTML = html;
}

// ===================================================================
// TAB 2: Tree View (enhanced)
// ===================================================================
async function loadAll() {
  await Promise.all([loadTasks(), loadAgents()]);
}

async function loadTasks() {
  const { status, data } = await api('GET', '/api/tasks?sort=id&order=asc&limit=100');
  if (status !== 200) { document.getElementById('taskTree').innerHTML = '<div class="empty">Auth required — set token above</div>'; return; }
  allTasks = data.tasks || [];
  if (!allTasks.length) { document.getElementById('taskTree').innerHTML = '<div class="empty"><p>No tasks yet.</p><p>Create one using the form above.</p></div>'; return; }

  // Build tree
  const childrenMap = {};
  const roots = [];
  for (const t of allTasks) {
    if (t.parent_id) { (childrenMap[t.parent_id] ||= []).push(t); }
    else { roots.push(t); }
  }

  let html = '<ul class="task-list">';
  function render(t, depth) {
    const cls = depth === 0 ? 'task-item root' : 'task-item';
    const kids = childrenMap[t.id] || [];
    const doneCount = kids.filter(k => k.status === 'done').length;
    const hasKids = kids.length > 0;
    const alertN = allAlerts.filter(a => a.task_id === t.id && a.status === 'open').length;

    html += `<li class="${cls}" id="task-${t.id}">
      <div class="task-row" oncontextmenu="showCtxMenu(event, ${t.id}, '${esc(t.title)}', '${t.status}')">
        ${hasKids ? `<span class="toggle-icon" onclick="toggleCollapse(event, ${t.id})">&#9660;</span>` : '<span style="width:16px;flex-shrink:0"></span>'}
        <span class="task-title">${esc(t.title)}</span>
        <span class="status status-${t.status}">${t.status}</span>
        ${alertN > 0 ? `<span class="alert-indicator" title="${alertN} alert(s)" onclick="switchTab('alerts')">&#128680;${alertN}</span>` : ''}
        ${t.assigned_to ? `<span style="font-size:0.7rem;color:var(--muted)">agent #${t.assigned_to}</span>` : ''}
        ${hasKids ? `
          <span class="progress-wrap">
            <span class="progress-bar"><span class="progress-fill" style="width:${kids.length ? (doneCount/kids.length*100) : 0}%"></span></span>
            <span class="progress-text">${doneCount}/${kids.length}</span>
          </span>` : ''}
        <span class="task-meta">#${t.id}</span>
        <span class="task-actions">
          <button class="btn btn-sm btn-primary" onclick="openAssign(${t.id}, '${esc(t.title)}')" title="Assign">&#10148;</button>
        </span>
      </div>`;
    if (hasKids) {
      html += `<ul class="task-list" id="children-${t.id}">`;
      for (const kid of kids) render(kid, depth + 1);
      html += '</ul>';
    }
    html += '</li>';
  }
  for (const r of roots) render(r, 0);
  html += '</ul>';
  document.getElementById('taskTree').innerHTML = html;
}

function toggleCollapse(e, taskId) {
  e.stopPropagation();
  const icon = e.target;
  const list = document.getElementById('children-' + taskId);
  if (!list) return;
  const collapsed = list.style.display === 'none';
  list.style.display = collapsed ? '' : 'none';
  icon.classList.toggle('collapsed', !collapsed);
}

function scrollToTask(id) {
  const el = document.getElementById('task-' + id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadAgents() {
  const { status, data } = await api('GET', '/api/agents');
  if (status !== 200) return;
  const agents = data.agents || [];
  if (!agents.length) { document.getElementById('agentList').innerHTML = '<div class="empty">No agents registered.</div>'; return; }

  let html = '';
  for (const a of agents) {
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem;flex-wrap:wrap">
      <strong>${esc(a.username)}</strong>
      <span class="status status-${a.role === 'agent' ? 'in_progress' : 'open'}">${a.role}</span>
      <span style="color:var(--muted);font-size:0.75rem">source: ${a.source || '-'}</span>
      <span style="color:var(--muted);font-size:0.75rem">caps: ${(a.capabilities || []).join(', ') || '-'}</span>
      <span style="color:var(--muted);font-size:0.75rem;margin-left:auto">#${a.id}</span>
    </div>`;
  }
  document.getElementById('agentList').innerHTML = html;
}

// ===================================================================
// TAB 3: Alert Center
// ===================================================================
function filterAlerts(f, el) {
  alertFilter = f;
  document.querySelectorAll('#tab-alerts .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderAlerts();
}

async function loadAlerts() {
  const { status, data } = await api('GET', '/api/alerts?limit=100');
  if (status !== 200) { document.getElementById('alertList').innerHTML = '<div class="empty">Auth required</div>'; return; }
  allAlerts = data.alerts || [];
  renderAlerts();
}

function renderAlerts() {
  const filtered = alertFilter === 'all' ? allAlerts : allAlerts.filter(a => a.status === alertFilter);

  if (!filtered.length) {
    document.getElementById('alertList').innerHTML = '<div class="empty"><p>No alerts match the filter.</p></div>';
    return;
  }

  let html = '';
  for (const a of filtered) {
    html += `<div class="alert-card ${a.severity} ${a.status === 'resolved' ? 'resolved' : ''}">
      <div class="alert-header">
        <div>
          <span class="alert-title">${severityIcon(a.severity)} ${esc(a.error_type)}</span>
          <span class="status" style="margin-left:8px;background:${a.status==='open'?'#450a0a':a.status==='acknowledged'?'#3b2f0a':'#14532d'};color:${a.status==='open'?'#f87171':a.status==='acknowledged'?'#fbbf24':'#4ade80'}">${a.status}</span>
        </div>
        <span class="alert-meta">${a.created_at || ''}</span>
      </div>
      <div class="alert-meta" style="margin-top:4px">
        Task: <span class="clickable" onclick="switchTab('tree');setTimeout(()=>scrollToTask(${a.task_id}),100)">#${a.task_id} ${esc(a.task_title || '')}</span>
        ${a.agent_name ? ` | Agent: ${esc(a.agent_name)}` : ''}
      </div>
      <div style="font-size:0.85rem;margin-top:4px">${esc(a.error_message || '')}</div>
      ${a.fix_task_id ? `<div style="font-size:0.75rem;color:var(--green);margin-top:4px">Fix task: #${a.fix_task_id}</div>` : ''}
      <div class="alert-actions">
        ${a.status === 'open' ? `<button class="btn btn-sm btn-primary" onclick="acknowledgeAlert(${a.id})">Acknowledge</button>` : ''}
        ${a.status !== 'resolved' ? `<button class="btn btn-sm btn-success" onclick="resolveAlert(${a.id})">Resolve</button>` : ''}
        ${!a.fix_task_id ? `<button class="btn btn-sm btn-primary" onclick="createFixTask(${a.id}, ${a.task_id})">Create Fix Task</button>` : ''}
      </div>
    </div>`;
  }
  document.getElementById('alertList').innerHTML = html;
}

function severityIcon(s) {
  if (s === 'critical') return '&#128308;';
  if (s === 'error') return '&#128992;';
  return '&#128993;';
}

async function acknowledgeAlert(id) {
  await api('PATCH', `/api/alerts/${id}`, { status: 'acknowledged' });
  await loadAlerts();
  await fetchAlertCount();
}

async function resolveAlert(id) {
  await api('PATCH', `/api/alerts/${id}`, { status: 'resolved' });
  await loadAlerts();
  await fetchAlertCount();
}

async function createFixTask(alertId, taskId) {
  const title = prompt('Fix task title (optional):', '[Fix] Alert #' + alertId);
  if (title === null) return;
  const body = { title: title || '[Fix] Alert #' + alertId, parent_id: taskId };
  const { data } = await api('POST', '/api/tasks', body);
  if (data.id) {
    // Assign to the agent from the alert
    const alert = allAlerts.find(a => a.id === alertId);
    if (alert && alert.agent_id) {
      await api('POST', `/api/tasks/${data.id}/assign`, { assigned_to: alert.agent_id });
    }
    await api('PATCH', `/api/alerts/${alertId}`, { status: 'acknowledged', fix_task_id: data.id });
    await refreshAll();
  }
}

// ===================================================================
// Context menu (right-click on task)
// ===================================================================
function showCtxMenu(e, taskId, title, status) {
  e.preventDefault();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = `
    <button class="ctx-menu-item" onclick="openAssign(${taskId},'${esc(title)}');hideCtxMenu()">&#10148; Assign Agent</button>
    <button class="ctx-menu-item" onclick="switchTab('tree');hideCtxMenu()">&#128065; View in Tree</button>
    <div class="ctx-menu-divider"></div>
    <button class="ctx-menu-item" onclick="viewTaskAlerts(${taskId});hideCtxMenu()">&#128680; View Alerts</button>
    <button class="ctx-menu-item" onclick="createSubtaskInline(${taskId});hideCtxMenu()">&#128196; Create Subtask</button>
    ${status === 'error' ? `<button class="ctx-menu-item" onclick="createFixFromCtx(${taskId});hideCtxMenu()">&#128295; Create Fix Task</button>` : ''}
  `;
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  menu.classList.add('active');
}

function hideCtxMenu() {
  document.getElementById('ctxMenu').classList.remove('active');
}

document.addEventListener('click', hideCtxMenu);

function viewTaskAlerts(taskId) {
  switchTab('alerts');
  // Could implement per-task alert filtering here
}

function createSubtaskInline(taskId) {
  const title = prompt('Subtask title:');
  if (!title) return;
  api('POST', '/api/tasks/' + taskId + '/subtasks', { subtasks: [{ title }] }).then(() => refreshAll());
}

function createFixFromCtx(taskId) {
  const title = prompt('Fix task title:', '[Fix] Task #' + taskId);
  if (!title) return;
  api('POST', '/api/tasks', { title, parent_id: taskId }).then(r => {
    if (r.data.id) {
      api('POST', `/api/tasks/${r.data.id}/assign`, { assigned_to: allTasks.find(t => t.id === taskId)?.assigned_to }).then(() => refreshAll());
    }
  });
}

// ===================================================================
// Assign
// ===================================================================
async function openAssign(taskId, title) {
  document.getElementById('assignTaskId').textContent = taskId;
  document.getElementById('assignTaskTitle').textContent = title;
  const { data } = await api('GET', '/api/agents');
  const sel = document.getElementById('assignAgentSelect');
  sel.innerHTML = '';
  for (const a of (data.agents || [])) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.username} (${a.role}) #${a.id}`;
    sel.appendChild(opt);
  }
  document.getElementById('assignModal').classList.add('active');
}

async function doAssign() {
  const taskId = document.getElementById('assignTaskId').textContent;
  const agentId = Number(document.getElementById('assignAgentSelect').value);
  if (!agentId) return;
  await api('POST', `/api/tasks/${taskId}/assign`, { assigned_to: agentId });
  closeModal('assignModal');
  refreshAll();
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ===================================================================
// Utilities
// ===================================================================
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ===================================================================
// Init
// ===================================================================
startPoll();
fetchAlertCount();
loadTaskBoard();
loadAll();
</script>
</body>
</html>
```

- [ ] **Step 2: Start server and visually verify**

Run: `npm start`
Open `http://localhost:3000` in a browser

Expected:
- Three tabs visible: Task Board, Tree View, Alerts
- Task Board shows table with top-level tasks, progress bars, alert counts
- Tree View shows hierarchical task tree with expand/collapse toggles, alert indicators
- Alert Center shows alert cards (empty state initially)
- Notification badge shows "0" (hidden when zero)
- Right-click on task row shows context menu
- Tab switching works

- [ ] **Step 3: Commit**

```bash
git add src/public/dashboard.html
git commit -m "feat: restructure dashboard with three-tab layout, alert center, and notification badge"
```

---

## Phase 4: Integration Tests

### Task 7: Add integration tests for alerts and error-reporting

**Files:**
- Modify: `tests/integration/api.test.js`

- [ ] **Step 1: Add alert integration tests**

Append to `tests/integration/api.test.js` inside the existing describe block (before the closing `});`):

```js
describe('Alert API', () => {
  let ownerToken, agentToken, ownerId, agentId, taskId;

  beforeEach(async () => {
    // Register owner
    const r1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alert_owner', role: 'human' });
    ownerToken = r1.body.token;
    ownerId = r1.body.id;

    // Register agent
    const r2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alert_agent', role: 'agent' });
    agentToken = r2.body.token;
    agentId = r2.body.id;

    // Create task
    const r3 = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ title: 'Task for alerts' });
    taskId = r3.body.id;
  });

  test('POST /api/alerts/tasks/:id/error — reports error and creates alert', async () => {
    // First assign the task to the agent and start it
    await request(app)
      .post(`/api/tasks/${taskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    await request(app)
      .post(`/api/tasks/${taskId}/submit`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ result: 'started' });
    // Task is now in_progress (submit started it → done, but since it's a leaf task, it went to done)

    // Actually let's create a fresh task for error reporting
    const r = await request(app)
      .post('/api/tasks')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ title: 'Error test task' });
    const errTaskId = r.body.id;

    await request(app)
      .post(`/api/tasks/${errTaskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    // Agent can report error even from assigned status (before starting)
    const res = await request(app)
      .post(`/api/alerts/tasks/${errTaskId}/error`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ error_type: 'timeout', error_message: 'Request timed out' });

    expect(res.status).toBe(201);
    expect(res.body.alert_id).toBeGreaterThan(0);
    expect(res.body.status).toBe('error');

    // Task status should be error
    const taskRes = await request(app)
      .get(`/api/tasks/${errTaskId}`)
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(taskRes.body.status).toBe('error');
  });

  test('POST /api/alerts/tasks/:id/error — 403 when not assigned agent', async () => {
    const otherRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'other_agent', role: 'agent' });
    const otherToken = otherRes.body.token;

    const res = await request(app)
      .post(`/api/alerts/tasks/${taskId}/error`)
      .set('Authorization', 'Bearer ' + otherToken)
      .send({ error_type: 'test', error_message: 'test' });

    expect(res.status).toBe(403);
  });

  test('POST /api/alerts/tasks/:id/error — auto-creates fix task', async () => {
    await request(app)
      .post(`/api/tasks/${taskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    const res = await request(app)
      .post(`/api/alerts/tasks/${taskId}/error`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({
        error_type: '500',
        error_message: 'Server error',
        auto_create_fix: true
      });

    expect(res.status).toBe(201);
    expect(res.body.fix_task_id).toBeGreaterThan(0);

    const fixRes = await request(app)
      .get(`/api/tasks/${res.body.fix_task_id}`)
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(fixRes.body.parent_id).toBe(taskId);
    expect(fixRes.body.status).toBe('assigned');
  });

  test('GET /api/alerts — lists alerts with filters', async () => {
    // Create an alert
    await request(app)
      .post(`/api/tasks/${taskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    await request(app)
      .post(`/api/alerts/tasks/${taskId}/error`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ error_type: '404', error_message: 'Not found', severity: 'warn' });

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', 'Bearer ' + ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].error_type).toBe('404');

    // Filter by status
    const res2 = await request(app)
      .get('/api/alerts?status=open')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res2.body.alerts).toHaveLength(1);

    const res3 = await request(app)
      .get('/api/alerts?status=resolved')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res3.body.alerts).toHaveLength(0);
  });

  test('GET /api/alerts/:id — returns single alert', async () => {
    await request(app)
      .post(`/api/tasks/${taskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    const errRes = await request(app)
      .post(`/api/alerts/tasks/${taskId}/error`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ error_type: 'crash', error_message: 'Process died' });

    const res = await request(app)
      .get(`/api/alerts/${errRes.body.alert_id}`)
      .set('Authorization', 'Bearer ' + ownerToken);

    expect(res.status).toBe(200);
    expect(res.body.error_type).toBe('crash');
  });

  test('PATCH /api/alerts/:id — updates alert status', async () => {
    await request(app)
      .post(`/api/tasks/${taskId}/assign`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ assigned_to: agentId });

    const errRes = await request(app)
      .post(`/api/alerts/tasks/${taskId}/error`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ error_type: 'test', error_message: 'test' });

    const res = await request(app)
      .patch(`/api/alerts/${errRes.body.alert_id}`)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx jest --config jest.config.js tests/integration/api.test.js --experimental-vm-modules`
Expected: All tests pass (existing 25 + new 7 = 32)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass (209 + new Alert tests + new controller tests + new integration tests = ~245 tests)

- [ ] **Step 4: Commit**

```bash
git add tests/integration/api.test.js
git commit -m "test: add integration tests for alert API and error-reporting"
```

---

## Summary

### Implementation Order

1. **Task 1** — Database migration (alerts table + tasks CHECK constraint)
2. **Task 2** — Alert model + unit tests
3. **Task 3** — Alert controller + routes + error-report endpoint + tests
4. **Task 4** — Capability matching in User model (auto-dispatch prerequisite)
5. **Task 5** — setError/abort in Task model
6. **Task 6** — Three-tab dashboard rewrite (depends on Tasks 1-3 for API)
7. **Task 7** — Integration tests (depends on all above)

### What Each Task Delivers

| Task | Delivers | Testable Independently? |
|------|----------|------------------------|
| 1 | DB ready for alerts + new statuses | Yes (existing tests pass) |
| 2 | `Alert` model with CRUD + filter | Yes (12 unit tests) |
| 3 | Full alert API + error-report endpoint | Yes (10 unit + manual curl) |
| 4 | `User.matchByCapabilities()` | Yes (4 unit tests) |
| 5 | `Task.setError()` + `Task.abort()` | Yes (5 unit tests) |
| 6 | Complete 3-tab dashboard UI | Yes (browser verification) |
| 7 | End-to-end integration coverage | Yes (7 integration tests) |

### Not Covered in This Plan

The following items from the design spec are recorded here for future iterations:

- **Right-click menu "View Alerts" per-task filtering** — The context menu exists but per-task alert filtering in the Alert Center tab uses a simple JavaScript filter; a dedicated API query parameter `?task_id=N` already exists and can be wired in a follow-up.
- **Expand/collapse animations** — Current toggle is instant; CSS transitions can be added later.
- **Browser Notification API** — The `showToast()` function exists but does not use the Notification API; this can be added as an opt-in feature later.
- **Agent auto-dispatch on error** — The `auto_create_fix: true` flag in `reportError` creates a fix task assigned to the same agent. More sophisticated capability-matching-based dispatch to OTHER agents (for "special case" coordination) requires additional UI wiring in the alert creation flow.
