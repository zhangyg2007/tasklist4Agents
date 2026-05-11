import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { User } from '../../src/models/User.js';
import { Task } from '../../src/models/Task.js';
import { assign, submit, review, createSubtasks, listAgents } from '../../src/controllers/agentController.js';

function mockRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { if (res._status === null) res._status = 200; res._body = body; return res; };
  return res;
}

describe('agentController', () => {
  let db;
  let ownerId;
  let agentId;

  beforeEach(() => {
    db = initDb(':memory:');
    const r1 = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('owner','tok-owner','human')"
    ).run();
    ownerId = r1.lastInsertRowid;

    const r2 = db.prepare(
      "INSERT INTO users (username, token, role, source, capabilities) VALUES ('agent','tok-agent','agent','openclaw','[\"code-gen\"]')"
    ).run();
    agentId = r2.lastInsertRowid;
  });

  function req(overrides = {}) {
    return {
      db,
      user: { id: ownerId, role: 'human' },
      body: {},
      taskId: null,
      query: {},
      params: {},
      ...overrides
    };
  }

  describe('assign()', () => {
    it('assigns task to agent and returns 200', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { assigned_to: agentId } });
      const res = mockRes();

      assign(r, res);

      expect(res._status).toBe(200);
      expect(res._body.status).toBe('assigned');
      expect(res._body.assigned_to).toBe(agentId);
    });

    it('returns 404 for non-existent task', () => {
      const r = req({ taskId: 99999, body: { assigned_to: agentId } });
      const res = mockRes();

      assign(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 400 when assignee is not an agent', () => {
      const otherHuman = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('human2','tok-h2','human')"
      ).run().lastInsertRowid;
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { assigned_to: otherHuman } });
      const res = mockRes();

      assign(r, res);

      expect(res._status).toBe(400);
      expect(res._body.error).toContain('only be assigned to agents');
    });

    it('returns 400 when assignee does not exist', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { assigned_to: 99999 } });
      const res = mockRes();

      assign(r, res);

      expect(res._status).toBe(400);
    });

    it('returns 400 when assigned_to is missing', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: {} });
      const res = mockRes();

      assign(r, res);

      expect(res._status).toBe(400);
    });
  });

  describe('submit()', () => {
    it('agent submits result and task status becomes done', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'in_progress', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: agentId, role: 'agent' },
        body: { result: 'Completed' }
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(200);
      expect(res._body.status).toBe('done');
      expect(res._body.result).toBe('Completed');
    });

    it('auto-starts task when submitting from assigned status', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'assigned', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: agentId, role: 'agent' },
        body: { result: 'Done from assigned' }
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(200);
      expect(res._body.status).toBe('done');
    });

    it('returns 403 when non-assigned agent tries to submit', () => {
      const otherAgentId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('agent2','tok-a2','agent')"
      ).run().lastInsertRowid;
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'in_progress', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: otherAgentId, role: 'agent' },
        body: { result: 'Hacked' }
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(403);
    });

    it('returns 409 when task is in wrong status', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'open', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: agentId, role: 'agent' },
        body: { result: 'Skip steps' }
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(409);
    });

    it('returns 404 for non-existent task', () => {
      const r = req({
        taskId: 99999,
        user: { id: agentId, role: 'agent' },
        body: { result: 'Nowhere' }
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 400 when result is missing', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'in_progress', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: agentId, role: 'agent' },
        body: {}
      });
      const res = mockRes();

      submit(r, res);

      expect(res._status).toBe(400);
    });

    it('returns 400 when model.submit returns an error (defensive)', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status, assigned_to) VALUES (?, ?, 'in_progress', ?)").run('Task', ownerId, agentId);
      const r = req({
        taskId: task.lastInsertRowid,
        user: { id: agentId, role: 'agent' },
        body: { result: 'Done' }
      });
      const res = mockRes();

      // Simulate a transient model error (e.g., task deleted between checks)
      const origSubmit = Task.prototype.submit;
      Task.prototype.submit = function () { return { changes: 0, error: 'Transient error' }; };

      submit(r, res);

      Task.prototype.submit = origSubmit;

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('Transient error');
    });
  });

  describe('review()', () => {
    it('accepts a done task', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'done')").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { verdict: 'accept', note: 'Good' } });
      const res = mockRes();

      review(r, res);

      expect(res._status).toBe(200);
      expect(res._body.reviewed.verdict).toBe('accepted');
    });

    it('rejects a done task', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'done')").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { verdict: 'reject', note: 'Redo' } });
      const res = mockRes();

      review(r, res);

      expect(res._body.status).toBe('rejected');
      expect(res._body.reviewed.verdict).toBe('rejected');
    });

    it('returns 400 for invalid verdict', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'done')").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { verdict: 'maybe' } });
      const res = mockRes();

      review(r, res);

      expect(res._status).toBe(400);
    });

    it('returns 404 for non-existent task', () => {
      const r = req({ taskId: 99999, body: { verdict: 'accept' } });
      const res = mockRes();

      review(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 409 when reviewing task not in done status', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'open')").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { verdict: 'accept', note: 'Too early' } });
      const res = mockRes();

      review(r, res);

      expect(res._status).toBe(409);
    });

    it('returns 400 from model error with falsy status (defensive)', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'done')").run('Task', ownerId);
      const r = req({ taskId: task.lastInsertRowid, body: { verdict: 'accept' } });
      const res = mockRes();

      // Simulate model returning error without a truthy status code
      const origReview = Task.prototype.review;
      Task.prototype.review = function () { return { error: 'Something wrong' }; };

      review(r, res);

      Task.prototype.review = origReview;

      expect(res._status).toBe(400);
    });
  });

  describe('createSubtasks()', () => {
    it('creates subtasks and returns 201', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', ownerId);
      const r = req({
        taskId: parent.lastInsertRowid,
        body: { subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2' }] }
      });
      const res = mockRes();

      createSubtasks(r, res);

      expect(res._status).toBe(201);
      expect(res._body.count).toBe(2);
      expect(res._body.parent_id).toBe(parent.lastInsertRowid);
    });

    it('returns 400 when subtasks array is empty', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', ownerId);
      const r = req({ taskId: parent.lastInsertRowid, body: { subtasks: [] } });
      const res = mockRes();

      createSubtasks(r, res);

      expect(res._status).toBe(400);
    });

    it('returns 404 for non-existent parent task', () => {
      const r = req({ taskId: 99999, body: { subtasks: [{ title: 'Orphan' }] } });
      const res = mockRes();

      createSubtasks(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 400 when a subtask is missing a title', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', ownerId);
      const r = req({
        taskId: parent.lastInsertRowid,
        body: { subtasks: [{ title: 'Good' }, { desc: 'No title here' }] }
      });
      const res = mockRes();

      createSubtasks(r, res);

      expect(res._status).toBe(400);
    });
  });

  describe('listAgents()', () => {
    it('returns all agents with parsed capabilities', () => {
      const r = req();
      const res = mockRes();

      listAgents(r, res);

      expect(res._body.agents.length).toBe(1);
      expect(res._body.agents[0].username).toBe('agent');
      expect(res._body.agents[0].capabilities).toEqual(['code-gen']);
    });

    it('filters by source', () => {
      db.prepare(
        "INSERT INTO users (username, token, role, source) VALUES ('hermes','tok-h','agent','hermes')"
      ).run();

      const r = req({ query: { source: 'hermes' } });
      const res = mockRes();

      listAgents(r, res);

      expect(res._body.agents.length).toBe(1);
      expect(res._body.agents[0].source).toBe('hermes');
    });

    it('handles agent with broken JSON capabilities gracefully', () => {
      db.prepare(
        "INSERT INTO users (username, token, role, capabilities) VALUES ('bad-caps','tok-bc','agent','{not valid')"
      ).run();

      const r = req();
      const res = mockRes();

      listAgents(r, res);

      expect(res._body.agents.length).toBe(2);
      const bad = res._body.agents.find(a => a.username === 'bad-caps');
      expect(bad.capabilities).toEqual([]);
    });
  });
});
