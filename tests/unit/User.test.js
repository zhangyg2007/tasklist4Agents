import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { initDb } from '../../src/db.js';
import { User } from '../../src/models/User.js';

describe('User model', () => {
  let db;
  let user;

  beforeEach(() => {
    // Fresh in-memory DB for each test — true isolation
    db = initDb(':memory:');
    user = new User(db);
  });

  afterAll(() => {
    // No global cleanup needed per-test since beforeEach creates fresh DBs
  });

  // ========== register ==========

  describe('register()', () => {
    it('registers a human user with minimal fields', () => {
      const result = user.register({ username: 'bob' });
      expect(result.error).toBeUndefined();
      expect(result.id).toBeGreaterThan(0);
      expect(result.username).toBe('bob');
      expect(result.token).toBeDefined();
      expect(result.role).toBe('human');
      expect(result.source).toBeNull();
      expect(result.callback_url).toBeNull();
      expect(typeof result.capabilities).toBe('string');
    });

    it('registers an agent with all fields', () => {
      const result = user.register({
        username: 'openclaw-main',
        role: 'agent',
        source: 'openclaw',
        capabilities: ['code-gen', 'review'],
        callback_url: 'http://callback.local/agent1'
      });
      expect(result.error).toBeUndefined();
      expect(result.role).toBe('agent');
      expect(result.source).toBe('openclaw');
      expect(JSON.parse(result.capabilities)).toEqual(['code-gen', 'review']);
      expect(result.callback_url).toBe('http://callback.local/agent1');
    });

    it('generates unique tokens for different users', () => {
      const r1 = user.register({ username: 'a' });
      const r2 = user.register({ username: 'b' });
      expect(r1.token).not.toBe(r2.token);
      // Tokens should be UUID v4 format
      expect(r1.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('rejects duplicate username with status 409', () => {
      user.register({ username: 'collision' });
      const result = user.register({ username: 'collision' });
      expect(result.error).toBe('username already taken');
      expect(result.status).toBe(409);
    });

    it('rejects invalid role with status 400', () => {
      const result = user.register({ username: 'bad', role: 'robot' });
      expect(result.error).toBe('role must be human or agent');
      expect(result.status).toBe(400);
    });

    it('defaults role to human when role is undefined', () => {
      const result = user.register({ username: 'default-human' });
      expect(result.role).toBe('human');
    });

    it('defaults role to human when role is falsy empty string', () => {
      const result = user.register({ username: 'default-human2', role: '' });
      expect(result.role).toBe('human');
    });

    it('accepts capabilities as a pre-serialized JSON string', () => {
      const result = user.register({
        username: 'string-caps',
        role: 'agent',
        capabilities: '["code-gen"]'
      });
      expect(result.capabilities).toBe('["code-gen"]');
    });

    it('stores empty JSON array when capabilities not provided', () => {
      const result = user.register({ username: 'no-caps', role: 'agent' });
      expect(result.capabilities).toBe('[]');
    });

    it('stores source as null when not provided', () => {
      const result = user.register({ username: 'no-source', role: 'agent' });
      expect(result.source).toBeNull();
    });

    it('stores callback_url as null when not provided', () => {
      const result = user.register({ username: 'no-cb', role: 'agent' });
      expect(result.callback_url).toBeNull();
    });
  });

  // ========== findByToken ==========

  describe('findByToken()', () => {
    it('returns user when token exists', () => {
      const { token } = user.register({ username: 'find-me' });
      const found = user.findByToken(token);
      expect(found).toBeDefined();
      expect(found.username).toBe('find-me');
      expect(found.role).toBe('human');
    });

    it('returns undefined when token does not exist', () => {
      const found = user.findByToken('00000000-0000-0000-0000-000000000000');
      expect(found).toBeUndefined();
    });

    it('finds agent with all metadata intact', () => {
      const { token } = user.register({
        username: 'full-agent',
        role: 'agent',
        source: 'hermes',
        capabilities: ['code-gen'],
        callback_url: 'http://cb.local'
      });
      const found = user.findByToken(token);
      expect(found.username).toBe('full-agent');
      expect(found.source).toBe('hermes');
      expect(JSON.parse(found.capabilities)).toEqual(['code-gen']);
      expect(found.callback_url).toBe('http://cb.local');
    });
  });

  // ========== findById ==========

  describe('findById()', () => {
    it('returns user when id exists', () => {
      const { id } = user.register({ username: 'by-id' });
      const found = user.findById(id);
      expect(found).toBeDefined();
      expect(found.username).toBe('by-id');
    });

    it('returns undefined when id does not exist', () => {
      const found = user.findById(99999);
      expect(found).toBeUndefined();
    });

    it('returns undefined when id is 0', () => {
      const found = user.findById(0);
      expect(found).toBeUndefined();
    });
  });

  // ========== listAgents ==========

  describe('listAgents()', () => {
    it('returns only users with role=agent, not humans', () => {
      user.register({ username: 'human1', role: 'human' });
      user.register({ username: 'agent1', role: 'agent', source: 'openclaw' });
      user.register({ username: 'human2', role: 'human' });
      user.register({ username: 'agent2', role: 'agent', source: 'hermes' });

      const agents = user.listAgents();
      expect(agents.length).toBe(2);
      expect(agents.every(a => a.role === 'agent')).toBe(true);
    });

    it('returns empty array when no agents registered', () => {
      user.register({ username: 'human1', role: 'human' });
      const agents = user.listAgents();
      expect(agents).toEqual([]);
    });

    it('filters by source', () => {
      user.register({ username: 'a1', role: 'agent', source: 'openclaw' });
      user.register({ username: 'a2', role: 'agent', source: 'openclaw' });
      user.register({ username: 'a3', role: 'agent', source: 'hermes' });

      const filtered = user.listAgents({ source: 'openclaw' });
      expect(filtered.length).toBe(2);
      expect(filtered.every(a => a.source === 'openclaw')).toBe(true);
    });

    it('filters by single capability', () => {
      user.register({ username: 'a1', role: 'agent', capabilities: ['code-gen'] });
      user.register({ username: 'a2', role: 'agent', capabilities: ['review'] });
      user.register({ username: 'a3', role: 'agent', capabilities: ['code-gen', 'review'] });

      const filtered = user.listAgents({ capabilities: 'code-gen' });
      expect(filtered.length).toBe(2);
    });

    it('filters by multiple capabilities (AND)', () => {
      user.register({ username: 'a1', role: 'agent', capabilities: ['code-gen'] });
      user.register({ username: 'a2', role: 'agent', capabilities: ['code-gen', 'review'] });
      user.register({ username: 'a3', role: 'agent', capabilities: ['review'] });

      const filtered = user.listAgents({ capabilities: 'code-gen,review' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].username).toBe('a2');
    });

    it('combines source and capability filters', () => {
      user.register({ username: 'a1', role: 'agent', source: 'openclaw', capabilities: ['code-gen'] });
      user.register({ username: 'a2', role: 'agent', source: 'hermes', capabilities: ['code-gen'] });

      const filtered = user.listAgents({ source: 'openclaw', capabilities: 'code-gen' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].username).toBe('a1');
    });

    it('returns empty when no agent matches filters', () => {
      user.register({ username: 'a1', role: 'agent', source: 'openclaw' });
      const filtered = user.listAgents({ source: 'nonexistent' });
      expect(filtered).toEqual([]);
    });

    it('returns parsed capabilities in the result', () => {
      user.register({ username: 'a1', role: 'agent', capabilities: ['code-gen'] });
      const agents = user.listAgents();
      // listAgents returns raw DB fields — capabilities is still a JSON string
      expect(typeof agents[0].capabilities).toBe('string');
    });
  });

  // ========== matchByCapabilities ==========

  describe('matchByCapabilities()', () => {
    test('returns agents matching a capability keyword', () => {
      db.prepare("DELETE FROM users");
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', ?)").run('["code-gen","debug"]');
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', ?)").run('["review","deploy"]');
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a3', 't3', 'agent', ?)").run('["code-gen","review"]');
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('h1', 't4', 'human', ?)").run('["code-gen"]');

      const agents = user.matchByCapabilities('code-gen');
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.username).sort()).toEqual(['a1', 'a3']);
    });

    test('matches multiple capability keywords (OR logic)', () => {
      db.prepare("DELETE FROM users");
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"code-gen\"]')").run();
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', '[\"review\"]')").run();

      const agents = user.matchByCapabilities('code-gen, review');
      expect(agents).toHaveLength(2);
    });

    test('returns empty array when no match', () => {
      db.prepare("DELETE FROM users");
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"debug\"]')").run();

      const agents = user.matchByCapabilities('quantum');
      expect(agents).toHaveLength(0);
    });

    test('excludes a specific agent by id', () => {
      db.prepare("DELETE FROM users");
      db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a1', 't1', 'agent', '[\"code-gen\"]')").run();
      const a2Id = db.prepare("INSERT INTO users (username, token, role, capabilities) VALUES ('a2', 't2', 'agent', '[\"code-gen\"]')").run().lastInsertRowid;

      const agents = user.matchByCapabilities('code-gen', a2Id);
      expect(agents).toHaveLength(1);
      expect(agents[0].username).toBe('a1');
    });
  });
});
