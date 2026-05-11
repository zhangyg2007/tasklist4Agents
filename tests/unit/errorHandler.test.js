import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function mockRes() {
  const res = {};
  res.status = (code) => {
    res._status = code;
    return { json: (body) => { res._body = body; return res; } };
  };
  return res;
}

describe('errorHandler middleware', () => {
  const originalError = console.error;

  beforeEach(() => {
    console.error = () => {};
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('handles JSON parse error (entity.parse.failed)', () => {
    const err = new SyntaxError('Unexpected token');
    err.type = 'entity.parse.failed';
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Invalid JSON in request body');
  });

  it('handles SQLite CHECK constraint error', () => {
    const err = new Error('CHECK constraint failed: length(title) > 0');
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(400);
    expect(res._body.error).toContain('length');
  });

  it('handles SQLite FOREIGN KEY constraint error', () => {
    const err = new Error('FOREIGN KEY constraint failed');
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Referenced record does not exist');
  });

  it('handles unknown errors as 500', () => {
    const err = new Error('Something unexpected happened');
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Internal server error');
  });

  it('handles errors without message gracefully', () => {
    const err = {};
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Internal server error');
  });

  it('handles errors without stack trace gracefully', () => {
    const err = new Error('No stack');
    delete err.stack;
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(500);
  });

  it('extracts field name from CHECK constraint using regex', () => {
    const err = new Error('CHECK constraint failed: priority IN ');
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(400);
    expect(res._body.error).toContain('priority');
  });

  it('uses unknown fallback when CHECK regex does not match', () => {
    const err = new Error('CHECK constraint failed');
    const res = mockRes();

    errorHandler(err, {}, res, () => {});

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Constraint violation: unknown');
  });
});
