/**
 * Filter Translator Tests — SQL + ES Query DSL (Critical Path)
 */

import { describe, it, expect } from 'vitest';
import {
  translateToSQL,
  translateToElastic,
  translateSortToSQL,
  translateSortToElastic,
  translateUpdateToSQL,
  translateUpdateToElastic,
  buildSelectSQL,
  buildInsertSQL,
  buildBatchInsertSQL,
  buildUpdateSQL,
  buildDeleteSQL,
  buildCountSQL,
  getExcludedFields,
} from '../src/filter-translator.js';

// ─── SQL Filter Translation ──────────────────────────────────────────────────

describe('translateToSQL', () => {
  it('translates empty filter to 1=1', () => {
    const result = translateToSQL({});
    expect(result.clause).toBe('1=1');
    expect(result.values).toEqual([]);
  });

  it('translates direct equality', () => {
    const result = translateToSQL({ age: 25 });
    expect(result.clause).toBe('"age" = $1');
    expect(result.values).toEqual([25]);
  });

  it('translates string equality', () => {
    const result = translateToSQL({ name: 'Tim' });
    expect(result.clause).toBe('"name" = $1');
    expect(result.values).toEqual(['Tim']);
  });

  it('translates null to IS NULL', () => {
    const result = translateToSQL({ email: null });
    expect(result.clause).toBe('"email" IS NULL');
    expect(result.values).toEqual([]);
  });

  it('translates $eq', () => {
    const result = translateToSQL({ age: { $eq: 25 } });
    expect(result.clause).toBe('"age" = $1');
    expect(result.values).toEqual([25]);
  });

  it('translates $ne', () => {
    const result = translateToSQL({ age: { $ne: 0 } });
    expect(result.clause).toBe('"age" != $1');
    expect(result.values).toEqual([0]);
  });

  it('translates $gt', () => {
    const result = translateToSQL({ age: { $gt: 18 } });
    expect(result.clause).toBe('"age" > $1');
    expect(result.values).toEqual([18]);
  });

  it('translates $gte', () => {
    const result = translateToSQL({ age: { $gte: 18 } });
    expect(result.clause).toBe('"age" >= $1');
    expect(result.values).toEqual([18]);
  });

  it('translates $lt', () => {
    const result = translateToSQL({ age: { $lt: 65 } });
    expect(result.clause).toBe('"age" < $1');
    expect(result.values).toEqual([65]);
  });

  it('translates $lte', () => {
    const result = translateToSQL({ age: { $lte: 65 } });
    expect(result.clause).toBe('"age" <= $1');
    expect(result.values).toEqual([65]);
  });

  it('translates $in', () => {
    const result = translateToSQL({ role: { $in: ['admin', 'mod'] } });
    expect(result.clause).toBe('"role" IN ($1, $2)');
    expect(result.values).toEqual(['admin', 'mod']);
  });

  it('translates $nin', () => {
    const result = translateToSQL({ role: { $nin: ['banned', 'suspended'] } });
    expect(result.clause).toBe('"role" NOT IN ($1, $2)');
    expect(result.values).toEqual(['banned', 'suspended']);
  });

  it('translates $exists: true to IS NOT NULL', () => {
    const result = translateToSQL({ email: { $exists: true } });
    expect(result.clause).toBe('"email" IS NOT NULL');
    expect(result.values).toEqual([]);
  });

  it('translates $exists: false to IS NULL', () => {
    const result = translateToSQL({ email: { $exists: false } });
    expect(result.clause).toBe('"email" IS NULL');
    expect(result.values).toEqual([]);
  });

  it('translates $regex for PostgreSQL', () => {
    const result = translateToSQL({ name: { $regex: '^Tim' } }, 'pg');
    expect(result.clause).toBe('"name" ~ $1');
    expect(result.values).toEqual(['^Tim']);
  });

  it('translates $regex for MySQL', () => {
    const result = translateToSQL({ name: { $regex: '^Tim' } }, 'mysql2');
    expect(result.clause).toBe('"name" REGEXP ?');
    expect(result.values).toEqual(['^Tim']);
  });

  it('translates $not', () => {
    const result = translateToSQL({ age: { $not: { $gt: 18 } } });
    expect(result.clause).toBe('NOT ("age" > $1)');
    expect(result.values).toEqual([18]);
  });

  it('translates $and', () => {
    const result = translateToSQL({ $and: [{ age: { $gte: 18 } }, { role: 'admin' }] });
    expect(result.clause).toBe('(("age" >= $1) AND ("role" = $2))');
    expect(result.values).toEqual([18, 'admin']);
  });

  it('translates $or', () => {
    const result = translateToSQL({ $or: [{ role: 'admin' }, { role: 'mod' }] });
    expect(result.clause).toBe('(("role" = $1) OR ("role" = $2))');
    expect(result.values).toEqual(['admin', 'mod']);
  });

  it('translates $nor', () => {
    const result = translateToSQL({ $nor: [{ role: 'banned' }, { status: 'inactive' }] });
    expect(result.clause).toBe('NOT (("role" = $1) OR ("status" = $2))');
    expect(result.values).toEqual(['banned', 'inactive']);
  });

  it('combines multiple field conditions with AND', () => {
    const result = translateToSQL({ role: 'admin', age: { $gte: 18 } });
    expect(result.clause).toBe('"role" = $1 AND "age" >= $2');
    expect(result.values).toEqual(['admin', 18]);
  });

  it('translates combined range operators', () => {
    const result = translateToSQL({ age: { $gte: 18, $lt: 65 } });
    expect(result.clause).toBe('"age" >= $1 AND "age" < $2');
    expect(result.values).toEqual([18, 65]);
  });

  it('uses ? placeholder for MySQL', () => {
    const result = translateToSQL({ age: 25 }, 'mysql2');
    expect(result.clause).toBe('"age" = ?');
    expect(result.values).toEqual([25]);
  });

  it('uses ? placeholder for SQLite', () => {
    const result = translateToSQL({ age: 25 }, 'sqlite');
    expect(result.clause).toBe('"age" = ?');
    expect(result.values).toEqual([25]);
  });

  it('uses @pN placeholder for MSSQL', () => {
    const result = translateToSQL({ age: 25 }, 'mssql');
    expect(result.clause).toBe('"age" = @p1');
    expect(result.values).toEqual([25]);
  });

  it('throws on unknown operator', () => {
    expect(() => translateToSQL({ age: { $unknown: 5 } } as any))
      .toThrow('Unknown filter operator "$unknown"');
  });

  it('handles empty $in as always-false', () => {
    const result = translateToSQL({ role: { $in: [] } });
    expect(result.clause).toBe('1=0');
    expect(result.values).toEqual([]);
  });
});

// ─── Elasticsearch Filter Translation ────────────────────────────────────────

describe('translateToElastic', () => {
  it('translates empty filter to match_all', () => {
    const result = translateToElastic({});
    expect(result).toEqual({ match_all: {} });
  });

  it('translates direct equality to term', () => {
    const result = translateToElastic({ role: 'admin' });
    expect(result).toEqual({ term: { role: 'admin' } });
  });

  it('translates $eq to term', () => {
    const result = translateToElastic({ role: { $eq: 'admin' } });
    expect(result).toEqual({ term: { role: 'admin' } });
  });

  it('translates $ne to must_not term', () => {
    const result = translateToElastic({ role: { $ne: 'banned' } });
    expect(result).toEqual({ bool: { must_not: { term: { role: 'banned' } } } });
  });

  it('translates $gt to range', () => {
    const result = translateToElastic({ age: { $gt: 18 } });
    expect(result).toEqual({ range: { age: { gt: 18 } } });
  });

  it('translates $gte to range', () => {
    const result = translateToElastic({ age: { $gte: 18 } });
    expect(result).toEqual({ range: { age: { gte: 18 } } });
  });

  it('translates $lt to range', () => {
    const result = translateToElastic({ age: { $lt: 65 } });
    expect(result).toEqual({ range: { age: { lt: 65 } } });
  });

  it('translates $lte to range', () => {
    const result = translateToElastic({ age: { $lte: 65 } });
    expect(result).toEqual({ range: { age: { lte: 65 } } });
  });

  it('combines multiple range operators', () => {
    const result = translateToElastic({ age: { $gte: 18, $lt: 65 } });
    expect(result).toEqual({ range: { age: { gte: 18, lt: 65 } } });
  });

  it('translates $in to terms', () => {
    const result = translateToElastic({ role: { $in: ['admin', 'mod'] } });
    expect(result).toEqual({ terms: { role: ['admin', 'mod'] } });
  });

  it('translates $nin to must_not terms', () => {
    const result = translateToElastic({ role: { $nin: ['banned'] } });
    expect(result).toEqual({ bool: { must_not: { terms: { role: ['banned'] } } } });
  });

  it('translates $exists: true to exists', () => {
    const result = translateToElastic({ email: { $exists: true } });
    expect(result).toEqual({ exists: { field: 'email' } });
  });

  it('translates $exists: false to must_not exists', () => {
    const result = translateToElastic({ email: { $exists: false } });
    expect(result).toEqual({ bool: { must_not: { exists: { field: 'email' } } } });
  });

  it('translates $regex to regexp', () => {
    const result = translateToElastic({ name: { $regex: '^Tim' } });
    expect(result).toEqual({ regexp: { name: '^Tim' } });
  });

  it('translates $and to bool must', () => {
    const result = translateToElastic({ $and: [{ role: 'admin' }, { age: { $gte: 18 } }] });
    expect(result).toEqual({
      bool: {
        must: [
          { term: { role: 'admin' } },
          { range: { age: { gte: 18 } } },
        ],
      },
    });
  });

  it('translates $or to bool should', () => {
    const result = translateToElastic({ $or: [{ role: 'admin' }, { role: 'mod' }] });
    expect(result).toEqual({
      bool: {
        should: [
          { term: { role: 'admin' } },
          { term: { role: 'mod' } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('translates $nor to bool must_not', () => {
    const result = translateToElastic({ $nor: [{ role: 'banned' }] });
    expect(result).toEqual({
      bool: {
        must_not: [
          { term: { role: 'banned' } },
        ],
      },
    });
  });

  it('translates $not', () => {
    const result = translateToElastic({ age: { $not: { $gt: 18 } } });
    expect(result).toEqual({
      bool: { must_not: [{ range: { age: { gt: 18 } } }] },
    });
  });

  it('combines multiple field conditions into bool must', () => {
    const result = translateToElastic({ role: 'admin', age: { $gte: 18 } });
    expect(result).toEqual({
      bool: {
        must: [
          { term: { role: 'admin' } },
          { range: { age: { gte: 18 } } },
        ],
      },
    });
  });

  it('translates null to must_not exists', () => {
    const result = translateToElastic({ email: null });
    expect(result).toEqual({ bool: { must_not: { exists: { field: 'email' } } } });
  });
});

// ─── SQL Sort Translation ────────────────────────────────────────────────────

describe('translateSortToSQL', () => {
  it('translates ascending sort', () => {
    expect(translateSortToSQL({ name: 1 })).toBe('"name" ASC');
  });

  it('translates descending sort', () => {
    expect(translateSortToSQL({ createdAt: -1 })).toBe('"createdAt" DESC');
  });

  it('translates string direction', () => {
    expect(translateSortToSQL({ name: 'asc' })).toBe('"name" ASC');
    expect(translateSortToSQL({ name: 'desc' })).toBe('"name" DESC');
  });

  it('translates multi-field sort', () => {
    expect(translateSortToSQL({ role: 1, name: -1 })).toBe('"role" ASC, "name" DESC');
  });
});

// ─── ES Sort Translation ────────────────────────────────────────────────────

describe('translateSortToElastic', () => {
  it('translates ascending sort', () => {
    expect(translateSortToElastic({ name: 1 })).toEqual([{ name: { order: 'asc' } }]);
  });

  it('translates descending sort', () => {
    expect(translateSortToElastic({ createdAt: -1 })).toEqual([{ createdAt: { order: 'desc' } }]);
  });
});

// ─── SQL Update Translation ──────────────────────────────────────────────────

describe('translateUpdateToSQL', () => {
  it('translates $set', () => {
    const result = translateUpdateToSQL({ $set: { name: 'Bob' } });
    expect(result.setClauses).toBe('"name" = $1');
    expect(result.values).toEqual(['Bob']);
  });

  it('translates $inc', () => {
    const result = translateUpdateToSQL({ $inc: { count: 1 } });
    expect(result.setClauses).toBe('"count" = "count" + $1');
    expect(result.values).toEqual([1]);
  });

  it('translates $unset', () => {
    const result = translateUpdateToSQL({ $unset: { temp: true } } as any);
    expect(result.setClauses).toBe('"temp" = NULL');
    expect(result.values).toEqual([]);
  });

  it('combines multiple update operators', () => {
    const result = translateUpdateToSQL({ $set: { name: 'Bob' }, $inc: { count: 1 } });
    expect(result.setClauses).toBe('"name" = $1, "count" = "count" + $2');
    expect(result.values).toEqual(['Bob', 1]);
  });

  it('throws on empty update', () => {
    expect(() => translateUpdateToSQL({})).toThrow('Update operation has no SET clauses');
  });
});

// ─── ES Update Translation (Painless) ────────────────────────────────────────

describe('translateUpdateToElastic', () => {
  it('translates $set to Painless', () => {
    const result = translateUpdateToElastic({ $set: { name: 'Bob' } });
    expect(result.source).toBe('ctx._source.name = params.set_name');
    expect(result.params).toEqual({ set_name: 'Bob' });
  });

  it('translates $inc to Painless', () => {
    const result = translateUpdateToElastic({ $inc: { count: 1 } });
    expect(result.source).toBe('ctx._source.count += params.inc_count');
    expect(result.params).toEqual({ inc_count: 1 });
  });

  it('translates $unset to Painless', () => {
    const result = translateUpdateToElastic({ $unset: { temp: true } } as any);
    expect(result.source).toContain("ctx._source.remove('temp')");
  });

  it('combines multiple operators', () => {
    const result = translateUpdateToElastic({ $set: { name: 'Bob' }, $inc: { count: 1 } });
    expect(result.source).toBe('ctx._source.name = params.set_name; ctx._source.count += params.inc_count');
    expect(result.params).toEqual({ set_name: 'Bob', inc_count: 1 });
  });
});

// ─── Full SQL Query Builders ─────────────────────────────────────────────────

describe('buildSelectSQL', () => {
  it('builds basic SELECT', () => {
    const result = buildSelectSQL('users', { role: 'admin' });
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "role" = $1');
    expect(result.values).toEqual(['admin']);
  });

  it('builds SELECT with sort and limit', () => {
    const result = buildSelectSQL('users', {}, { sort: { name: 1 }, limit: 50 });
    expect(result.sql).toBe('SELECT * FROM "users" ORDER BY "name" ASC LIMIT 50');
  });

  it('builds SELECT with skip', () => {
    const result = buildSelectSQL('users', {}, { limit: 10, skip: 20 });
    expect(result.sql).toBe('SELECT * FROM "users" LIMIT 10 OFFSET 20');
  });
});

describe('buildInsertSQL', () => {
  it('builds INSERT statement', () => {
    const result = buildInsertSQL('users', { name: 'Tim', age: 30 });
    expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
    expect(result.values).toEqual(['Tim', 30]);
  });
});

describe('buildBatchInsertSQL', () => {
  it('builds batch INSERT', () => {
    const result = buildBatchInsertSQL('users', [
      { name: 'Tim', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
    expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2), ($3, $4)');
    expect(result.values).toEqual(['Tim', 30, 'Bob', 25]);
  });
});

describe('buildUpdateSQL', () => {
  it('builds UPDATE statement', () => {
    const result = buildUpdateSQL('users', { id: 1 }, { $set: { name: 'Bob' } });
    expect(result.sql).toBe('UPDATE "users" SET "name" = $1 WHERE "id" = $2');
    expect(result.values).toEqual(['Bob', 1]);
  });
});

describe('buildDeleteSQL', () => {
  it('builds DELETE statement', () => {
    const result = buildDeleteSQL('users', { id: 1 });
    expect(result.sql).toBe('DELETE FROM "users" WHERE "id" = $1');
    expect(result.values).toEqual([1]);
  });
});

describe('buildCountSQL', () => {
  it('builds COUNT query', () => {
    const result = buildCountSQL('users', { role: 'admin' });
    expect(result.sql).toBe('SELECT COUNT(*) as count FROM "users" WHERE "role" = $1');
    expect(result.values).toEqual(['admin']);
  });

  it('builds COUNT without filter', () => {
    const result = buildCountSQL('users', {});
    expect(result.sql).toBe('SELECT COUNT(*) as count FROM "users"');
    expect(result.values).toEqual([]);
  });
});

// ─── MSSQL SELECT Syntax ──────────────────────────────────────────────────────

describe('buildSelectSQL — MSSQL dialect', () => {
  it('uses TOP(n) for limit only', () => {
    const result = buildSelectSQL('users', { role: 'admin' }, { limit: 10, dialect: 'mssql' });
    expect(result.sql).toBe('SELECT TOP(10) * FROM "users" WHERE "role" = @p1');
    expect(result.values).toEqual(['admin']);
  });

  it('uses OFFSET FETCH for skip + limit', () => {
    const result = buildSelectSQL('users', {}, { skip: 20, limit: 10, dialect: 'mssql' });
    expect(result.sql).toBe('SELECT * FROM "users" ORDER BY (SELECT NULL) OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY');
  });

  it('uses OFFSET ROWS for skip only', () => {
    const result = buildSelectSQL('users', {}, { skip: 20, dialect: 'mssql' });
    expect(result.sql).toBe('SELECT * FROM "users" ORDER BY (SELECT NULL) OFFSET 20 ROWS');
  });

  it('uses provided sort with OFFSET FETCH', () => {
    const result = buildSelectSQL('users', {}, { sort: { name: 1 }, skip: 5, limit: 10, dialect: 'mssql' });
    expect(result.sql).toBe('SELECT * FROM "users" ORDER BY "name" ASC OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY');
  });

  it('builds plain SELECT without pagination', () => {
    const result = buildSelectSQL('users', { active: true }, { dialect: 'mssql' });
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "active" = @p1');
  });

  it('TOP(n) with sort', () => {
    const result = buildSelectSQL('users', {}, { limit: 1, sort: { id: -1 }, dialect: 'mssql' });
    expect(result.sql).toBe('SELECT TOP(1) * FROM "users" ORDER BY "id" DESC');
  });
});

// ─── Projection Exclusion ───────────────────────────────────────────────────

describe('getExcludedFields', () => {
  it('returns field names for exclusion-only projections', () => {
    expect(getExcludedFields({ password: 0, secret: 0 })).toEqual(['password', 'secret']);
  });

  it('returns null for inclusion projections', () => {
    expect(getExcludedFields({ name: 1, email: 1 })).toBeNull();
  });

  it('returns null for mixed projections', () => {
    expect(getExcludedFields({ name: 1, password: 0 })).toBeNull();
  });

  it('returns null for empty projection', () => {
    expect(getExcludedFields({})).toBeNull();
  });
});
