import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { User } from '../../src/models/User.js';
import { auth } from '../../src/middleware/auth.js';

function mockReq(overrides = {}) {
  return {
    headers: {},
    db: null,
    ...overrides
  };
}

function mockRes() {
  const res = {};
  res.status = (code) => {
    res._status = code;
    return { json: (body) => { res._body = body; return res; } };
  };
  return res;
}

describe('auth middleware', () => {
  let db;
  let validToken;

  beforeEach(() => {
    db = initDb(':memory:');
    const user = new User(db);
    const result = user.register({ username: 'test-user', role: 'human' });
    validToken = result.token;
  });

  it('calls next() for valid Bearer token', () => {
    const req = mockReq({
      headers: { authorization: `Bearer ${validToken}` },
      db
    });
    const res = mockRes();
    let called = false;

    auth(req, res, () => { called = true; });

    expect(called).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.username).toBe('test-user');
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = mockReq({ db });
    const res = mockRes();
    let called = false;

    auth(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body.error).toContain('Missing or invalid');
  });

  it('returns 401 when Authorization header is not Bearer format', () => {
    const req = mockReq({
      headers: { authorization: 'Basic abc123' },
      db
    });
    const res = mockRes();
    let called = false;

    auth(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns 401 when Bearer token is empty', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer ' },
      db
    });
    const res = mockRes();
    let called = false;

    auth(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe('Token is required');
  });

  it('returns 401 when token does not match any user', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer 00000000-0000-0000-0000-000000000000' },
      db
    });
    const res = mockRes();
    let called = false;

    auth(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe('Invalid token');
  });
});
