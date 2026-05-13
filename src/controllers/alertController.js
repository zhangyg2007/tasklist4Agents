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

  taskModel.update(req.taskId, { status: 'error' });

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
