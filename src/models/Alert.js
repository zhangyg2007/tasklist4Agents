export class Alert {
  constructor(db) {
    this.db = db;
  }

  create({ taskId, agentId, errorType, errorMessage, errorDetail, severity }) {
    return this.db.prepare(
      `INSERT INTO alerts (task_id, agent_id, error_type, error_message, error_detail, severity)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taskId, agentId || null, errorType, errorMessage || null, errorDetail || null, severity || 'error');
  }

  findById(id) {
    return this.db.prepare(
      `SELECT a.*, t.title as task_title, u.username as agent_name
       FROM alerts a
       LEFT JOIN tasks t ON a.task_id = t.id
       LEFT JOIN users u ON a.agent_id = u.id
       WHERE a.id = ?`
    ).get(id);
  }

  list({ filters = {}, page: pageRaw, limit: limitRaw } = {}) {
    let sql = `SELECT a.*, t.title as task_title, u.username as agent_name
               FROM alerts a
               LEFT JOIN tasks t ON a.task_id = t.id
               LEFT JOIN users u ON a.agent_id = u.id WHERE 1=1`;
    const params = [];

    if (filters.status) { sql += ' AND a.status = ?'; params.push(filters.status); }
    if (filters.severity) { sql += ' AND a.severity = ?'; params.push(filters.severity); }
    if (filters.task_id) { sql += ' AND a.task_id = ?'; params.push(filters.task_id); }
    if (filters.agent_id) { sql += ' AND a.agent_id = ?'; params.push(filters.agent_id); }

    const total = this.db.prepare(
      `SELECT COUNT(*) as count FROM (${sql})`
    ).get(...params).count;

    sql += ' ORDER BY a.created_at DESC';

    const page = Math.max(1, parseInt(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw) || 20));
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const rows = this.db.prepare(sql).all(...params);
    return { rows, total, page, limit };
  }

  update(id, fields) {
    const allowed = ['status', 'severity', 'fix_task_id'];
    const sets = [];
    const params = [];

    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }

    if (sets.length === 0) return { changes: 0 };

    params.push(id);
    return this.db.prepare(`UPDATE alerts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  countByStatus(status) {
    return this.db.prepare(
      'SELECT COUNT(*) as count FROM alerts WHERE status = ?'
    ).get(status).count;
  }
}
