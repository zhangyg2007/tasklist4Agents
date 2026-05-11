import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { User } from '../../src/models/User.js';
import { register, me } from '../../src/controllers/authController.js';

function mockRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

describe('authController', () => {
  let db;
  let req;

  beforeEach(() => {
    db = initDb(':memory:');
    req = { db, body: {}, user: null };
  });

  describe('register()', () => {
    it('creates user and returns 201 with parsed capabilities', () => {
      req.body = { username: 'test', role: 'agent', capabilities: ['code-gen'] };
      const res = mockRes();

      register(req, res);

      expect(res._status).toBe(201);
      expect(res._body.username).toBe('test');
      expect(res._body.token).toBeDefined();
      expect(res._body.role).toBe('agent');
      expect(res._body.capabilities).toEqual(['code-gen']);
    });

    it('defaults role to human when not provided', () => {
      req.body = { username: 'human' };
      const res = mockRes();

      register(req, res);

      expect(res._status).toBe(201);
      expect(res._body.role).toBe('human');
    });

    it('returns 409 when username is duplicate', () => {
      const u = new User(db);
      u.register({ username: 'dup' });

      req.body = { username: 'dup' };
      const res = mockRes();

      register(req, res);

      expect(res._status).toBe(409);
      expect(res._body.error).toContain('already taken');
    });

    it('returns 400 for invalid role', () => {
      req.body = { username: 'bad', role: 'robot' };
      const res = mockRes();

      register(req, res);

      expect(res._status).toBe(400);
    });
  });

  describe('me()', () => {
    it('returns user with parsed capabilities', () => {
      req.user = {
        id: 1,
        username: 'me',
        token: 'tok',
        role: 'agent',
        capabilities: '["code-gen","review"]'
      };
      const res = mockRes();

      me(req, res);

      expect(res._body.username).toBe('me');
      expect(res._body.capabilities).toEqual(['code-gen', 'review']);
    });

    it('handles already-parsed capabilities (array)', () => {
      req.user = {
        id: 2,
        username: 'me2',
        token: 'tok2',
        role: 'human',
        capabilities: ['parsed']
      };
      const res = mockRes();

      me(req, res);

      expect(res._body.capabilities).toEqual(['parsed']);
    });

    it('returns empty array on JSON parse failure', () => {
      req.user = {
        id: 3,
        username: 'bad-caps',
        token: 'tok3',
        role: 'agent',
        capabilities: '{broken json'
      };
      const res = mockRes();

      me(req, res);

      expect(res._body.capabilities).toEqual([]);
    });
  });
});
