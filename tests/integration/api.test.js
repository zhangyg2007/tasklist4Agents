import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { initDb } from '../../src/db.js';
import { createApp } from '../../src/app.js';

describe('API Integration', () => {
  let db;
  let app;
  let humanToken;
  let humanId;
  let agentToken;
  let agentId;

  beforeEach(() => {
    db = initDb(':memory:');
    app = createApp(db);

    // Register a human user
    const human = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('human','tok-human','human')"
    ).run();
    humanId = human.lastInsertRowid;
    humanToken = 'tok-human';

    // Register an agent user
    const agent = db.prepare(
      "INSERT INTO users (username, token, role, source, capabilities) VALUES ('agent','tok-agent','agent','openclaw','[\"code-gen\"]')"
    ).run();
    agentId = agent.lastInsertRowid;
    agentToken = 'tok-agent';
  });

  function auth(token) {
    return { Authorization: `Bearer ${token}` };
  }

  // ==================== Health ====================

  describe('GET /api/health', () => {
    it('returns ok without auth', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ==================== Auth ====================

  describe('POST /api/auth/register', () => {
    it('registers a new user and returns token', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'newuser', role: 'agent', capabilities: ['code-gen', 'review'] });

      expect(res.status).toBe(201);
      expect(res.body.username).toBe('newuser');
      expect(res.body.token).toBeDefined();
      expect(res.body.role).toBe('agent');
      expect(res.body.capabilities).toEqual(['code-gen', 'review']);
    });

    it('returns 409 for duplicate username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'human' });

      expect(res.status).toBe(409);
    });

    it('returns 400 for missing username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'bad', role: 'robot' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('human');
      expect(res.body.role).toBe('human');
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set(auth('bad-token'));

      expect(res.status).toBe(401);
    });
  });

  // ==================== Tasks ====================

  describe('Tasks CRUD', () => {
    it('GET /api/tasks returns empty list', async () => {
      const res = await request(app)
        .get('/api/tasks')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.tasks).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('POST /api/tasks creates task and returns 201', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({ title: 'My Task' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('My Task');
      expect(res.body.status).toBe('open');
    });

    it('full CRUD cycle: create, read, update, delete', async () => {
      // Create
      const c = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({ title: 'CRUD Task' });
      expect(c.status).toBe(201);
      const id = c.body.id;

      // Read
      const r = await request(app)
        .get(`/api/tasks/${id}`)
        .set(auth(humanToken));
      expect(r.status).toBe(200);
      expect(r.body.title).toBe('CRUD Task');

      // Update (PUT)
      const u = await request(app)
        .put(`/api/tasks/${id}`)
        .set(auth(humanToken))
        .send({ title: 'Updated' });
      expect(u.status).toBe(200);
      expect(u.body.title).toBe('Updated');

      // Patch
      const p = await request(app)
        .patch(`/api/tasks/${id}`)
        .set(auth(humanToken))
        .send({ status: 'done' });
      expect(p.status).toBe(200);
      expect(p.body.status).toBe('done');

      // Delete
      const d = await request(app)
        .delete(`/api/tasks/${id}`)
        .set(auth(humanToken));
      expect(d.status).toBe(204);

      // Verify gone
      const r2 = await request(app)
        .get(`/api/tasks/${id}`)
        .set(auth(humanToken));
      expect(r2.status).toBe(404);
    });

    it('POST /api/tasks returns 400 when title is missing', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({});

      expect(res.status).toBe(400);
    });

    it('GET /api/tasks/:id returns 404 for non-existent task', async () => {
      const res = await request(app)
        .get('/api/tasks/99999')
        .set(auth(humanToken));

      expect(res.status).toBe(404);
    });

    it('GET /api/tasks/:id returns 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/tasks/abc')
        .set(auth(humanToken));

      expect(res.status).toBe(400);
    });

    it('requires auth for all task endpoints', async () => {
      const r1 = await request(app).get('/api/tasks');
      expect(r1.status).toBe(401);

      const r2 = await request(app).post('/api/tasks').send({ title: 'X' });
      expect(r2.status).toBe(401);

      const r3 = await request(app).get('/api/tasks/1');
      expect(r3.status).toBe(401);
    });

    it('creates task with inline subtasks', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({
          title: 'Parent Task',
          subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2' }]
        });

      expect(res.status).toBe(201);
      expect(res.body.subtask_ids.length).toBe(2);
    });

    it('creates task with parent_id', async () => {
      const parent = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({ title: 'Parent' });

      const child = await request(app)
        .post('/api/tasks')
        .set(auth(humanToken))
        .send({ title: 'Child', parent_id: parent.body.id });

      expect(child.status).toBe(201);
    });
  });

  // ==================== Agent Collaboration ====================

  describe('Agent collaboration', () => {
    let taskId;

    beforeEach(() => {
      const r = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Collab', humanId);
      taskId = r.lastInsertRowid;
    });

    it('full flow: assign → submit → review', async () => {
      // Assign
      const a = await request(app)
        .post(`/api/tasks/${taskId}/assign`)
        .set(auth(humanToken))
        .send({ assigned_to: agentId });
      expect(a.status).toBe(200);
      expect(a.body.status).toBe('assigned');

      // Submit by agent (auto-starts + done)
      const s = await request(app)
        .post(`/api/tasks/${taskId}/submit`)
        .set(auth(agentToken))
        .send({ result: 'All done!' });
      expect(s.status).toBe(200);
      expect(s.body.status).toBe('done');

      // Review (accept)
      const rv = await request(app)
        .post(`/api/tasks/${taskId}/review`)
        .set(auth(humanToken))
        .send({ verdict: 'accept', note: 'Good' });
      expect(rv.status).toBe(200);
      expect(rv.body.reviewed.verdict).toBe('accepted');
    });

    it('agent cannot submit task assigned to different agent', async () => {
      // Create another agent
      const otherAgentId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('agent2','tok-a2','agent')"
      ).run().lastInsertRowid;

      // Assign to agent1
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);

      // Other agent tries to submit
      const res = await request(app)
        .post(`/api/tasks/${taskId}/submit`)
        .set(auth('tok-a2'))
        .send({ result: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('review with reject verdict', async () => {
      db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(taskId);

      const res = await request(app)
        .post(`/api/tasks/${taskId}/review`)
        .set(auth(humanToken))
        .send({ verdict: 'reject', note: 'Redo please' });

      expect(res.status).toBe(200);
      expect(res.body.reviewed.verdict).toBe('rejected');
      expect(res.body.status).toBe('rejected');
    });

    it('creates subtasks for parent', async () => {
      const res = await request(app)
        .post(`/api/tasks/${taskId}/subtasks`)
        .set(auth(humanToken))
        .send({ subtasks: [{ title: 'Sub A' }, { title: 'Sub B' }] });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
    });

    it('returns 400 when assigning to non-existent agent', async () => {
      const res = await request(app)
        .post(`/api/tasks/${taskId}/assign`)
        .set(auth(humanToken))
        .send({ assigned_to: 99999 });

      expect(res.status).toBe(400);
    });
  });

  // ==================== Agents ====================

  describe('GET /api/agents', () => {
    it('lists all agents with parsed capabilities', async () => {
      const res = await request(app)
        .get('/api/agents')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.agents.length).toBe(1);
      expect(res.body.agents[0].capabilities).toEqual(['code-gen']);
    });

    it('requires auth', async () => {
      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(401);
    });
  });

  // ==================== JSON Parsing ====================

  describe('Error handling', () => {
    it('returns 400 for invalid JSON in request body', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('not-json');

      expect(res.status).toBe(400);
    });
  });

  // ==================== Alert API ====================

  describe('Alert API', () => {
    let taskId;

    beforeEach(() => {
      const r = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Alertable', humanId);
      taskId = r.lastInsertRowid;
    });

    // --- Error Reporting ---

    it('POST /api/alerts/tasks/:id/error — reports error and creates alert', async () => {
      // Assign task to agent first
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);

      const res = await request(app)
        .post(`/api/alerts/tasks/${taskId}/error`)
        .set(auth(agentToken))
        .send({ error_type: 'RUNTIME_ERROR', error_message: 'Something broke' });

      expect(res.status).toBe(201);
      expect(res.body.task_id).toBe(taskId);
      expect(res.body.status).toBe('error');
      expect(res.body.alert_id).toBeGreaterThan(0);

      // Verify task status updated
      const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
      expect(task.status).toBe('error');
    });

    it('POST /api/alerts/tasks/:id/error — returns 404 for non-existent task', async () => {
      const res = await request(app)
        .post('/api/alerts/tasks/99999/error')
        .set(auth(agentToken))
        .send({ error_type: 'RUNTIME_ERROR' });

      expect(res.status).toBe(404);
    });

    it('POST /api/alerts/tasks/:id/error — returns 403 when agent not assigned', async () => {
      const res = await request(app)
        .post(`/api/alerts/tasks/${taskId}/error`)
        .set(auth(agentToken))
        .send({ error_type: 'RUNTIME_ERROR' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('not assigned');
    });

    it('POST /api/alerts/tasks/:id/error — auto-creates fix subtask', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);

      const res = await request(app)
        .post(`/api/alerts/tasks/${taskId}/error`)
        .set(auth(agentToken))
        .send({
          error_type: 'RUNTIME_ERROR',
          error_message: 'Process crashed',
          auto_create_fix: true
        });

      expect(res.status).toBe(201);
      expect(res.body.fix_task_id).toBeGreaterThan(0);

      // Verify fix task created and assigned to same agent
      const fix = db.prepare('SELECT * FROM tasks WHERE id = ?').get(res.body.fix_task_id);
      expect(fix).toBeDefined();
      expect(fix.parent_id).toBe(taskId);
      expect(fix.assigned_to).toBe(agentId);
      expect(fix.title).toContain('[Fix]');
    });

    // --- List Alerts ---

    it('GET /api/alerts — lists alerts with filters', async () => {
      // Create an alert
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, error_message, severity, status) VALUES (?,?,?,?,?,?)"
      ).run(taskId, agentId, 'TIMEOUT', 'Request timed out', 'error', 'open');

      const res = await request(app)
        .get('/api/alerts')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(1);
      expect(res.body.total).toBe(1);
      expect(res.body.alerts[0].error_type).toBe('TIMEOUT');
      expect(res.body.alerts[0].task_title).toBeDefined();
      expect(res.body.alerts[0].agent_name).toBeDefined();
    });

    it('GET /api/alerts — filters by status', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, severity, status) VALUES (?,?,?,?,?)"
      ).run(taskId, agentId, 'TIMEOUT', 'error', 'open');
      db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, severity, status) VALUES (?,?,?,?,?)"
      ).run(taskId, agentId, 'OOM', 'critical', 'resolved');

      const res = await request(app)
        .get('/api/alerts?status=open')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(1);
      expect(res.body.alerts[0].error_type).toBe('TIMEOUT');
    });

    // --- List: pagination & more filters ---

    it('GET /api/alerts — paginates results', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'A', 'error');
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'B', 'warn');
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'C', 'critical');

      const res = await request(app)
        .get('/api/alerts?page=1&limit=2')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(2);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
    });

    it('GET /api/alerts — filters by severity', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'E1', 'warn');
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'E2', 'critical');
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'E3', 'critical');

      const res = await request(app)
        .get('/api/alerts?severity=critical')
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(2);
      expect(res.body.alerts.every(a => a.severity === 'critical')).toBe(true);
    });

    it('GET /api/alerts — filters by task_id', async () => {
      const task2Id = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Task2', humanId).lastInsertRowid;
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, task2Id);
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(taskId, agentId, 'T1', 'error');
      db.prepare("INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)").run(task2Id, agentId, 'T2', 'warn');

      const res = await request(app)
        .get(`/api/alerts?task_id=${taskId}`)
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(1);
      expect(res.body.alerts[0].error_type).toBe('T1');
    });

    // --- Get Single Alert ---

    it('GET /api/alerts/:id — returns single alert', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const alertId = db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, error_message, severity) VALUES (?,?,?,?,?)"
      ).run(taskId, agentId, 'RUNTIME_ERROR', 'Null pointer', 'critical').lastInsertRowid;

      const res = await request(app)
        .get(`/api/alerts/${alertId}`)
        .set(auth(humanToken));

      expect(res.status).toBe(200);
      expect(res.body.error_type).toBe('RUNTIME_ERROR');
      expect(res.body.error_message).toBe('Null pointer');
      expect(res.body.severity).toBe('critical');
      expect(res.body.task_title).toBe('Alertable');
      expect(res.body.agent_name).toBe('agent');
    });

    it('GET /api/alerts/:id — returns 404 for non-existent alert', async () => {
      const res = await request(app)
        .get('/api/alerts/99999')
        .set(auth(humanToken));

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Alert not found');
    });

    it('GET /api/alerts/:id — returns 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/alerts/abc')
        .set(auth(humanToken));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid alert id');
    });

    // --- Update Alert ---

    it('PATCH /api/alerts/:id — updates alert status', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const alertId = db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)"
      ).run(taskId, agentId, 'TIMEOUT', 'warn').lastInsertRowid;

      const res = await request(app)
        .patch(`/api/alerts/${alertId}`)
        .set(auth(humanToken))
        .send({ status: 'acknowledged' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('acknowledged');

      // Verify persisted
      const alert = db.prepare('SELECT status FROM alerts WHERE id = ?').get(alertId);
      expect(alert.status).toBe('acknowledged');
    });

    it('PATCH /api/alerts/:id — returns 400 for invalid status', async () => {
      db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").run(agentId, taskId);
      const alertId = db.prepare(
        "INSERT INTO alerts (task_id, agent_id, error_type, severity) VALUES (?,?,?,?)"
      ).run(taskId, agentId, 'TEST', 'warn').lastInsertRowid;

      const res = await request(app)
        .patch(`/api/alerts/${alertId}`)
        .set(auth(humanToken))
        .send({ status: 'deleted' });

      expect(res.status).toBe(400);
    });

    it('PATCH /api/alerts/:id — returns 404 for non-existent alert', async () => {
      const res = await request(app)
        .patch('/api/alerts/99999')
        .set(auth(humanToken))
        .send({ status: 'acknowledged' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Alert not found');
    });

    it('PATCH /api/alerts/:id — returns 400 for invalid id', async () => {
      const res = await request(app)
        .patch('/api/alerts/0')
        .set(auth(humanToken))
        .send({ status: 'acknowledged' });

      expect(res.status).toBe(400);
    });
  });
});
