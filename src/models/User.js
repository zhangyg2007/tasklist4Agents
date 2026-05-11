import { v4 as uuidv4 } from 'uuid';

export class User {
  constructor(db) {
    this.db = db;
  }

  findByToken(token) {
    return this.db.prepare(
      `SELECT id, username, token, role, source, capabilities, callback_url, created_at
       FROM users WHERE token = ?`
    ).get(token);
  }

  findById(id) {
    return this.db.prepare(
      `SELECT id, username, token, role, source, capabilities, callback_url, created_at
       FROM users WHERE id = ?`
    ).get(id);
  }

  listAgents(filters = {}) {
    let sql = 'SELECT id, username, role, source, capabilities FROM users WHERE role = ?';
    const params = ['agent'];

    if (filters.source) {
      sql += ' AND source = ?';
      params.push(filters.source);
    }
    if (filters.capabilities) {
      const caps = filters.capabilities.split(',').map(c => c.trim());
      for (const cap of caps) {
        sql += ' AND capabilities LIKE ?';
        params.push(`%${cap}%`);
      }
    }

    return this.db.prepare(sql).all(...params);
  }

  register({ username, role, source, capabilities, callback_url }) {
    const finalRole = role || 'human';
    if (!['human', 'agent'].includes(finalRole)) {
      return { error: 'role must be human or agent', status: 400 };
    }

    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return { error: 'username already taken', status: 409 };
    }

    const token = uuidv4();
    const caps = capabilities || [];
    const capsJson = typeof caps === 'string' ? caps : JSON.stringify(caps);

    const result = this.db.prepare(
      `INSERT INTO users (username, token, role, source, capabilities, callback_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(username, token, finalRole, source || null, capsJson, callback_url || null);

    return {
      id: result.lastInsertRowid,
      username,
      token,
      role: finalRole,
      source: source || null,
      capabilities: capsJson,
      callback_url: callback_url || null
    };
  }
}
