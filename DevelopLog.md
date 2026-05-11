# DevelopLog

## v1.0 — 2026-05-09 — Multi-Agent Task Platform 初始版本

### 项目概述

多 Agent 任务编排平台 API 服务。Agent（OpenCLAW、Hermes 等）注册为带 token 的用户，
主 Agent 创建任务并拆分为子任务指派给其他 Agent 执行，子 Agent 回填结果后自动唤醒主 Agent 验收。

### 技术栈

- **Runtime:** Node.js 22
- **Framework:** Express 5.2
- **Database:** SQLite (better-sqlite3, WAL 模式, 外键强制)
- **Auth:** UUID v4 Bearer Token
- **Test:** Vitest (32 个集成测试)

### 已实现功能

#### 用户 & Agent 管理
- Agent/Human 统一模型（`users` 表），通过 `role` 字段区分
- UUID token 注册，同一 token 支持多平台（`source`: openclaw / hermes）
- `capabilities` JSON 字段记录 Agent 能力（code-gen、review 等）
- `callback_url` 支持 Agent 唤醒回调
- `GET /api/agents` Agent 发现，支持 source + capabilities 过滤

#### 任务管理
- 完整 CRUD：`GET/POST /api/tasks` + `GET/PUT/PATCH/DELETE /api/tasks/:id`
- 任务树：`parent_id` 父子关联，创建时支持内联 `subtasks` 数组
- 过滤/排序/分页：status、assigned_to、parent_id、role、sort、order、page、limit
- 删除保护：有活跃子任务时返回 409

#### Agent 协作（核心）
- `POST /api/tasks/:id/assign` — 指派任务给 Agent（校验 role=agent）
- `POST /api/tasks/:id/submit` — Agent 回填结果（自动 start → done，支持 rejected 重交）
- `POST /api/tasks/:id/review` — 主 Agent 验收（accept/reject）
- `POST /api/tasks/:id/subtasks` — 批量创建子任务

#### 状态机
```
open → assigned → in_progress → done
                    ↑               │
                    └── rejected ←──┘  (主 Agent 打回)

全部子任务 done → 父任务自动 blocked → in_progress
父任务 owner 有 callback_url → 写入 callback_queue 等待唤醒
```

#### Webhook 回调
- `callback_queue` 表记录待发送回调
- `sendCallback()` 5 秒超时 fire-and-forget POST
- 30 秒定时重试（最多 3 次）
- 成功/失败状态回写

#### 错误处理 & 安全
- 统一错误中间件：JSON 解析错误 → 400, SQLite 约束 → 400, FK 违反 → 400
- Token 认证中间件：无效/缺失 token → 401
- 跨用户数据隔离：操作他人任务 → 404（防信息泄露）
- 非指派 Agent 操作 → 403
- 参数化查询防 SQL 注入

### 数据库表

| 表 | 用途 | 关键字段 |
|---|------|---------|
| `users` | 用户/Agent 统一存储 | username, token, role, source, capabilities, callback_url |
| `tasks` | 任务树 + 状态机 | user_id, title, status, parent_id, assigned_to, result, due_date |
| `callback_queue` | Webhook 回调队列 | task_id, url, status, retries, last_error |

### 测试覆盖（32 个集成测试）

| 文件 | 测试数 | 覆盖范围 |
|------|--------|---------|
| `auth.test.js` | 7 | 注册、token 验证、重复用户名、缺失字段、非法 role |
| `tasks.test.js` | 9 | CRUD、子任务创建、分页、更新、删除保护、跨用户隔离 |
| `collaboration.test.js` | 7 | 指派、提交、验收、打回重交、非授权提交、Agent 发现、子任务 |
| `edgecases.test.js` | 8 | 空标题、非数字 ID、无效 JSON、分页边界、limit 上限、多余字段、跨用户 404、健康检查 |
| `smoke.test.js` | 1 | 完整 3-Agent 生命周期（OpenCLAW 主控 + Hermes 编码 + OpenCLAW 审查）|

### 文件结构

```
src/
  db.js                         SQLite 连接 + schema + 迁移
  app.js                        Express 组装
  index.js                      入口 + webhook 重试定时器
  middleware/
    auth.js                     Bearer Token 认证
    errorHandler.js             统一错误响应（JSON/SQLite/FK）
    validate.js                 输入验证（requireFields, validateEnum, validateIdParam）
  models/
    User.js                     用户注册 / token 查找 / Agent 列表
    Task.js                     任务 CRUD / 状态机 / 兄弟任务唤醒 / 回调队列写入
  controllers/
    authController.js           注册 + 当前用户查询
    taskController.js           任务 CRUD + 过滤排序分页
    agentController.js          指派 / 提交 / 验收 / 子任务 / Agent 发现
    webhook.js                  回调发送 + 重试逻辑
  routes/
    auth.js                     /api/auth/*
    tasks.js                    /api/tasks/*
    agents.js                   /api/agents
tests/
  setup.js                      测试工具（内存 DB + HTTP server）
  auth.test.js                  7 tests
  tasks.test.js                 9 tests
  collaboration.test.js         7 tests
  edgecases.test.js             8 tests
  smoke.test.js                 1 test
```
