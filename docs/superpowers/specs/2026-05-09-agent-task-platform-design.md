# Multi-Agent Task Platform — Design Spec

**Date:** 2026-05-09
**Stack:** Node.js + Express + SQLite (better-sqlite3)

---

## Overview

A multi-tenant task orchestration platform where agents (OpenCLAW, Hermes, etc.)
are registered as users with agent-level capabilities. A primary agent creates
tasks, assigns sub-tasks to other agents, collects their results, and reviews them.
When all sub-tasks complete, the platform can wake the primary agent via a
callback URL.

## Entity Model

### User / Agent (unified `users` table)

Agents and humans share the same table. An `agent` is simply a user with
`role = 'agent'`.

```
id              INTEGER PRIMARY KEY
username        TEXT NOT NULL UNIQUE
token           TEXT NOT NULL UNIQUE
role            TEXT DEFAULT 'human'   -- 'human' | 'agent'
source          TEXT                   -- 'openclaw' | 'hermes' | NULL (human)
capabilities    TEXT                   -- JSON array: ["code-gen","review"]
callback_url    TEXT                   -- webhook URL to wake agent
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

### Task (`tasks` table)

```
id              INTEGER PRIMARY KEY
user_id         INTEGER NOT NULL REFERENCES users(id)
title           TEXT NOT NULL
status          TEXT DEFAULT 'open'
                -- open | assigned | in_progress | done | rejected | blocked
parent_id       INTEGER REFERENCES tasks(id)
assigned_to     INTEGER REFERENCES users(id)
result          TEXT                   -- agent's submitted result (JSON or text)
due_date        DATETIME
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
```

### Status Machine

```
open ──assign──> assigned ──start──> in_progress
                                       │
                       ┌──────done─────┤ (agent submits)
                       │               │
                       ▼               ▼
                     done          rejected (primary agent rejects)
                       │               │
                       │               └──resubmit──> in_progress
                       │
                       ▼ (all siblings done, notifies parent)
                  parent_task: blocked → in_progress
```

## API Endpoints

### Auth

```
POST   /api/auth/register    { username, role?, source?, capabilities?, callback_url? } → { id, token }
GET    /api/auth/me          → current user info (inc. agent metadata)
```

### Tasks (auth required)

```
GET    /api/tasks            ?status=&assigned_to=&parent_id=&role=owner|assigned&sort=&order=&page=&limit=
POST   /api/tasks            { title, due_date?, parent_id?, subtasks?: [...] }
GET    /api/tasks/:id        → task detail with child tasks
PUT    /api/tasks/:id        full update (title, due_date, assigned_to, status)
PATCH  /api/tasks/:id        partial update
DELETE /api/tasks/:id        409 if has open child tasks
```

### Agent Collaboration

```
POST   /api/tasks/:id/assign    { assigned_to }          → status: assigned
POST   /api/tasks/:id/submit    { result }               → status: done
POST   /api/tasks/:id/review    { verdict, note? }       → status: done or rejected
POST   /api/tasks/:id/subtasks  { subtasks: [{title,assigned_to?,due_date?}] }
```

### Agent Discovery

```
GET    /api/agents             ?source=&capabilities=
```

## Edge Cases

| Scenario | Behavior | HTTP |
|----------|----------|------|
| Missing/invalid token | Deny with error | 401 |
| Accessing another user's task | Treat as not found | 404 |
| Agent operates on unassigned task | Deny | 403 |
| Delete task with active children | Conflict | 409 |
| Assign to non-agent user | Validation error | 400 |
| Duplicate submit on same task | Idempotent guard | 409 |
| Duplicate review (already accepted) | Return OK, no side effect | 200 |
| All siblings done | Parent status: blocked → in_progress | — |
| callback_url unreachable | Log failure, do not block state transition | — |
| Empty title | Validation error | 400 |
| Invalid status transition | Validation error | 400 |
| ID not numeric | Route match failure or | 400 |

## File Structure

```
src/
  db.js                      SQLite connection + schema + migrations
  middleware/
    auth.js                  Token extraction, verification, req.user injection
    errorHandler.js          Unified error responses
    validate.js              Request body/query validation
  models/
    User.js                  user CRUD, findByToken, register
    Task.js                  task CRUD, tree queries, status machine, submit/review
  controllers/
    authController.js        register, me
    taskController.js        CRUD + filter/sort/paginate
    agentController.js       assign, submit, review, subtasks, list agents
    webhook.js              Callback URL posting + retry logging
  routes/
    auth.js                  /api/auth/*
    tasks.js                 /api/tasks/*
    agents.js                /api/agents
  app.js                     Express assembly
  index.js                   Entry point, start server
tests/
  setup.js                   Test DB + seed data
  auth.test.js
  tasks.test.js
  collaboration.test.js
  edgecases.test.js
```
