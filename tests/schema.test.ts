/**
 * Schema Tests — Zod integration, SQL DDL, ES mapping generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  registerCollection,
  getSchema,
  getRegisteredCollections,
  validateDocument,
  generateCreateTableSQL,
  generateCreateIndexSQL,
  generateElasticMapping,
  clearRegistry,
} from '../src/schema.js';

beforeEach(() => {
  clearRegistry();
});

const userSchema = z.object({
  email: z.string().max(255),
  name: z.string(),
  age: z.number().int().optional(),
  role: z.enum(['admin', 'user', 'mod']),
  active: z.boolean(),
  createdAt: z.date(),
  tags: z.array(z.string()).optional(),
  metadata: z.object({ source: z.string() }).optional(),
});

describe('Schema Registry', () => {
  it('registers and retrieves schema', () => {
    registerCollection({ name: 'users', schema: userSchema });
    const schema = getSchema('users');
    expect(schema).toBeDefined();
    expect(schema!.name).toBe('users');
  });

  it('lists registered collections', () => {
    registerCollection({ name: 'users', schema: userSchema });
    registerCollection({ name: 'orders', schema: z.object({ id: z.string() }) });
    expect(getRegisteredCollections()).toEqual(['users', 'orders']);
  });
});

describe('Document Validation', () => {
  it('validates valid document', () => {
    registerCollection({ name: 'users', schema: userSchema });
    const error = validateDocument('users', {
      email: 'tim@example.com',
      name: 'Tim',
      role: 'admin',
      active: true,
      createdAt: new Date(),
    });
    expect(error).toBeNull();
  });

  it('rejects invalid document', () => {
    registerCollection({ name: 'users', schema: userSchema });
    const error = validateDocument('users', {
      email: 123, // wrong type
      name: 'Tim',
      role: 'superadmin', // not in enum
      active: true,
      createdAt: new Date(),
    });
    expect(error).not.toBeNull();
    expect(error!.issues.length).toBeGreaterThan(0);
  });

  it('returns null for unregistered collection', () => {
    const error = validateDocument('unknown', { anything: 'works' });
    expect(error).toBeNull();
  });
});

describe('SQL DDL Generation', () => {
  it('generates PostgreSQL CREATE TABLE', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'pg');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('"email" VARCHAR(255) NOT NULL');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"age" INTEGER');
    expect(sql).toContain('"role" TEXT NOT NULL');
    expect(sql).toContain('"active" BOOLEAN NOT NULL');
    expect(sql).toContain('"createdAt" TIMESTAMPTZ NOT NULL');
  });

  it('generates MySQL CREATE TABLE', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'mysql2');
    expect(sql).toContain('"email" VARCHAR(255) NOT NULL');
    expect(sql).toContain('"active" TINYINT(1) NOT NULL');
    expect(sql).toContain('"createdAt" DATETIME NOT NULL');
  });

  it('generates SQLite CREATE TABLE', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'sqlite');
    expect(sql).toContain('"email" TEXT NOT NULL');
    expect(sql).toContain('"active" INTEGER NOT NULL');
    expect(sql).toContain('"createdAt" TEXT NOT NULL');
  });

  it('generates MSSQL CREATE TABLE', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'mssql');
    expect(sql).toContain('"email" NVARCHAR(255) NOT NULL');
    expect(sql).toContain('"active" BIT NOT NULL');
    expect(sql).toContain('"createdAt" DATETIME2 NOT NULL');
  });

  it('handles optional fields', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'pg');
    // age is optional — should NOT have NOT NULL
    const ageLine = sql.split('\n').find(l => l.includes('"age"'));
    expect(ageLine).toBeDefined();
    expect(ageLine).not.toContain('NOT NULL');
  });

  it('generates enum CHECK constraint', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'pg');
    expect(sql).toContain("CHECK");
    expect(sql).toContain("'admin'");
    expect(sql).toContain("'user'");
    expect(sql).toContain("'mod'");
  });

  it('maps arrays to JSONB for PG', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'pg');
    const tagsLine = sql.split('\n').find(l => l.includes('"tags"'));
    expect(tagsLine).toContain('JSONB');
  });

  it('maps objects to JSONB for PG', () => {
    const sql = generateCreateTableSQL('users', userSchema, 'pg');
    const metadataLine = sql.split('\n').find(l => l.includes('"metadata"'));
    expect(metadataLine).toContain('JSONB');
  });
});

describe('SQL Index Generation', () => {
  it('generates simple index', () => {
    const sql = generateCreateIndexSQL({ collection: 'users', fields: { email: 1 } });
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('"email" ASC');
    expect(sql).toContain('"users"');
  });

  it('generates unique index', () => {
    const sql = generateCreateIndexSQL({ collection: 'users', fields: { email: 1 }, unique: true });
    expect(sql).toContain('CREATE UNIQUE INDEX');
  });

  it('generates multi-field index', () => {
    const sql = generateCreateIndexSQL({ collection: 'users', fields: { role: 1, name: -1 } });
    expect(sql).toContain('"role" ASC');
    expect(sql).toContain('"name" DESC');
  });

  it('generates sparse index for PG', () => {
    const sql = generateCreateIndexSQL({ collection: 'users', fields: { email: 1 }, sparse: true }, 'pg');
    expect(sql).toContain('WHERE');
    expect(sql).toContain('IS NOT NULL');
  });
});

describe('Elasticsearch Mapping Generation', () => {
  it('generates correct mapping types', () => {
    const mapping = generateElasticMapping(userSchema);
    expect(mapping).toHaveProperty('properties');
    const props = mapping.properties as Record<string, Record<string, unknown>>;

    // email has max(255) → keyword
    expect(props['email']).toEqual({ type: 'keyword' });

    // name is text with keyword subfield
    expect(props['name']).toEqual({ type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } });

    // age is integer
    expect(props['age']).toEqual({ type: 'integer' });

    // role is enum → keyword
    expect(props['role']).toEqual({ type: 'keyword' });

    // active is boolean
    expect(props['active']).toEqual({ type: 'boolean' });

    // createdAt is date
    expect(props['createdAt']).toEqual({ type: 'date' });

    // tags is array → nested
    expect(props['tags']).toEqual({ type: 'nested' });

    // metadata is object
    expect(props['metadata']).toEqual({ type: 'object' });
  });
});
