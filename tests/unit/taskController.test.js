import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import {
  listTasks, getTask, createTask, updateTask, patchTask, deleteTask
} from '../../src/controllers/taskController.js';

function mockRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  res.send = () => { res._sent = true; return res; };
  return res;
}

describe('taskController', () => {
  let db;
  let userId;

  beforeEach(() => {
    db = initDb(':memory:');
    const r = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('owner','tok','human')"
    ).run();
    userId = r.lastInsertRowid;
  });

  function req(overrides = {}) {
    return {
      db,
      user: { id: userId },
      query: {},
      body: {},
      params: {},
      taskId: null,
      ...overrides
    };
  }

  describe('listTasks()', () => {
    it('returns paginated tasks for current user', () => {
      // Seed tasks
      for (let i = 0; i < 3; i++) {
        db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run(`Task ${i}`, userId);
      }
      const r = req();
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.tasks.length).toBe(3);
      expect(res._body.total).toBe(3);
      expect(res._body.page).toBe(1);
      expect(res._body.limit).toBe(20);
    });

    it('filters by status', () => {
      db.prepare("INSERT INTO tasks (title, user_id, status) VALUES (?, ?, 'done')").run('Done', userId);
      db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Open', userId);

      const r = req({ query: { status: 'done' } });
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.tasks.length).toBe(1);
      expect(res._body.tasks[0].title).toBe('Done');
    });

    it('filters by assigned_to', () => {
      const agentId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('agent1','tok-a1','agent')"
      ).run().lastInsertRowid;
      db.prepare("INSERT INTO tasks (title, user_id, assigned_to) VALUES (?, ?, ?)").run('Assigned', userId, agentId);
      db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Unassigned', userId);

      const r = req({ query: { assigned_to: String(agentId) } });
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.tasks.length).toBe(1);
      expect(res._body.tasks[0].title).toBe('Assigned');
    });

    it('filters by parent_id', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', userId);
      db.prepare("INSERT INTO tasks (title, user_id, parent_id) VALUES (?, ?, ?)").run('Child', userId, parent.lastInsertRowid);
      db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Standalone', userId);

      const r = req({ query: { parent_id: String(parent.lastInsertRowid) } });
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.tasks.length).toBe(1);
      expect(res._body.tasks[0].title).toBe('Child');
    });

    it('supports sort and order params', () => {
      db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('First', userId);
      db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Second', userId);

      const r = req({ query: { sort: 'created_at', order: 'asc' } });
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.total).toBe(2);
      expect(res._body.tasks[0].title).toBe('First');
      expect(res._body.tasks[1].title).toBe('Second');
    });

    it('supports pagination params', () => {
      for (let i = 0; i < 5; i++) {
        db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run(`Task ${i}`, userId);
      }

      const r = req({ query: { page: '2', limit: '2' } });
      const res = mockRes();

      listTasks(r, res);

      expect(res._body.tasks.length).toBe(2);
      expect(res._body.page).toBe(2);
      expect(res._body.limit).toBe(2);
    });
  });

  describe('getTask()', () => {
    it('returns task with children', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', userId);
      db.prepare("INSERT INTO tasks (title, user_id, parent_id) VALUES (?, ?, ?)").run('Child', userId, parent.lastInsertRowid);

      const r = req({ taskId: parent.lastInsertRowid });
      const res = mockRes();

      getTask(r, res);

      expect(res._body.title).toBe('Parent');
      expect(res._body.children.length).toBe(1);
    });

    it('returns 404 for another user task', () => {
      const otherId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('other','tok2','human')"
      ).run().lastInsertRowid;
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Theirs', otherId);

      const r = req({ taskId: task.lastInsertRowid });
      const res = mockRes();

      getTask(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 404 for non-existent task', () => {
      const r = req({ taskId: 99999 });
      const res = mockRes();

      getTask(r, res);

      expect(res._status).toBe(404);
    });
  });

  describe('createTask()', () => {
    it('creates task and returns 201', () => {
      const r = req({ body: { title: 'New Task' } });
      const res = mockRes();

      createTask(r, res);

      expect(res._status).toBe(201);
      expect(res._body.title).toBe('New Task');
      expect(res._body.status).toBe('open');
    });

    it('creates task with inline subtasks', () => {
      const r = req({
        body: { title: 'Parent', subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2' }] }
      });
      const res = mockRes();

      createTask(r, res);

      expect(res._status).toBe(201);
      expect(res._body.subtask_ids.length).toBe(2);
    });

    it('creates task with valid parent_id', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', userId);
      const r = req({ body: { title: 'Child', parent_id: parent.lastInsertRowid } });
      const res = mockRes();

      createTask(r, res);

      expect(res._status).toBe(201);
      expect(res._body.title).toBe('Child');
    });

    it('returns 404 when parent_id references non-existent task', () => {
      const r = req({ body: { title: 'Orphan', parent_id: 99999 } });
      const res = mockRes();

      createTask(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 404 when parent belongs to another user', () => {
      const otherId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('other','tok2','human')"
      ).run().lastInsertRowid;
      const otherTask = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Theirs', otherId);

      const r = req({ body: { title: 'Bad parent', parent_id: otherTask.lastInsertRowid } });
      const res = mockRes();

      createTask(r, res);

      expect(res._status).toBe(404);
    });
  });

  describe('updateTask()', () => {
    it('updates task title', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Old', userId);
      const r = req({ taskId: task.lastInsertRowid, body: { title: 'New' } });
      const res = mockRes();

      updateTask(r, res);

      expect(res._body.title).toBe('New');
    });

    it('updates assigned_to field', () => {
      const agentId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('agent2','tok-a2','agent')"
      ).run().lastInsertRowid;
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Old', userId);
      const r = req({ taskId: task.lastInsertRowid, body: { assigned_to: agentId } });
      const res = mockRes();

      updateTask(r, res);

      expect(res._body.assigned_to).toBe(agentId);
    });

    it('updates result field', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Old', userId);
      const r = req({ taskId: task.lastInsertRowid, body: { result: 'Done' } });
      const res = mockRes();

      updateTask(r, res);

      expect(res._body.result).toBe('Done');
    });

    it('updates due_date field', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Old', userId);
      const r = req({ taskId: task.lastInsertRowid, body: { due_date: '2026-12-31' } });
      const res = mockRes();

      updateTask(r, res);

      expect(res._body.due_date).toBe('2026-12-31');
    });

    it('returns 404 for non-existent task', () => {
      const r = req({ taskId: 99999, body: { title: 'Ghost' } });
      const res = mockRes();

      updateTask(r, res);

      expect(res._status).toBe(404);
    });
  });

  describe('patchTask()', () => {
    it('partially updates task (delegates to updateTask)', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Old', userId);
      const r = req({ taskId: task.lastInsertRowid, body: { status: 'done' } });
      const res = mockRes();

      patchTask(r, res);

      expect(res._body.title).toBe('Old');
      expect(res._body.status).toBe('done');
    });
  });

  describe('deleteTask()', () => {
    it('deletes task and returns 204', () => {
      const task = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Gone', userId);
      const r = req({ taskId: task.lastInsertRowid });
      const res = mockRes();

      deleteTask(r, res);

      expect(res._status).toBe(204);
    });

    it('returns 404 for non-existent task', () => {
      const r = req({ taskId: 99999 });
      const res = mockRes();

      deleteTask(r, res);

      expect(res._status).toBe(404);
    });

    it('returns 409 for task with active children', () => {
      const parent = db.prepare("INSERT INTO tasks (title, user_id) VALUES (?, ?)").run('Parent', userId);
      db.prepare("INSERT INTO tasks (title, user_id, parent_id, status) VALUES (?, ?, ?, 'open')").run('Child', userId, parent.lastInsertRowid);

      const r = req({ taskId: parent.lastInsertRowid });
      const res = mockRes();

      deleteTask(r, res);

      expect(res._status).toBe(409);
    });
  });
});
