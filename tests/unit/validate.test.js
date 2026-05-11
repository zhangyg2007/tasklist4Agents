import { describe, it, expect } from '@jest/globals';
import { requireFields, validateEnum, validateIdParam } from '../../src/middleware/validate.js';

function mockReq(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
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

describe('requireFields middleware', () => {
  it('calls next() when all required fields are present', () => {
    const mw = requireFields('title', 'description');
    const req = mockReq({ body: { title: 'Hello', description: 'World' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(true);
  });

  it('returns 400 when a required field is missing', () => {
    const mw = requireFields('title', 'description');
    const req = mockReq({ body: { title: 'Hello' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('description');
  });

  it('returns 400 when field is null', () => {
    const mw = requireFields('title');
    const req = mockReq({ body: { title: null } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
  });

  it('returns 400 with comma-separated list for multiple missing fields', () => {
    const mw = requireFields('a', 'b', 'c');
    const req = mockReq({ body: {} });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('a, b, c');
  });

  it('allows empty string (only checks undefined and null)', () => {
    const mw = requireFields('title');
    const req = mockReq({ body: { title: '' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(true);
  });
});

describe('validateEnum middleware', () => {
  it('calls next() when value is in allowed set', () => {
    const mw = validateEnum('role', ['human', 'agent']);
    const req = mockReq({ body: { role: 'agent' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(true);
  });

  it('calls next() when value is absent (optional)', () => {
    const mw = validateEnum('role', ['human', 'agent']);
    const req = mockReq({ body: {} });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(true);
  });

  it('returns 400 when value is not in allowed set', () => {
    const mw = validateEnum('role', ['human', 'agent']);
    const req = mockReq({ body: { role: 'robot' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('human, agent');
  });

  it('checks query params when body field is absent', () => {
    const mw = validateEnum('status', ['open', 'done']);
    const req = mockReq({ query: { status: 'done' } });
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    expect(called).toBe(true);
  });
});

describe('validateIdParam middleware', () => {
  it('calls next() and sets req.taskId for valid numeric id', () => {
    const req = mockReq({ params: { id: '42' } });
    const res = mockRes();
    let called = false;

    validateIdParam(req, res, () => { called = true; });

    expect(called).toBe(true);
    expect(req.taskId).toBe(42);
  });

  it('returns 400 for non-numeric id', () => {
    const req = mockReq({ params: { id: 'abc' } });
    const res = mockRes();
    let called = false;

    validateIdParam(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
  });

  it('returns 400 for id = 0', () => {
    const req = mockReq({ params: { id: '0' } });
    const res = mockRes();
    let called = false;

    validateIdParam(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
  });

  it('returns 400 for negative id', () => {
    const req = mockReq({ params: { id: '-5' } });
    const res = mockRes();
    let called = false;

    validateIdParam(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
  });

  it('returns 400 for float id', () => {
    const req = mockReq({ params: { id: '3.14' } });
    const res = mockRes();
    let called = false;

    validateIdParam(req, res, () => { called = true; });

    expect(called).toBe(false);
    expect(res._status).toBe(400);
  });
});
