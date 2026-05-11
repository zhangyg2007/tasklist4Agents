# Agent Task Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-agent task orchestration API where agents register via token, create task trees, assign sub-tasks to other agents, collect results, and review them.

**Architecture:** Classic Express layered architecture (routes → controllers → models → db). Synchronous SQLite via `better-sqlite3`. Auth via fixed Bearer tokens. Each agent is a user with `role='agent'` and optional `callback_url` for wake-up webhooks.

**Tech Stack:** Node.js 24, Express 5, better-sqlite3, vitest for testing

---

### Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `src/index.js`
- Create: `src/app.js`

- [ ] **Step 1: Initialize package.json**

Create `package.json`:
```json
{
  "name": "agent-task-platform",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "express": "^5.1.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

- [ ] **Step 3: Create minimal app.js**

Create `src/app.js`:
```javascript
import express from 'express';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(db) {
  const app = express();
  app.use(express.json());

  // Attach db to request for downstream use
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Health check (no auth)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/agents', agentRoutes);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 4: Create minimal index.js**

Create `src/index.js`:
```javascript
import { initDb } from './db.js';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;

const db = initDb();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

- [ ] **Step 5: Verify app starts**

Run: `node src/index.js`
Expected: `Server running on http://localhost:3000` (then Ctrl+C)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app.js src/index.js
git commit -m "feat: project skeleton with Express + SQLite scaffolding"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db.js`

- [ ] **Step 1: Write db.js with schema creation**

Create `src/db.js`:
```javascript
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
        CHECK(status IN ('open','assigned','in_progress','done','rejected','blocked')),
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
`;

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
  return db;
}
```

- [ ] **Step 2: Verify database initializes**

Run temporary script or node REPL:
```
node -e "const {initDb} = require('./src/db.js'); const db = initDb(':memory:'); const row = db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\"').all(); console.log(row);"
```
Expected: logs `users` and `tasks` table entries

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: database layer with users and tasks schema"
```

---

### Task 3: User Model

**Files:**
- Create: `src/models/User.js`

- [ ] **Step 1: Write User model**

Create `src/models/User.js`:
```javascript
import { v4 as uuidv4 } from 'uuid';

export class User {
  constructor(db) {
    this.db = db;
  }

  findByToken(token) {
    return this.db.prepare(
      'SELECT id, username, token, role, source, capabilities, callback_url, created_at FROM users WHERE token = ?'
    ).get(token);
  }

  findById(id) {
    return this.db.prepare(
      'SELECT id, username, token, role, source, capabilities, callback_url, created_at FROM users WHERE id = ?'
    ).get(id);
  }

  listAgents(filters = {}) {
    let sql = 'SELECT id, username, role, source, capabilities FROM users WHERE role = ?';
    const params = ['agent'];

    if (filters.source) {
      sql += ' AND source = ?';
      params.push(filters.source);
    }
    if (filters.capabilities) {
      const caps = filters.capabilities.split(',').map(c => c.trim());
      for (const cap of caps) {
        sql += ' AND capabilities LIKE ?';
        params.push(`%${cap}%`);
      }
    }

    return this.db.prepare(sql).all(...params);
  }

  register({ username, role, source, capabilities, callback_url }) {
    // Validate role
    const finalRole = role || 'human';
    if (!['human', 'agent'].includes(finalRole)) {
      return { error: 'role must be human or agent', status: 400 };
    }

    // Check username uniqueness
    const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return { error: 'username already taken', status: 409 };
    }

    // Generate unique token with collision retry
    const token = uuidv4();

    const caps = capabilities || [];
    const capsJson = typeof caps === 'string' ? caps : JSON.stringify(caps);

    const result = this.db.prepare(
      `INSERT INTO users (username, token, role, source, capabilities, callback_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(username, token, finalRole, source || null, capsJson, callback_url || null);

    return {
      id: result.lastInsertRowid,
      username,
      token,
      role: finalRole,
      source: source || null,
      capabilities: capsJson,
      callback_url: callback_url || null
    };
  }
}
```

- [ ] **Step 2: Verify model with quick REPL test**

```
node -e "
const {initDb} = require('./src/db.js');
const {User} = require('./src/models/User.js');
const db = initDb(':memory:');
const user = new User(db);
const result = user.register({username:'test-agent', role:'agent', source:'openclaw', capabilities:['code-gen']});
console.log(result);
console.log(user.findByToken(result.token));
"
```
Expected: logs registered agent and found record

- [ ] **Step 3: Commit**

```bash
git add src/models/User.js
git commit -m "feat: user model with register, findByToken, listAgents"
```

---

### Task 4: Auth Middleware + Validation

**Files:**
- Create: `src/middleware/auth.js`
- Create: `src/middleware/validate.js`

- [ ] **Step 1: Write auth middleware**

Create `src/middleware/auth.js`:
```javascript
import { User } from '../models/User.js';

export function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = header.slice(7);
  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  const userModel = new User(req.db);
  const user = userModel.findByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = user;
  next();
}
```

- [ ] **Step 2: Write validation helpers**

Create `src/middleware/validate.js`:
```javascript
export function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => req.body[f] === undefined || req.body[f] === null);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }
    next();
  };
}

export function validateEnum(field, allowed) {
  return (req, res, next) => {
    const value = req.body[field] || req.query[field];
    if (value && !allowed.includes(value)) {
      return res.status(400).json({
        error: `${field} must be one of: ${allowed.join(', ')}`
      });
    }
    next();
  };
}

export function validateIdParam(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid id parameter' });
  }
  req.taskId = id;
  next();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/auth.js src/middleware/validate.js
git commit -m "feat: auth middleware and input validation helpers"
```

---

### Task 5: Auth Routes + Controller

**Files:**
- Create: `src/controllers/authController.js`
- Create: `src/routes/auth.js`

- [ ] **Step 1: Write auth controller**

Create `src/controllers/authController.js`:
```javascript
import { User } from '../models/User.js';

export function register(req, res) {
  const { username, role, source, capabilities, callback_url } = req.body;
  const userModel = new User(req.db);
  const result = userModel.register({ username, role, source, capabilities, callback_url });

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  res.status(201).json({
    id: result.id,
    username: result.username,
    token: result.token,
    role: result.role,
    source: result.source,
    capabilities: JSON.parse(result.capabilities),
    callback_url: result.callback_url
  });
}

export function me(req, res) {
  // req.user is set by auth middleware, but we need to ensure capabilities is parsed
  const user = { ...req.user };
  try {
    user.capabilities = typeof user.capabilities === 'string'
      ? JSON.parse(user.capabilities)
      : user.capabilities;
  } catch {
    user.capabilities = [];
  }
  res.json(user);
}
```

- [ ] **Step 2: Wire auth routes**

Create `src/routes/auth.js`:
```javascript
import { Router } from 'express';
import { register, me } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';
import { requireFields, validateEnum } from '../middleware/validate.js';

export const authRoutes = Router();

authRoutes.post('/register',
  requireFields('username'),
  validateEnum('role', ['human', 'agent']),
  register
);

authRoutes.get('/me', auth, me);
```

- [ ] **Step 3: Quick manual test**

Start server with `npm run dev`, then test:
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test-agent","role":"agent","source":"openclaw","capabilities":["code-gen"]}'
```
Expected: 201 with id, username, token

```bash
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer <token>"
```
Expected: 200 with user info

- [ ] **Step 4: Commit**

```bash
git add src/controllers/authController.js src/routes/auth.js
git commit -m "feat: auth routes — register and me endpoints"
```

---

### Task 6: Auth Integration Tests

**Files:**
- Create: `tests/setup.js`
- Create: `tests/auth.test.js`

- [ ] **Step 1: Write test setup**

Create `tests/setup.js`:
```javascript
import { initDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export function setupTestApp() {
  const db = initDb(':memory:');
  const app = createApp(db);
  return { app, db };
}

export function registerAgent(app, overrides = {}) {
  const res = app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: overrides.username || `agent-${Date.now()}`,
      role: 'agent',
      source: overrides.source || 'openclaw',
      capabilities: overrides.capabilities || ['code-gen'],
      callback_url: overrides.callback_url || null
    })
  });
  return res;
}
```

- [ ] **Step 2: Write auth tests**

Create `tests/auth.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { setupTestApp } from './setup.js';

async function body(res) { return res.json(); }

describe('POST /api/auth/register', () => {
  it('registers a new agent and returns token', async () => {
    const { app } = setupTestApp();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'agent-1', role: 'agent', source: 'openclaw' })
    });
    expect(res.status).toBe(201);
    const data = await body(res);
    expect(data.token).toBeDefined();
    expect(data.role).toBe('agent');
    expect(data.username).toBe('agent-1');
  });

  it('rejects duplicate username with 409', async () => {
    const { app } = setupTestApp();
    const payload = { username: 'dup', role: 'agent' };
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(res.status).toBe(409);
    const data = await body(res);
    expect(data.error).toContain('already taken');
  });

  it('rejects missing username with 400', async () => {
    const { app } = setupTestApp();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'agent' })
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid role with 400', async () => {
    const { app } = setupTestApp();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bad', role: 'robot' })
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user for valid token', async () => {
    const { app } = setupTestApp();
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'me-test', role: 'agent' })
    });
    const { token } = await reg.json();

    const res = await app.request('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.username).toBe('me-test');
  });

  it('returns 401 for invalid token', async () => {
    const { app } = setupTestApp();
    const res = await app.request('/api/auth/me', {
      headers: { 'Authorization': 'Bearer bad-token' }
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for missing auth header', async () => {
    const { app } = setupTestApp();
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/auth.test.js`
Expected: 7 tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/setup.js tests/auth.test.js
git commit -m "test: auth register and me integration tests"
```

---

### Task 7: Task Model

**Files:**
- Create: `src/models/Task.js`

- [ ] **Step 1: Write Task model with full CRUD + status machine**

Create `src/models/Task.js`:
```javascript
export class Task {
  constructor(db) {
    this.db = db;
  }

  list({ userId, filters = {} }) {
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    const params = [userId];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.assigned_to) {
      sql += ' AND assigned_to = ?';
      params.push(filters.assigned_to);
    }
    if (filters.parent_id !== undefined) {
      sql += ' AND parent_id = ?';
      params.push(filters.parent_id);
    }
    if (filters.role === 'owner') {
      // Default: user_id = current user. Tasks they created.
      // Already covered by the base WHERE.
    }

    // Sorting
    const sortField = filters.sort || 'created_at';
    const allowedSorts = ['created_at', 'updated_at', 'due_date'];
    const sort = allowedSorts.includes(sortField) ? sortField : 'created_at';
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sort} ${order}`;

    // Pagination
    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit) || 20));
    const offset = (page - 1) * limit;
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params);
    const total = this._count(userId, filters);

    return { rows, total, page, limit };
  }

  _count(userId, filters = {}) {
    let sql = 'SELECT COUNT(*) as count FROM tasks WHERE user_id = ?';
    const params = [userId];
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters.assigned_to) { sql += ' AND assigned_to = ?'; params.push(filters.assigned_to); }
    if (filters.parent_id !== undefined) { sql += ' AND parent_id = ?'; params.push(filters.parent_id); }
    return this.db.prepare(sql).get(...params).count;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  findByIdAndUser(id, userId) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  }

  findChildren(parentId) {
    return this.db.prepare('SELECT * FROM tasks WHERE parent_id = ?').all(parentId);
  }

  getAssignedTasks(userId) {
    return this.db.prepare(
      'SELECT * FROM tasks WHERE assigned_to = ? AND status != ? ORDER BY created_at DESC'
    ).all(userId, 'done');
  }

  create({ title, userId, dueDate, parentId }) {
    return this.db.prepare(
      `INSERT INTO tasks (title, user_id, due_date, parent_id)
       VALUES (?, ?, ?, ?)`
    ).run(title, userId, dueDate || null, parentId || null);
  }

  update(id, fields) {
    const allowed = ['title', 'status', 'assigned_to', 'result', 'due_date'];
    const sets = [];
    const params = [];

    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }

    if (sets.length === 0) return { changes: 0 };

    sets.push("updated_at = datetime('now')");
    params.push(id);

    return this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id) {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  hasActiveChildren(id) {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE parent_id = ? AND status NOT IN ('done','rejected')"
    ).get(id);
    return row.count > 0;
  }

  // --- Status machine transitions ---

  assign(id, assignedTo) {
    return this.update(id, { status: 'assigned', assigned_to: assignedTo });
  }

  start(id) {
    const task = this.findById(id);
    if (task && task.status === 'assigned') {
      return this.update(id, { status: 'in_progress' });
    }
    return { changes: 0, error: 'Can only start tasks with status: assigned' };
  }

  submit(id, result) {
    const task = this.findById(id);
    if (!task) return { changes: 0, error: 'Task not found' };
    if (task.status !== 'in_progress') {
      return { changes: 0, error: 'Can only submit tasks with status: in_progress' };
    }
    const jsonResult = typeof result === 'object' ? JSON.stringify(result) : result;
    const r = this.update(id, { status: 'done', result: jsonResult });
    // Check: all siblings done → wake parent
    this._maybeWakeParent(task.parent_id);
    return r;
  }

  review(id, verdict, note) {
    const task = this.findById(id);
    if (!task) return { error: 'Task not found', status: 404 };
    if (task.status !== 'done') {
      return { error: 'Can only review tasks with status: done', status: 409 };
    }
    if (verdict === 'accept') {
      this.update(id, { status: 'done' }); // stays done
      this._maybeWakeParent(task.parent_id);
      return { id, status: 'done', verdict: 'accepted' };
    } else if (verdict === 'reject') {
      this.update(id, { status: 'rejected', result: note || null });
      return { id, status: 'rejected', verdict: 'rejected' };
    }
  }

  _maybeWakeParent(parentId) {
    if (!parentId) return;
    const siblings = this.db.prepare(
      'SELECT COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as done_count FROM tasks WHERE parent_id = ?'
    ).get('done', parentId);
    if (siblings.total > 0 && siblings.total === siblings.done_count) {
      this.update(parentId, { status: 'in_progress' });
      // Trigger webhook callback
      this._notifyParent(parentId);
    }
  }

  _notifyParent(taskId) {
    const task = this.findById(taskId);
    if (!task) return;
    const owner = this.db.prepare(
      'SELECT * FROM users WHERE id = ? AND callback_url IS NOT NULL'
    ).get(task.user_id);
    if (owner) {
      // Defer to webhook module — handled in Task 12
      this.db.prepare(
        "INSERT OR IGNORE INTO callback_queue (task_id, url, created_at) VALUES (?, ?, datetime('now'))"
      ).run(taskId, owner.callback_url);
    }
  }
}
```

Note: `callback_queue` table will be added when we implement webhooks in Task 12. For now, the `_notifyParent` call fails silently if the table doesn't exist — or we can create it alongside tasks schema. We'll handle it there.

- [ ] **Step 2: Extend schema to include callback_queue**

Modify `src/db.js` — add to SCHEMA:
```sql
CREATE TABLE IF NOT EXISTS callback_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    url TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
    retries INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 3: Verify model in REPL**

```bash
node -e "
import { initDb } from './src/db.js';
import { Task } from './src/models/Task.js';
const db = initDb(':memory:');
const t = new Task(db);
// Register a user first
db.prepare(\"INSERT INTO users (username, token, role) VALUES ('u1','t1','human')\").run();
const r = t.create({title:'Test task', userId:1});
console.log('Created:', r.lastInsertRowid);
console.log(t.list({userId:1}));
"
```

- [ ] **Step 4: Commit**

```bash
git add src/models/Task.js src/db.js
git commit -m "feat: task model with CRUD, status machine, and sibling-wake logic"
```

---

### Task 8: Task Controller + Routes

**Files:**
- Create: `src/controllers/taskController.js`
- Create: `src/routes/tasks.js`

- [ ] **Step 1: Write task controller**

Create `src/controllers/taskController.js`:
```javascript
import { Task } from '../models/Task.js';

export function listTasks(req, res) {
  const taskModel = new Task(req.db);
  const {
    status, assigned_to, parent_id, role,
    sort, order, page, limit
  } = req.query;

  const result = taskModel.list({
    userId: req.user.id,
    filters: {
      status,
      assigned_to: assigned_to ? Number(assigned_to) : undefined,
      parent_id: parent_id !== undefined ? Number(parent_id) : undefined,
      role,
      sort,
      order,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    }
  });

  res.json({
    tasks: result.rows,
    total: result.total,
    page: result.page,
    limit: result.limit
  });
}

export function getTask(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const children = taskModel.findChildren(task.id);
  res.json({ ...task, children });
}

export function createTask(req, res) {
  const taskModel = new Task(req.db);
  const { title, due_date, parent_id, subtasks } = req.body;

  // If parent_id is set, verify ownership and existence
  if (parent_id) {
    const parent = taskModel.findById(parent_id);
    if (!parent || parent.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Parent task not found' });
    }
  }

  const result = taskModel.create({
    title,
    userId: req.user.id,
    dueDate: due_date,
    parentId: parent_id
  });

  const mainId = result.lastInsertRowid;

  // Handle inline subtask creation
  const createdSubtasks = [];
  if (subtasks && Array.isArray(subtasks)) {
    for (const st of subtasks) {
      const sr = taskModel.create({
        title: st.title,
        userId: req.user.id,
        dueDate: st.due_date,
        parentId: mainId
      });
      createdSubtasks.push(sr.lastInsertRowid);
    }
  }

  res.status(201).json({
    id: mainId,
    title,
    subtask_ids: createdSubtasks,
    status: 'open'
  });
}

export function updateTask(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const fields = {};
  if (req.body.title !== undefined) fields.title = req.body.title;
  if (req.body.status !== undefined) fields.status = req.body.status;
  if (req.body.assigned_to !== undefined) fields.assigned_to = req.body.assigned_to;
  if (req.body.result !== undefined) fields.result = req.body.result;
  if (req.body.due_date !== undefined) fields.due_date = req.body.due_date;

  taskModel.update(req.taskId, fields);
  const updated = taskModel.findById(req.taskId);
  res.json(updated);
}

export function patchTask(req, res) {
  // Reuse same logic as updateTask — Express 5 accepts both PUT and PATCH
  updateTask(req, res);
}

export function deleteTask(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (taskModel.hasActiveChildren(req.taskId)) {
    return res.status(409).json({
      error: 'Cannot delete task with active child tasks. Delete or complete children first.'
    });
  }

  taskModel.delete(req.taskId);
  res.status(204).send();
}
```

- [ ] **Step 2: Wire task routes**

Create `src/routes/tasks.js`:
```javascript
import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validateIdParam, requireFields, validateEnum } from '../middleware/validate.js';
import {
  listTasks, getTask, createTask, updateTask, patchTask, deleteTask
} from '../controllers/taskController.js';

export const taskRoutes = Router();

// All task routes require auth
taskRoutes.use(auth);

// List + Create
taskRoutes.get('/', listTasks);
taskRoutes.post('/', requireFields('title'), createTask);

// Single task operations (all use :id validation)
taskRoutes.get('/:id', validateIdParam, getTask);
taskRoutes.put('/:id', validateIdParam, updateTask);
taskRoutes.patch('/:id', validateIdParam, patchTask);
taskRoutes.delete('/:id', validateIdParam, deleteTask);
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/taskController.js src/routes/tasks.js
git commit -m "feat: task CRUD endpoints with subtask creation and child-deletion guard"
```

---

### Task 9: Task Integration Tests

**Files:**
- Create: `tests/tasks.test.js`

- [ ] **Step 1: Write task tests**

Create `tests/tasks.test.js`:
```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp, registerAgent } from './setup.js';

async function body(res) { return res.json(); }

describe('Task CRUD', () => {
  let app, token;

  beforeAll(async () => {
    ({ app } = setupTestApp());
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'task-owner', role: 'human' })
    });
    ({ token } = await regRes.json());
  });

  const auth = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

  it('POST /api/tasks creates a task', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: 'Build API' })
    });
    expect(res.status).toBe(201);
    const data = await body(res);
    expect(data.id).toBeGreaterThan(0);
    expect(data.title).toBe('Build API');
  });

  it('POST /api/tasks creates task with subtasks', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        title: 'Main task',
        subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2' }]
      })
    });
    expect(res.status).toBe(201);
    const data = await body(res);
    expect(data.subtask_ids.length).toBe(2);
  });

  it('GET /api/tasks returns task list with pagination', async () => {
    const res = await app.request('/api/tasks?page=1&limit=10', {
      headers: auth()
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(data.total).toBeDefined();
  });

  it('GET /api/tasks/:id returns task with children', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        title: 'Parent',
        subtasks: [{ title: 'Child' }]
      })
    });
    const { id } = await create.json();
    const res = await app.request(`/api/tasks/${id}`, { headers: auth() });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.children.length).toBe(1);
  });

  it('PUT /api/tasks/:id updates a task', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: 'Original' })
    });
    const { id } = await create.json();
    const res = await app.request(`/api/tasks/${id}`, {
      method: 'PUT', headers: auth(),
      body: JSON.stringify({ title: 'Updated' })
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.title).toBe('Updated');
  });

  it('DELETE /api/tasks/:id deletes an open task', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: 'To delete' })
    });
    const { id } = await create.json();
    const res = await app.request(`/api/tasks/${id}`, {
      method: 'DELETE', headers: auth()
    });
    expect(res.status).toBe(204);
  });

  it('DELETE returns 409 for task with active children', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ title: 'Parent with child', subtasks: [{ title: 'Active child' }] })
    });
    const { id } = await create.json();
    const res = await app.request(`/api/tasks/${id}`, {
      method: 'DELETE', headers: auth()
    });
    expect(res.status).toBe(409);
  });

  it('GET /api/tasks/:id returns 404 for non-existent task', async () => {
    const res = await app.request('/api/tasks/99999', { headers: auth() });
    expect(res.status).toBe(404);
  });

  it('cannot see tasks of another user', async () => {
    const { app: app2 } = setupTestApp();
    const reg2 = await app2.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other-user', role: 'human' })
    });
    const { token: token2 } = await reg2.json();
    // Create a task with the other user
    await app2.request('/api/tasks', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Other task' })
    });
    // Primary user should not see it
    const res = await app.request('/api/tasks', { headers: auth() });
    const data = await body(res);
    const hasOtherTask = data.tasks.some(t => t.title === 'Other task');
    expect(hasOtherTask).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/tasks.test.js`
Expected: 9 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/tasks.test.js
git commit -m "test: task CRUD integration tests"
```

---

### Task 10: Agent Collaboration Controller

**Files:**
- Create: `src/controllers/agentController.js`

- [ ] **Step 1: Write agent collaboration controller**

Create `src/controllers/agentController.js`:
```javascript
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';

export function assign(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { assigned_to } = req.body;
  if (!assigned_to) {
    return res.status(400).json({ error: 'assigned_to is required' });
  }

  // Verify assignee exists and is an agent
  const userModel = new User(req.db);
  const assignee = userModel.findById(assigned_to);
  if (!assignee) {
    return res.status(400).json({ error: 'Assignee not found' });
  }
  if (assignee.role !== 'agent') {
    return res.status(400).json({ error: 'Tasks can only be assigned to agents' });
  }

  taskModel.assign(req.taskId, assigned_to);
  const updated = taskModel.findById(req.taskId);
  res.json(updated);
}

export function submit(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'You are not assigned to this task' });
  }
  if (task.status !== 'in_progress' && task.status !== 'assigned' && task.status !== 'rejected') {
    return res.status(409).json({ error: `Cannot submit task with status: ${task.status}` });
  }

  const { result } = req.body;
  if (result === undefined) {
    return res.status(400).json({ error: 'result is required' });
  }

  // Auto-start if still in assigned state
  if (task.status === 'assigned') {
    taskModel.start(req.taskId);
  }

  const r = taskModel.submit(req.taskId, result);
  if (r.error) {
    return res.status(400).json({ error: r.error });
  }

  const updated = taskModel.findById(req.taskId);
  res.json(updated);
}

export function review(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { verdict, note } = req.body;
  if (!['accept', 'reject'].includes(verdict)) {
    return res.status(400).json({ error: 'verdict must be accept or reject' });
  }

  const r = taskModel.review(req.taskId, verdict, note);
  if (r.error) {
    return res.status(r.status || 400).json({ error: r.error });
  }

  const updated = taskModel.findById(req.taskId);
  res.json({ ...updated, reviewed: r });
}

export function createSubtasks(req, res) {
  const taskModel = new Task(req.db);
  const task = taskModel.findById(req.taskId);

  if (!task || task.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { subtasks } = req.body;
  if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
    return res.status(400).json({ error: 'subtasks must be a non-empty array' });
  }

  const ids = [];
  for (const st of subtasks) {
    if (!st.title) {
      return res.status(400).json({ error: 'Each subtask must have a title' });
    }
    const r = taskModel.create({
      title: st.title,
      userId: req.user.id,
      dueDate: st.due_date || null,
      parentId: req.taskId
    });
    ids.push(r.lastInsertRowid);
  }

  res.status(201).json({ parent_id: req.taskId, subtask_ids: ids, count: ids.length });
}

export function listAgents(req, res) {
  const userModel = new User(req.db);
  const { source, capabilities } = req.query;

  const agents = userModel.listAgents({
    source: source || undefined,
    capabilities: capabilities || undefined
  });

  // Parse capabilities from JSON string to array
  const parsed = agents.map(a => ({
    ...a,
    capabilities: (() => {
      try { return JSON.parse(a.capabilities); }
      catch { return []; }
    })()
  }));

  res.json({ agents: parsed, total: parsed.length });
}
```

- [ ] **Step 2: Wire agent routes**

Create `src/routes/agents.js`:
```javascript
import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validateIdParam, requireFields } from '../middleware/validate.js';
import {
  assign, submit, review, createSubtasks, listAgents
} from '../controllers/agentController.js';

export const agentRoutes = Router();

// Agent discovery (light auth — any valid token works)
agentRoutes.get('/', auth, listAgents);

// Task-specific agent operations
agentRoutes.post('/tasks/:id/assign', auth, validateIdParam, requireFields('assigned_to'), assign);
agentRoutes.post('/tasks/:id/submit', auth, validateIdParam, requireFields('result'), submit);
agentRoutes.post('/tasks/:id/review', auth, validateIdParam, requireFields('verdict'), review);
agentRoutes.post('/tasks/:id/subtasks', auth, validateIdParam, requireFields('subtasks'), createSubtasks);
```

Note: The agent routes mount at `/api/agents` in `app.js`, but the collaboration endpoints (`assign`, `submit`, etc.) are task-scoped. Adjust routing:

Update `src/app.js` — change agent routes mounting:
```javascript
// In createApp:
app.use('/api/tasks', taskRoutes);
app.use('/api/agents', agentRoutes);
```

And move the listAgents endpoint to `GET /` on agentRoutes, and the task-scoped endpoints should actually be on task routes. Let's split them:

Update `src/routes/tasks.js` — add collaboration routes:
```javascript
import { assign, submit, review, createSubtasks } from '../controllers/agentController.js';

// ... inside taskRoutes after the existing routes:
taskRoutes.post('/:id/assign', validateIdParam, requireFields('assigned_to'), assign);
taskRoutes.post('/:id/submit', validateIdParam, requireFields('result'), submit);
taskRoutes.post('/:id/review', validateIdParam, requireFields('verdict'), review);
taskRoutes.post('/:id/subtasks', validateIdParam, requireFields('subtasks'), createSubtasks);
```

And simplify `src/routes/agents.js` to just agent discovery:
```javascript
import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { listAgents } from '../controllers/agentController.js';

export const agentRoutes = Router();
agentRoutes.get('/', auth, listAgents);
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/agentController.js src/routes/agents.js src/routes/tasks.js
git commit -m "feat: agent collaboration — assign, submit, review, subtasks, agent discovery"
```

---

### Task 11: Collaboration Integration Tests

**Files:**
- Create: `tests/collaboration.test.js`

- [ ] **Step 1: Write collaboration tests**

Create `tests/collaboration.test.js`:
```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp } from './setup.js';

async function body(res) { return res.json(); }

describe('Agent Collaboration', () => {
  let app, ownerToken, agentToken, agentId, ownerId;

  beforeAll(async () => {
    ({ app } = setupTestApp());

    // Register owner (human)
    const ownerRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', role: 'human' })
    });
    const ownerData = await ownerRes.json();
    ownerToken = ownerData.token;
    ownerId = ownerData.id;

    // Register agent
    const agentRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'worker-agent',
        role: 'agent',
        source: 'openclaw',
        capabilities: ['code-gen', 'review']
      })
    });
    const agentData = await agentRes.json();
    agentToken = agentData.token;
    agentId = agentData.id;
  });

  const ownerAuth = () => ({
    'Authorization': `Bearer ${ownerToken}`,
    'Content-Type': 'application/json'
  });
  const agentAuth = () => ({
    'Authorization': `Bearer ${agentToken}`,
    'Content-Type': 'application/json'
  });

  it('assigns a task to an agent', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Review PR #42' })
    });
    const { id } = await create.json();

    const res = await app.request(`/api/tasks/${id}/assign`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ assigned_to: agentId })
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.status).toBe('assigned');
    expect(data.assigned_to).toBe(agentId);
  });

  it('agent can submit result for assigned task', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Write tests' })
    });
    const { id } = await create.json();

    // Assign
    await app.request(`/api/tasks/${id}/assign`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ assigned_to: agentId })
    });

    // Agent auto-starts and submits
    const res = await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST', headers: agentAuth(),
      body: JSON.stringify({ result: 'All tests pass, coverage 95%' })
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.status).toBe('done');
    expect(data.result).toContain('coverage');
  });

  it('owner can accept submitted work', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Deploy to staging' })
    });
    const { id } = await create.json();

    await app.request(`/api/tasks/${id}/assign`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ assigned_to: agentId })
    });
    await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST', headers: agentAuth(),
      body: JSON.stringify({ result: 'Deployed successfully' })
    });

    const res = await app.request(`/api/tasks/${id}/review`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ verdict: 'accept', note: 'Looks good' })
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.reviewed.verdict).toBe('accepted');
  });

  it('owner can reject and agent resubmits', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Fix login bug' })
    });
    const { id } = await create.json();

    await app.request(`/api/tasks/${id}/assign`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ assigned_to: agentId })
    });
    await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST', headers: agentAuth(),
      body: JSON.stringify({ result: 'Initial fix' })
    });

    // Reject
    await app.request(`/api/tasks/${id}/review`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ verdict: 'reject', note: 'Missing edge case handling' })
    });

    // Agent resubmits
    const res = await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST', headers: agentAuth(),
      body: JSON.stringify({ result: 'Fixed with edge cases' })
    });
    // After reject, the agent resubmits — submit() accepts 'rejected' for re-submission
    const res = await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST', headers: agentAuth(),
      body: JSON.stringify({ result: 'Fixed with edge cases' })
    });
    expect(res.status).toBe(200);
    const data2 = await body(res);
    expect(data2.status).toBe('done');
    expect(data2.result).toContain('edge cases');
  });

  it('non-assigned agent cannot submit', async () => {
    // Register a second agent
    const r2 = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'agent-2',
        role: 'agent',
        source: 'hermes'
      })
    });
    const { token: token2 } = await r2.json();

    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Top secret' })
    });
    const { id } = await create.json();

    // Assign to first agent
    await app.request(`/api/tasks/${id}/assign`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ assigned_to: agentId })
    });

    // Second agent tries to submit
    const res = await app.request(`/api/tasks/${id}/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token2}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ result: 'hacked' })
    });
    expect(res.status).toBe(403);
  });

  it('lists agents with filtering', async () => {
    const res = await app.request('/api/agents?source=openclaw', {
      headers: ownerAuth()
    });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.agents.length).toBeGreaterThanOrEqual(1);
    expect(data.agents.every(a => a.source === 'openclaw')).toBe(true);
  });

  it('creates subtasks for a parent task', async () => {
    const create = await app.request('/api/tasks', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ title: 'Release v2.0' })
    });
    const { id } = await create.json();

    const res = await app.request(`/api/tasks/${id}/subtasks`, {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({
        subtasks: [
          { title: 'Run CI', due_date: '2026-05-10' },
          { title: 'Update docs' },
          { title: 'Notify users' }
        ]
      })
    });
    expect(res.status).toBe(201);
    const data = await body(res);
    expect(data.count).toBe(3);
  });
});
```

- [ ] **Step 2: Fix submit to accept rejected → done transition**

This test reveals a bug: submit should accept `rejected` status for resubmission.
Update `src/models/Task.js` — modify `submit()`:

```javascript
submit(id, result) {
  const task = this.findById(id);
  if (!task) return { changes: 0, error: 'Task not found' };
  if (task.status !== 'in_progress' && task.status !== 'rejected' && task.status !== 'assigned') {
    return { changes: 0, error: 'Can only submit tasks with status: in_progress, rejected, or assigned' };
  }
  const jsonResult = typeof result === 'object' ? JSON.stringify(result) : result;
  const r = this.update(id, { status: 'done', result: jsonResult });
  this._maybeWakeParent(task.parent_id);
  return r;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/collaboration.test.js`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/collaboration.test.js src/models/Task.js
git commit -m "test: agent collaboration integration tests; allow re-submit from rejected"
```

---

### Task 12: Webhook Callback for Parent Tasks

**Files:**
- Create: `src/controllers/webhook.js`
- Modify: `src/models/Task.js`

- [ ] **Step 1: Create a callback_queue table if not already done**

The schema in Task 2 already has it (added in Step 2 of Task 7). Verify `src/db.js` includes the callback_queue table.

- [ ] **Step 2: Write webhook controller**

Create `src/controllers/webhook.js`:
```javascript
export function sendCallback(db, taskId, url) {
  const task = db.prepare(
    'SELECT id, title, status, created_at, updated_at FROM tasks WHERE id = ?'
  ).get(taskId);

  const payload = {
    task_id: task.id,
    title: task.title,
    status: task.status,
    action: 'all_subtasks_complete',
    created_at: task.created_at,
    updated_at: task.updated_at
  };

  // Non-blocking fire-and-forget POST
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  })
    .then(response => {
      const s = response.ok ? 'sent' : 'failed';
      db.prepare(
        'UPDATE callback_queue SET status = ?, retries = retries + 1, last_error = ? WHERE task_id = ? AND url = ?'
      ).run(s, response.statusText, taskId, url);
    })
    .catch(err => {
      db.prepare(
        'UPDATE callback_queue SET status = ?, retries = retries + 1, last_error = ? WHERE task_id = ? AND url = ?'
      ).run('failed', err.message, taskId, url);
    });
}

export function getCallbackStatus(db, taskId) {
  return db.prepare(
    'SELECT * FROM callback_queue WHERE task_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(taskId);
}

export function retryFailedCallbacks(db) {
  const pending = db.prepare(
    "SELECT * FROM callback_queue WHERE status = 'failed' AND retries < 3"
  ).all();

  for (const cb of pending) {
    sendCallback(db, cb.task_id, cb.url);
  }
}
```

- [ ] **Step 3: Integrate webhook into Task model**

Update `src/models/Task.js` — modify `_notifyParent()`:

```javascript
import('../controllers/webhook.js').then(({ sendCallback }) => {
  sendCallback(this.db, taskId, owner.callback_url);
}).catch(() => {});
```

Actually, let's use a simpler approach — pass the db directly:

```javascript
_notifyParent(taskId) {
  const task = this.findById(taskId);
  if (!task) return;
  const owner = this.db.prepare(
    'SELECT * FROM users WHERE id = ? AND callback_url IS NOT NULL'
  ).get(task.user_id);
  if (owner) {
    // Queue callback
    this.db.prepare(
      "INSERT OR IGNORE INTO callback_queue (task_id, url) VALUES (?, ?)"
    ).run(taskId, owner.callback_url);
  }
}
```

And we need a periodic retry mechanism. Add to `src/index.js`:

```javascript
import { retryFailedCallbacks } from './controllers/webhook.js';
// Every 30 seconds, retry failed callbacks
setInterval(() => retryFailedCallbacks(db), 30000);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/webhook.js src/models/Task.js src/index.js
git commit -m "feat: webhook callback for parent task wake-up with retry"
```

---

### Task 13: Error Handler Middleware

**Files:**
- Create: `src/middleware/errorHandler.js`

- [ ] **Step 1: Write error handler**

Create `src/middleware/errorHandler.js`:
```javascript
export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  // JSON parse error
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  // SQLite constraint errors
  if (err.message && err.message.includes('CHECK constraint failed')) {
    const field = err.message.match(/CHECK constraint failed: (\w+)/)?.[1] || 'unknown';
    return res.status(400).json({ error: `Constraint violation: ${field}` });
  }

  // SQLite foreign key errors
  if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }

  // Default 500
  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/errorHandler.js
git commit -m "feat: unified error handler middleware"
```

---

### Task 14: Edge Case Integration Tests

**Files:**
- Create: `tests/edgecases.test.js`

- [ ] **Step 1: Write edge case tests**

Create `tests/edgecases.test.js`:
```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestApp } from './setup.js';

async function body(res) { return res.json(); }

describe('Edge Cases', () => {
  let app, token;

  beforeAll(async () => {
    ({ app } = setupTestApp());
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'edge-tester', role: 'human' })
    });
    ({ token } = await reg.json());
  });

  const headers = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  it('rejects empty title with 400', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ title: '' })
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric task id with 400', async () => {
    const res = await app.request('/api/tasks/abc', { headers: headers() });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body gracefully', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: '{invalid json'
    });
    expect(res.status).toBe(400);
  });

  it('pagination default — page < 1 gives first page', async () => {
    const res = await app.request('/api/tasks?page=-1', { headers: headers() });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.page).toBe(1);
  });

  it('limit caps at 100', async () => {
    const res = await app.request('/api/tasks?limit=999', { headers: headers() });
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.limit).toBeLessThanOrEqual(100);
  });

  it('ignores extra fields in request body', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ title: 'Valid', extra_field: 'should be ignored' })
    });
    expect(res.status).toBe(201);
  });

  it('cannot access a task that belongs to another user', async () => {
    // Create with a different user
    const { app: app2 } = setupTestApp();
    const reg2 = await app2.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other-edge', role: 'human' })
    });
    const { token: t2 } = await reg2.json();

    const createRes = await app2.request('/api/tasks', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${t2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Private task' })
    });
    const { id } = await createRes.json();

    // Try to access with primary user
    const res = await app.request(`/api/tasks/${id}`, { headers: headers() });
    expect(res.status).toBe(404);
  });

  it('health endpoint works without auth', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all ~30 tests pass across 4 test files

- [ ] **Step 3: Commit**

```bash
git add tests/edgecases.test.js
git commit -m "test: edge case integration tests"
```

---

### Task 15: Final Integration and Smoke Test

- [ ] **Step 1: Full end-to-end scenario test**

Create `tests/smoke.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { setupTestApp } from './setup.js';

async function body(res) { return res.json(); }

describe('Smoke Test — Full Agent Workflow', () => {
  it('completes a full task lifecycle across agents', async () => {
    const { app } = setupTestApp();

    // 1. Register primary agent (OpenCLAW)
    const primaryReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'openclaw-main',
        role: 'agent',
        source: 'openclaw',
        capabilities: ['orchestration']
      })
    });
    const { token: primaryToken } = await primaryReg.json();

    // 2. Register worker agents
    const codeAgentReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'hermes-coder',
        role: 'agent',
        source: 'hermes',
        capabilities: ['code-gen']
      })
    });
    const { token: codeToken, id: codeAgentId } = await codeAgentReg.json();

    const reviewAgentReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'openclaw-reviewer',
        role: 'agent',
        source: 'openclaw',
        capabilities: ['review']
      })
    });
    const { token: reviewToken, id: reviewAgentId } = await reviewAgentReg.json();

    const authH = t => ({ 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' });

    // 3. Primary creates parent task with subtasks
    const parentRes = await app.request('/api/tasks', {
      method: 'POST', headers: authH(primaryToken),
      body: JSON.stringify({
        title: 'Implement user login',
        subtasks: [
          { title: 'Write auth middleware' },
          { title: 'Write tests for auth' }
        ]
      })
    });
    const { id: parentId, subtask_ids } = await parentRes.json();
    expect(subtask_ids.length).toBe(2);

    // 4. Assign subtask 1 to hermes-coder
    await app.request(`/api/tasks/${subtask_ids[0]}/assign`, {
      method: 'POST', headers: authH(primaryToken),
      body: JSON.stringify({ assigned_to: codeAgentId })
    });

    // 5. Assign subtask 2 to openclaw-reviewer
    await app.request(`/api/tasks/${subtask_ids[1]}/assign`, {
      method: 'POST', headers: authH(primaryToken),
      body: JSON.stringify({ assigned_to: reviewAgentId })
    });

    // 6. Hermes coder submits subtask 1
    const submit1Res = await app.request(`/api/tasks/${subtask_ids[0]}/submit`, {
      method: 'POST', headers: authH(codeToken),
      body: JSON.stringify({ result: 'Auth middleware implemented with JWT' })
    });
    expect(submit1Res.status).toBe(200);
    const submit1Data = await submit1Res.json();
    expect(submit1Data.status).toBe('done');

    // 7. Reviewer agent submits subtask 2
    const submit2Res = await app.request(`/api/tasks/${subtask_ids[1]}/submit`, {
      method: 'POST', headers: authH(reviewToken),
      body: JSON.stringify({ result: '100% test coverage, all passing' })
    });
    expect(submit2Res.status).toBe(200);
    const submit2Data = await submit2Res.json();
    expect(submit2Data.status).toBe('done');

    // 8. Verify parent task is now in_progress (all children done)
    const parentCheck = await app.request(`/api/tasks/${parentId}`, {
      headers: authH(primaryToken)
    });
    const parentData = await parentCheck.json();
    expect(parentData.status).toBe('in_progress');

    // 9. Primary accepts both subtasks
    await app.request(`/api/tasks/${subtask_ids[0]}/review`, {
      method: 'POST', headers: authH(primaryToken),
      body: JSON.stringify({ verdict: 'accept' })
    });
    await app.request(`/api/tasks/${subtask_ids[1]}/review`, {
      method: 'POST', headers: authH(primaryToken),
      body: JSON.stringify({ verdict: 'accept' })
    });

    // 10. Primary marks parent as done
    const finalRes = await app.request(`/api/tasks/${parentId}`, {
      method: 'PATCH', headers: authH(primaryToken),
      body: JSON.stringify({ status: 'done' })
    });
    const finalData = await finalRes.json();
    expect(finalData.status).toBe('done');

    console.log('Full workflow completed successfully');
  });
});
```

- [ ] **Step 2: Run smoke test**

Run: `npx vitest run tests/smoke.test.js`
Expected: passes with the full lifecycle

- [ ] **Step 3: Run complete test suite**

Run: `npx vitest run`
Expected: all test files pass

- [ ] **Step 4: Final commit**

```bash
git add tests/smoke.test.js
git commit -m "test: full agent workflow smoke test"
```
