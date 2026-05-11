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

  const parsed = agents.map(a => ({
    ...a,
    capabilities: (() => {
      try { return JSON.parse(a.capabilities); }
      catch { return []; }
    })()
  }));

  res.json({ agents: parsed, total: parsed.length });
}
