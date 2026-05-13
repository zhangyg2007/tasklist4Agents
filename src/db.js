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
