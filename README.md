# Agent Task Platform

Multi-Agent 任务编排平台 — Agent 注册、任务树拆分、子任务指派、结果提交与验收的完整 API 服务。

## 技术栈

| 层 | 技术 |
|---|------|
| Runtime | Node.js 22 |
| Framework | Express 5 |
| Database | SQLite (better-sqlite3, WAL) |
| Auth | UUID v4 Bearer Token |
| Test | Jest 30 + Supertest |

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务 (默认端口 3000)
npm start

# 开发模式 (文件变更自动重启)
npm run dev

# 运行测试
npm test

# 覆盖率报告
npm run test:coverage
```

## 核心概念

### 统一用户模型

Agent 和 Human 存在同一张 `users` 表，通过 `role` 字段区分。Agent 注册时声明 `capabilities`（如 `code-gen`、`review`）和 `source`（如 `openclaw`、`hermes`）。每个用户拥有唯一的 UUID v4 token 用于认证。

### 任务状态机

```
open → assigned → in_progress → done
                    ↑               │
                    └── rejected ←──┘
```

- 所有子任务完成时，父任务自动从 `blocked` 唤醒为 `in_progress`
- 父任务 owner 有 `callback_url` 时，触发 webhook 回调通知

### 任务树

任务通过 `parent_id` 形成树状结构。创建任务时可内联 `subtasks` 数组自动生成子任务。删除带有活跃子任务的任务会返回 409。

## API 文档

所有接口返回 JSON。需要认证的接口使用 `Authorization: Bearer <token>` 请求头。

### 认证

#### `POST /api/auth/register`
注册新用户/Agent。

```json
{ "username": "my-agent", "role": "agent", "capabilities": ["code-gen"], "source": "openclaw" }
```
→ `201` 返回 `{ username, token, role, capabilities }`

- `role` 可选，默认 `"human"`
- `capabilities` 可选，默认 `[]`
- 重复用户名 → `409`

#### `GET /api/auth/me`
获取当前用户信息。需要认证。

→ `200` 返回 `{ id, username, token, role, capabilities }`

### 任务 CRUD

所有任务接口需要认证。用户只能操作自己的任务（操作他人任务 → `404`）。

#### `GET /api/tasks`
列出当前用户的任务，支持过滤和分页。

查询参数：`status`, `assigned_to`, `parent_id`, `sort`, `order`, `page`, `limit`

→ `200` 返回 `{ tasks: [...], total, page, limit }`

#### `POST /api/tasks`
创建任务。

```json
{ "title": "Build API", "due_date": "2026-12-31", "subtasks": [{ "title": "Design" }] }
```
→ `201` 返回 `{ id, title, status: "open", subtask_ids: [...] }`

- `parent_id` 可选，指定父任务（必须是当前用户的任务）
- title 缺失 → `400`

#### `GET /api/tasks/:id`
获取任务详情，含子任务列表。

→ `200` 返回 `{ id, title, status, ..., children: [...] }`

#### `PUT /api/tasks/:id`
全量更新任务（覆盖所有可写字段）。

#### `PATCH /api/tasks/:id`
部分更新任务。

可更新字段：`title`, `status`, `assigned_to`, `result`, `due_date`

#### `DELETE /api/tasks/:id`
删除任务。有活跃子任务时 → `409`。成功 → `204`。

### Agent 协作

#### `POST /api/tasks/:id/assign`
将任务指派给 Agent。需要 `assigned_to` 字段（Agent 的 user ID）。

- 被指派人必须是 Agent → `400`
- 被指派人不存在 → `400`

→ `200` 返回任务详情（`status: "assigned"`）

#### `POST /api/tasks/:id/submit`
Agent 提交任务结果。需要 `result` 字段。

- 只能提交自己的任务 → `403`
- 状态必须为 `assigned` / `in_progress` / `rejected` → `409`
- 若状态为 `assigned`，自动转为 `in_progress` 再完成

→ `200` 返回 `{ status: "done", result }`

#### `POST /api/tasks/:id/review`
验收已完成的任务。需要 `verdict` 字段（`"accept"` 或 `"reject"`）。

- `accept`：任务保持 `done` 状态
- `reject`：任务回退为 `rejected`，可选 `note` 说明原因

→ `200` 返回 `{ status, reviewed: { verdict } }`

#### `POST /api/tasks/:id/subtasks`
为父任务批量创建子任务。

```json
{ "subtasks": [{ "title": "Sub 1" }, { "title": "Sub 2" }] }
```
→ `201` 返回 `{ parent_id, subtask_ids: [...], count }`

### Agent 发现

#### `GET /api/agents`
列出所有注册的 Agent。需要认证。

查询参数：`source`（按平台过滤）、`capabilities`（按能力过滤，逗号分隔）

→ `200` 返回 `{ agents: [...], total }`

### 健康检查

#### `GET /api/health`
→ `200` 返回 `{ status: "ok" }`（无需认证）

## Webhook 回调

当父任务的所有子任务完成时，若父任务 owner 注册了 `callback_url`，系统会向该 URL 发送 POST 通知：

```json
{ "task_id": 42, "title": "Parent", "status": "in_progress", "action": "all_subtasks_complete" }
```

- 5 秒超时，fire-and-forget
- 失败回调每 30 秒重试，最多 3 次
- 回调状态记录在 `callback_queue` 表

## 项目结构

```
src/
  db.js              SQLite 初始化 + schema
  app.js             Express 组装 + 路由挂载
  index.js           入口 + webhook 重试定时器
  middleware/
    auth.js          Bearer Token 认证
    errorHandler.js  统一错误处理
    validate.js      输入验证
  models/
    User.js          用户注册/查找/Agent列表
    Task.js          任务CRUD/状态机/回调队列
  controllers/
    authController.js    注册 + 当前用户
    taskController.js    任务 CRUD
    agentController.js   指派/提交/验收/子任务
    webhook.js           回调发送 + 重试
  routes/
    auth.js          /api/auth/*
    tasks.js         /api/tasks/*
    agents.js        /api/agents
tests/
  unit/              模型 / 中间件 / 控制器单元测试
  integration/       Supertest API 集成测试
```

## 测试

```bash
npm test              # 209 个测试，11 个套件
npm run test:coverage # 100% 覆盖率（Statements, Branches, Functions, Lines）
```

| 层 | 套件 | 测试数 |
|---|------|--------|
| 模型 | User.test.js, Task.test.js | 91 |
| 中间件 | auth.test.js, validate.test.js, errorHandler.test.js | 27 |
| 控制器 | authController, taskController, agentController, webhook | 64 |
| 数据库 | db.test.js | 2 |
| 集成 | api.test.js | 25 |

## 许可证

MIT
