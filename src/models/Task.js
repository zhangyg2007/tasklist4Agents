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

    const sortField = filters.sort || 'created_at';
    const allowedSorts = ['created_at', 'updated_at', 'due_date'];
    const sort = allowedSorts.includes(sortField) ? sortField : 'created_at';
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sort} ${order}`;

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
      "SELECT * FROM tasks WHERE assigned_to = ? AND status != 'done' ORDER BY created_at DESC"
    ).all(userId);
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

  // --- Status machine ---

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
    if (task.status !== 'in_progress' && task.status !== 'rejected' && task.status !== 'assigned') {
      return { changes: 0, error: 'Can only submit tasks with status: in_progress, rejected, or assigned' };
    }
    const jsonResult = typeof result === 'object' ? JSON.stringify(result) : result;
    const r = this.update(id, { status: 'done', result: jsonResult });
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
      this.update(id, { status: 'done' });
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
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as done_count
       FROM tasks WHERE parent_id = ?`
    ).get('done', parentId);

    if (siblings.total > 0 && siblings.total === siblings.done_count) {
      this.update(parentId, { status: 'in_progress' });
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
      this.db.prepare(
        "INSERT OR IGNORE INTO callback_queue (task_id, url) VALUES (?, ?)"
      ).run(taskId, owner.callback_url);
    }
  }
}
