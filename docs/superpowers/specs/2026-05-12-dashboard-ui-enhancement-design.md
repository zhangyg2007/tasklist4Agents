# Dashboard UI Enhancement Design

Date: 2026-05-12 | Status: Draft (数据模型 + 布局完成，详细交互待定)

## Overview

将当前 Dashboard 从单一树形视图扩展为完整的三 Tab 管理界面，增加告警系统和自动派单能力。

## 数据模型变更

### tasks 表新增状态

```
status 值增加: 'error', 'aborted'
```

### 新表: alerts

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| task_id | INTEGER FK→tasks | 关联任务 |
| agent_id | INTEGER FK→users | 执行出错的 Agent |
| error_type | TEXT | 404 / 500 / timeout / crash |
| error_message | TEXT | 错误消息摘要 |
| error_detail | TEXT | 完整响应体或堆栈 |
| severity | TEXT | `warn` / `error` / `critical` |
| status | TEXT | `open` / `acknowledged` / `resolved` |
| fix_task_id | INTEGER FK→tasks | 关联的修复子任务（可选） |
| created_at | TEXT DEFAULT (datetime('now')) | |

### 状态流转新增路径

```
in_progress → error → aborted
                  ↘ in_progress (修复子任务完成后唤醒)
```

## 自动派单机制

1. **Capability 匹配**: Agent 注册时声明 `capabilities`，系统根据任务需求关键词匹配
2. **默认指派**: 子任务报错后，默认指派给当前执行 Agent 创建修复子任务，减少上下文交互
3. **协调指派**: 特殊场景由主 Agent 手动协调其他相关 Agent

## UI 布局

### 整体结构

```
┌─────────────────────────────────────────────────┐
│  ⚙ Agent Task Platform          [🔔 3 Alerts]  │
├─────────────────────────────────────────────────┤
│  [📋 任务看板]  [🌲 树形视图]  [🚨 告警中心]    │
├─────────────────────────────────────────────────┤
│              (各 Tab 内容区)                     │
└─────────────────────────────────────────────────┘
```

### Tab 1 — 任务看板（表格视图）

- 仅显示顶级主任务（parent_id IS NULL）
- 列：标题 / 状态 / 子任务进度 / 指派 Agent / 告警数 / 操作
- 子任务进度条可点击展开简要列表
- 支持按状态筛选，按时间排序

### Tab 2 — 树形视图

- 增强当前 tree view
- 展开/折叠图标（默认展开至第 2 层）
- 任务行显示关联告警图标
- 右键菜单：指派、创建子任务、查看告警、标记修复
- 保持 5s 自动刷新

### Tab 3 — 告警中心

- 独立面板，筛选：全部/open/acknowledged/resolved
- 每条告警卡片显示：
  - 严重程度图标 + 标题
  - 关联任务 #ID + Agent 名称 + 错误类型
  - 关联修复子任务状态
  - 操作按钮：查看详情 / 创建修复任务 / 标记已解决
- 顶部导航 badge 实时显示 open 告警数

### 内嵌通知

- Dashboard 顶部 badge 实时计数
- 新告警产生时短暂 toast 弹出（浏览器 Notification API 可选）
- 点击 badge 跳转告警中心 Tab

## 待设计项

- 详细交互流程（点击、弹窗、表单）
- API 端点设计（alerts CRUD、自动匹配查询）
- 前端组件拆分方案
- 测试策略

## 实施优先级

| Phase | 范围 | 优先级 |
|-------|------|--------|
| 1 | alerts 表 + error/aborted 状态 + 告警 API | P0 |
| 2 | 自动派单（capability 匹配 + 修复子任务自动创建）| P0 |
| 3 | Tab 结构调整 + 内嵌通知 badge | P1 |
| 4 | 告警中心面板（独立 Tab）| P1 |
| 5 | 表格视图（任务看板 Tab）| P2 |
| 6 | 右键菜单 + 展开折叠增强 | P2 |
