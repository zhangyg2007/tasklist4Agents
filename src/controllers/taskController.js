import { Task } from '../models/Task.js';

export function listTasks(req, res) {
  const taskModel = new Task(req.db);
  const { status, assigned_to, parent_id, role, sort, order, page, limit } = req.query;

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
