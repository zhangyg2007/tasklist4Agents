import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { Task } from '../../src/models/Task.js';

describe('Task model', () => {
  let db;
  let task;
  let userId;

  beforeEach(() => {
    db = initDb(':memory:');
    task = new Task(db);
    // Seed a user for FK constraints
    const r = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('test-user','test-token','human')"
    ).run();
    userId = r.lastInsertRowid;
  });

  // ========== create ==========

  describe('create()', () => {
    it('inserts a task and returns lastInsertRowid', () => {
      const r = task.create({ title: 'Write docs', userId });
      expect(r.lastInsertRowid).toBeGreaterThan(0);
      expect(r.changes).toBe(1);
    });

    it('stores default status as open', () => {
      const r = task.create({ title: 'Default status', userId });
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('open');
    });

    it('stores parent_id when provided', () => {
      const parent = task.create({ title: 'Parent', userId });
      const child = task.create({ title: 'Child', userId, parentId: parent.lastInsertRowid });
      const row = task.findById(child.lastInsertRowid);
      expect(row.parent_id).toBe(parent.lastInsertRowid);
    });

    it('stores parent_id as null when not provided', () => {
      const r = task.create({ title: 'No parent', userId });
      const row = task.findById(r.lastInsertRowid);
      expect(row.parent_id).toBeNull();
    });

    it('stores due_date when provided', () => {
      const r = task.create({ title: 'Deadline', userId, dueDate: '2026-06-01' });
      const row = task.findById(r.lastInsertRowid);
      expect(row.due_date).toBe('2026-06-01');
    });

    it('stores due_date as null when not provided', () => {
      const r = task.create({ title: 'No deadline', userId });
      const row = task.findById(r.lastInsertRowid);
      expect(row.due_date).toBeNull();
    });

    it('throws on empty title due to CHECK constraint', () => {
      expect(() => task.create({ title: '', userId })).toThrow();
    });
  });

  // ========== findById ==========

  describe('findById()', () => {
    it('returns task when id exists', () => {
      const r = task.create({ title: 'Found', userId });
      const found = task.findById(r.lastInsertRowid);
      expect(found).toBeDefined();
      expect(found.title).toBe('Found');
    });

    it('returns undefined when id does not exist', () => {
      expect(task.findById(99999)).toBeUndefined();
    });
  });

  // ========== findByIdAndUser ==========

  describe('findByIdAndUser()', () => {
    it('returns task when id and user match', () => {
      const r = task.create({ title: 'Mine', userId });
      const found = task.findByIdAndUser(r.lastInsertRowid, userId);
      expect(found).toBeDefined();
      expect(found.title).toBe('Mine');
    });

    it('returns undefined when id matches but user does not', () => {
      const r = task.create({ title: 'Mine', userId });
      const found = task.findByIdAndUser(r.lastInsertRowid, 99999);
      expect(found).toBeUndefined();
    });

    it('returns undefined when neither id nor user match', () => {
      expect(task.findByIdAndUser(99999, 99999)).toBeUndefined();
    });
  });

  // ========== findChildren ==========

  describe('findChildren()', () => {
    it('returns children of a parent task', () => {
      const parent = task.create({ title: 'Parent', userId });
      task.create({ title: 'Child 1', userId, parentId: parent.lastInsertRowid });
      task.create({ title: 'Child 2', userId, parentId: parent.lastInsertRowid });

      const children = task.findChildren(parent.lastInsertRowid);
      expect(children.length).toBe(2);
      expect(children.map(c => c.title).sort()).toEqual(['Child 1', 'Child 2']);
    });

    it('returns empty array when no children', () => {
      const children = task.findChildren(99999);
      expect(children).toEqual([]);
    });
  });

  // ========== getAssignedTasks ==========

  describe('getAssignedTasks()', () => {
    let agentId;

    beforeEach(() => {
      const r = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('agent','tok','agent')"
      ).run();
      agentId = r.lastInsertRowid;
    });

    it('returns only tasks assigned to the user, excluding done', () => {
      const t1 = task.create({ title: 'Assigned open', userId });
      task.update(t1.lastInsertRowid, { assigned_to: agentId, status: 'open' });

      const t2 = task.create({ title: 'Assigned done', userId });
      task.update(t2.lastInsertRowid, { assigned_to: agentId, status: 'done' });

      const t3 = task.create({ title: 'Assigned in_progress', userId });
      task.update(t3.lastInsertRowid, { assigned_to: agentId, status: 'in_progress' });

      const results = task.getAssignedTasks(agentId);
      expect(results.length).toBe(2);
      expect(results.map(r => r.title)).toContain('Assigned open');
      expect(results.map(r => r.title)).toContain('Assigned in_progress');
    });

    it('returns empty when nothing assigned', () => {
      const results = task.getAssignedTasks(agentId);
      expect(results).toEqual([]);
    });
  });

  // ========== update ==========

  describe('update()', () => {
    it('updates a single allowed field', () => {
      const r = task.create({ title: 'Old title', userId });
      task.update(r.lastInsertRowid, { title: 'New title' });
      expect(task.findById(r.lastInsertRowid).title).toBe('New title');
    });

    it('updates multiple fields at once', () => {
      const r = task.create({ title: 'Multi', userId });
      task.update(r.lastInsertRowid, { title: 'Updated', status: 'done' });
      const row = task.findById(r.lastInsertRowid);
      expect(row.title).toBe('Updated');
      expect(row.status).toBe('done');
    });

    it('ignores disallowed fields silently', () => {
      const r = task.create({ title: 'Safe', userId });
      task.update(r.lastInsertRowid, { title: 'Safe 2', bogus_field: 'evil' });
      const row = task.findById(r.lastInsertRowid);
      expect(row.title).toBe('Safe 2');
      expect(row.bogus_field).toBeUndefined();
    });

    it('returns changes=0 when no fields are passed', () => {
      const r = task.create({ title: 'No change', userId });
      const result = task.update(r.lastInsertRowid, {});
      expect(result.changes).toBe(0);
    });

    it('updates updated_at timestamp', () => {
      const r = task.create({ title: 'Timestamp', userId });
      const before = task.findById(r.lastInsertRowid).updated_at;
      // Small delay to ensure timestamp changes (SQLite datetime('now') has second precision)
      const start = Date.now();
      while (Date.now() === start) { /* busy-wait ~1ms */ }
      task.update(r.lastInsertRowid, { title: 'Stamped' });
      const after = task.findById(r.lastInsertRowid).updated_at;
      expect(before).toBeDefined();
      expect(after).toBeDefined();
    });
  });

  // ========== delete ==========

  describe('delete()', () => {
    it('deletes task by id', () => {
      const r = task.create({ title: 'Gone', userId });
      task.delete(r.lastInsertRowid);
      expect(task.findById(r.lastInsertRowid)).toBeUndefined();
    });

    it('deleting non-existent id does not throw', () => {
      expect(() => task.delete(99999)).not.toThrow();
    });
  });

  // ========== hasActiveChildren ==========

  describe('hasActiveChildren()', () => {
    it('returns true when there are active (non-done, non-rejected) children', () => {
      const parent = task.create({ title: 'Parent', userId });
      task.create({ title: 'Active child', userId, parentId: parent.lastInsertRowid });
      expect(task.hasActiveChildren(parent.lastInsertRowid)).toBe(true);
    });

    it('returns false when all children are done', () => {
      const parent = task.create({ title: 'Parent', userId });
      const child = task.create({ title: 'Done child', userId, parentId: parent.lastInsertRowid });
      task.update(child.lastInsertRowid, { status: 'done' });
      expect(task.hasActiveChildren(parent.lastInsertRowid)).toBe(false);
    });

    it('returns false when all children are rejected', () => {
      const parent = task.create({ title: 'Parent', userId });
      const child = task.create({ title: 'Rejected child', userId, parentId: parent.lastInsertRowid });
      task.update(child.lastInsertRowid, { status: 'rejected' });
      expect(task.hasActiveChildren(parent.lastInsertRowid)).toBe(false);
    });

    it('returns false when no children exist', () => {
      expect(task.hasActiveChildren(99999)).toBe(false);
    });
  });

  // ========== list (with filters, sort, pagination) ==========

  describe('list()', () => {
    it('returns paginated results with defaults (page=1, limit=20)', () => {
      for (let i = 1; i <= 5; i++) {
        task.create({ title: `Task ${i}`, userId });
      }
      const result = task.list({ userId });
      expect(result.rows.length).toBe(5);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('paginates correctly — second page', () => {
      for (let i = 1; i <= 5; i++) {
        task.create({ title: `Task ${i}`, userId });
      }
      const result = task.list({ userId, filters: { page: 2, limit: 2 } });
      expect(result.rows.length).toBe(2);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(5);
    });

    it('clamps page < 1 to page 1', () => {
      task.create({ title: 'T1', userId });
      const result = task.list({ userId, filters: { page: -1 } });
      expect(result.page).toBe(1);
    });

    it('clamps limit > 100 to 100', () => {
      const result = task.list({ userId, filters: { limit: 999 } });
      expect(result.limit).toBe(100);
    });

    it('clamps limit=0 to default 20 (falsy triggers default)', () => {
      const result = task.list({ userId, filters: { limit: 0 } });
      expect(result.limit).toBe(20);
    });

    it('filters by status', () => {
      const r1 = task.create({ title: 'Open', userId });
      const r2 = task.create({ title: 'Done', userId });
      task.update(r2.lastInsertRowid, { status: 'done' });

      const result = task.list({ userId, filters: { status: 'done' } });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].title).toBe('Done');
    });

    it('filters by assigned_to', () => {
      const agentId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('filter-agent','tok-filter','agent')"
      ).run().lastInsertRowid;

      const r1 = task.create({ title: 'Assigned', userId });
      task.update(r1.lastInsertRowid, { assigned_to: agentId });
      task.create({ title: 'Unassigned', userId });

      const result = task.list({ userId, filters: { assigned_to: agentId } });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].title).toBe('Assigned');
    });

    it('filters by parent_id', () => {
      const parent = task.create({ title: 'Parent', userId });
      task.create({ title: 'Child', userId, parentId: parent.lastInsertRowid });
      task.create({ title: 'Orphan', userId });

      const result = task.list({ userId, filters: { parent_id: parent.lastInsertRowid } });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].title).toBe('Child');
    });

    it('sorts by created_at DESC by default', () => {
      task.create({ title: 'First', userId });
      task.create({ title: 'Second', userId });
      task.create({ title: 'Third', userId });
      const result = task.list({ userId });
      expect(result.total).toBe(3);
      expect(result.rows.length).toBe(3);
      // All titles are present
      const titles = result.rows.map(r => r.title).sort();
      expect(titles).toEqual(['First', 'Second', 'Third']);
    });

    it('sorts by due_date ASC', () => {
      task.create({ title: 'Late', userId, dueDate: '2026-12-31' });
      task.create({ title: 'Early', userId, dueDate: '2026-01-01' });
      const result = task.list({ userId, filters: { sort: 'due_date', order: 'asc' } });
      expect(result.rows[0].title).toBe('Early');
      expect(result.rows[1].title).toBe('Late');
    });

    it('defaults to created_at DESC for invalid sort field', () => {
      task.create({ title: 'First', userId });
      task.create({ title: 'Second', userId });
      const result = task.list({ userId, filters: { sort: 'bogus_field' } });
      // Falls back to created_at DESC — 2 rows returned, both present
      expect(result.rows.length).toBe(2);
      expect(result.rows.map(r => r.title).sort()).toEqual(['First', 'Second']);
    });

    it('isolates tasks by user_id — only returns current user tasks', () => {
      const otherUserId = db.prepare(
        "INSERT INTO users (username, token, role) VALUES ('other','tok2','human')"
      ).run().lastInsertRowid;

      task.create({ title: 'Mine', userId });
      task.create({ title: 'Theirs', userId: otherUserId });

      const result = task.list({ userId });
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].title).toBe('Mine');
    });

    it('_count returns filtered count', () => {
      task.create({ title: 'Open task', userId });
      task.create({ title: 'Done task', userId });
      task.update(2, { status: 'done' });

      const total = task._count(userId);
      expect(total).toBe(2);

      const done = task._count(userId, { status: 'done' });
      expect(done).toBe(1);
    });
  });

  // ========== Status Machine: assign ==========

  let agentId;
  beforeEach(() => {
    agentId = db.prepare(
      "INSERT INTO users (username, token, role) VALUES ('sm-agent','sm-tok','agent')"
    ).run().lastInsertRowid;
  });

  describe('assign()', () => {
    it('sets status to assigned and records assigned_to', () => {
      const r = task.create({ title: 'Assign me', userId });
      task.assign(r.lastInsertRowid, agentId);
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('assigned');
      expect(row.assigned_to).toBe(agentId);
    });
  });

  // ========== Status Machine: start ==========

  describe('start()', () => {
    it('transitions from assigned to in_progress', () => {
      const r = task.create({ title: 'Start me', userId });
      task.assign(r.lastInsertRowid, agentId);
      const result = task.start(r.lastInsertRowid);
      expect(result.changes).toBe(1);
      expect(task.findById(r.lastInsertRowid).status).toBe('in_progress');
    });

    it('rejects start from open status', () => {
      const r = task.create({ title: 'Not assigned', userId });
      const result = task.start(r.lastInsertRowid);
      expect(result.changes).toBe(0);
      expect(result.error).toContain('Can only start tasks with status: assigned');
    });

    it('rejects start from done status', () => {
      const r = task.create({ title: 'Already done', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.start(r.lastInsertRowid);
      expect(result.error).toBeDefined();
    });

    it('does not start a non-existent task', () => {
      const result = task.start(99999);
      expect(result.error).toBeDefined();
    });
  });

  // ========== Status Machine: submit ==========

  describe('submit()', () => {
    it('submits from assigned (auto-start then submit)', () => {
      const r = task.create({ title: 'Submit', userId });
      task.assign(r.lastInsertRowid, agentId);
      const result = task.submit(r.lastInsertRowid, 'Done!');
      expect(result.changes).toBe(1);
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('done');
      expect(row.result).toBe('Done!');
    });

    it('submits from in_progress', () => {
      const r = task.create({ title: 'In progress', userId });
      task.assign(r.lastInsertRowid, agentId);
      task.start(r.lastInsertRowid);
      const result = task.submit(r.lastInsertRowid, 'Finished');
      expect(task.findById(r.lastInsertRowid).status).toBe('done');
    });

    it('submits from rejected (resubmission)', () => {
      const r = task.create({ title: 'Rejected', userId });
      task.update(r.lastInsertRowid, { status: 'rejected' });
      const result = task.submit(r.lastInsertRowid, 'Redone');
      expect(task.findById(r.lastInsertRowid).status).toBe('done');
    });

    it('rejects submit from open status', () => {
      const r = task.create({ title: 'Open', userId });
      const result = task.submit(r.lastInsertRowid, 'Skip assign');
      expect(result.changes).toBe(0);
      expect(result.error).toContain('Can only submit');
    });

    it('rejects submit from done status', () => {
      const r = task.create({ title: 'Done', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.submit(r.lastInsertRowid, 'double');
      expect(result.error).toBeDefined();
    });

    it('rejects submit for non-existent task', () => {
      const result = task.submit(99999, 'ghost');
      expect(result.error).toBe('Task not found');
    });

    it('serializes object result to JSON string', () => {
      const r = task.create({ title: 'Json result', userId });
      task.update(r.lastInsertRowid, { status: 'in_progress' });
      task.submit(r.lastInsertRowid, { score: 95, notes: 'good' });
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('done');
      expect(JSON.parse(row.result)).toEqual({ score: 95, notes: 'good' });
    });
  });

  // ========== Status Machine: review ==========

  describe('review()', () => {
    it('accepts a done task (stays done)', () => {
      const r = task.create({ title: 'To accept', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.review(r.lastInsertRowid, 'accept');
      expect(result.verdict).toBe('accepted');
      expect(task.findById(r.lastInsertRowid).status).toBe('done');
    });

    it('rejects a done task (moves to rejected)', () => {
      const r = task.create({ title: 'To reject', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.review(r.lastInsertRowid, 'reject', 'Needs more work');
      expect(result.verdict).toBe('rejected');
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('rejected');
      expect(row.result).toBe('Needs more work');
    });

    it('rejects task with falsy note (stores null)', () => {
      const r = task.create({ title: 'To reject null note', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.review(r.lastInsertRowid, 'reject');
      expect(result.verdict).toBe('rejected');
      const row = task.findById(r.lastInsertRowid);
      expect(row.status).toBe('rejected');
      expect(row.result).toBeNull();
    });

    it('rejects review when status is not done', () => {
      const r = task.create({ title: 'Open', userId });
      const result = task.review(r.lastInsertRowid, 'accept');
      expect(result.error).toContain('Can only review tasks with status: done');
      expect(result.status).toBe(409);
    });

    it('rejects review for non-existent task', () => {
      const result = task.review(99999, 'accept');
      expect(result.error).toBe('Task not found');
      expect(result.status).toBe(404);
    });

    it('rejects review with invalid verdict', () => {
      const r = task.create({ title: 'Done', userId });
      task.update(r.lastInsertRowid, { status: 'done' });
      const result = task.review(r.lastInsertRowid, 'maybe', 'hmm');
      expect(result).toBeUndefined();
    });
  });

  // ========== _maybeWakeParent ==========

  describe('_maybeWakeParent (implicit via submit/review)', () => {
    it('wakes parent when all siblings are done via submit', () => {
      const parent = task.create({ title: 'Parent', userId });
      const sub1 = task.create({ title: 'Sub 1', userId, parentId: parent.lastInsertRowid });
      const sub2 = task.create({ title: 'Sub 2', userId, parentId: parent.lastInsertRowid });

      task.update(sub1.lastInsertRowid, { status: 'in_progress' });
      task.submit(sub1.lastInsertRowid, 'Done 1');
      // Only 1/2 done — parent should still be open
      expect(task.findById(parent.lastInsertRowid).status).toBe('open');

      task.update(sub2.lastInsertRowid, { status: 'in_progress' });
      task.submit(sub2.lastInsertRowid, 'Done 2');
      // 2/2 done — parent should wake
      expect(task.findById(parent.lastInsertRowid).status).toBe('in_progress');
    });

    it('does NOT wake parent if not all siblings done', () => {
      const parent = task.create({ title: 'Parent', userId });
      task.create({ title: 'Sub 1', userId, parentId: parent.lastInsertRowid });
      task.create({ title: 'Sub 2', userId, parentId: parent.lastInsertRowid });

      // No siblings done — parent stays open
      expect(task.findById(parent.lastInsertRowid).status).toBe('open');
    });

    it('wakes parent via submit flow', () => {
      const parent = task.create({ title: 'Parent', userId });
      const sub = task.create({ title: 'Sub', userId, parentId: parent.lastInsertRowid });
      task.update(sub.lastInsertRowid, { status: 'in_progress' });
      task.submit(sub.lastInsertRowid, 'Done');

      // Single child done → parent wakes
      expect(task.findById(parent.lastInsertRowid).status).toBe('in_progress');
    });

    it('does nothing when task has no parent', () => {
      const standalone = task.create({ title: 'Standalone', userId });
      task.update(standalone.lastInsertRowid, { status: 'in_progress' });
      task.submit(standalone.lastInsertRowid, 'Done');
      // No parent — no crash, no side effects
      expect(task.findById(standalone.lastInsertRowid).status).toBe('done');
    });
  });

  // ========== _notifyParent ==========

  describe('_notifyParent (callback_queue)', () => {
    it('inserts into callback_queue when owner has callback_url', () => {
      // User with callback_url
      const ownerId = db.prepare(
        "INSERT INTO users (username, token, role, callback_url) VALUES ('cb-owner','tok-cb','human','http://hook.local')"
      ).run().lastInsertRowid;

      const parent = task.create({ title: 'Parent with cb', userId: ownerId });
      const sub = task.create({ title: 'Sub', userId: ownerId, parentId: parent.lastInsertRowid });
      task.update(sub.lastInsertRowid, { status: 'in_progress' });
      task.submit(sub.lastInsertRowid, 'Done');

      const cbs = db.prepare('SELECT * FROM callback_queue').all();
      expect(cbs.length).toBe(1);
      expect(cbs[0].task_id).toBe(parent.lastInsertRowid);
      expect(cbs[0].url).toBe('http://hook.local');
    });

    it('does NOT insert into callback_queue when owner has no callback_url', () => {
      const parent = task.create({ title: 'Parent no cb', userId });
      const sub = task.create({ title: 'Sub', userId, parentId: parent.lastInsertRowid });
      task.update(sub.lastInsertRowid, { status: 'in_progress' });
      task.submit(sub.lastInsertRowid, 'Done');

      const cbs = db.prepare('SELECT * FROM callback_queue').all();
      expect(cbs.length).toBe(0);
    });

    it('uses INSERT OR IGNORE — duplicate entries are ignored', () => {
      const ownerId = db.prepare(
        "INSERT INTO users (username, token, role, callback_url) VALUES ('dup-owner','tok-dup','human','http://hook2.local')"
      ).run().lastInsertRowid;

      const parent = task.create({ title: 'Parent dup', userId: ownerId });
      const sub1 = task.create({ title: 'Sub 1', userId: ownerId, parentId: parent.lastInsertRowid });
      const sub2 = task.create({ title: 'Sub 2', userId: ownerId, parentId: parent.lastInsertRowid });

      task.update(sub1.lastInsertRowid, { status: 'done' });
      task.update(sub2.lastInsertRowid, { status: 'in_progress' });

      // First child done — not all siblings, no wake yet
      let cbs = db.prepare('SELECT * FROM callback_queue').all();
      expect(cbs.length).toBe(0);

      // Second child done — parent wakes, callback inserted
      task.submit(sub2.lastInsertRowid, 'Done');
      cbs = db.prepare('SELECT * FROM callback_queue').all();
      expect(cbs.length).toBe(1);
    });

    it('_notifyParent does nothing when task does not exist (defensive)', () => {
      // Direct call with non-existent task ID — should not throw
      expect(() => task._notifyParent(99999)).not.toThrow();
    });
  });

  describe('setError', () => {
    it('transitions task status to error', () => {
      const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'in_progress')").run(userId).lastInsertRowid;
      task.setError(taskId);
      const t = task.findById(taskId);
      expect(t.status).toBe('error');
    });
  });

  describe('abort', () => {
    it('transitions task from error to aborted', () => {
      const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'error')").run(userId).lastInsertRowid;
      task.abort(taskId);
      const t = task.findById(taskId);
      expect(t.status).toBe('aborted');
    });

    it('rejects abort from non-error status', () => {
      const taskId = db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, 'test', 'open')").run(userId).lastInsertRowid;
      const r = task.abort(taskId);
      expect(r.error).toBeDefined();
    });

    it('rejects abort for non-existent task', () => {
      const r = task.abort(999);
      expect(r.error).toBeDefined();
    });
  });
});
