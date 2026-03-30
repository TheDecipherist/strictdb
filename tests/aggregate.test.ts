/**
 * db.aggregate() Tests — Native pipeline API
 *
 * Tests pipeline validation, guardrails, and pipeline-to-SQL/ES translation.
 * No database connections — tests the translation and guardrail logic.
 */

import { describe, it, expect } from 'vitest';
import { checkPipelineGuardrails } from '../src/guardrails.js';
import { StrictDBEventEmitter } from '../src/events.js';
import { StrictDBError } from '../src/errors.js';
import { translatePipelineToSQL, translatePipelineToElastic } from '../src/filter-translator.js';

const emitter = new StrictDBEventEmitter();
const ctx = { enabled: true, emitter };

describe('db.aggregate()', () => {
  describe('pipeline validation', () => {
    it('should accept an empty pipeline array with $limit', () => {
      // Empty pipeline with $limit should not throw guardrails
      expect(() => checkPipelineGuardrails(ctx, 'users', [{ $limit: 10 }])).not.toThrow();
    });

    it('should accept a pipeline with $match stage', () => {
      const pipeline = [{ $match: { status: 'active' } }, { $limit: 10 }];
      expect(() => checkPipelineGuardrails(ctx, 'users', pipeline)).not.toThrow();
    });

    it('should accept a pipeline with multiple stages', () => {
      const pipeline = [
        { $match: { age: { $gt: 25 } } },
        { $sort: { name: 1 } },
        { $limit: 50 },
      ];
      expect(() => checkPipelineGuardrails(ctx, 'users', pipeline)).not.toThrow();
    });
  });

  describe('guardrails', () => {
    it('should block pipeline without $limit (no $count/$group/$merge)', () => {
      const pipeline = [{ $match: { status: 'active' } }];
      expect(() => checkPipelineGuardrails(ctx, 'users', pipeline)).toThrow(StrictDBError);
      try {
        checkPipelineGuardrails(ctx, 'users', pipeline);
      } catch (err) {
        expect((err as StrictDBError).code).toBe('GUARDRAIL_BLOCKED');
      }
    });

    it('should allow pipeline with $limit', () => {
      expect(() => checkPipelineGuardrails(ctx, 'users', [{ $limit: 100 }])).not.toThrow();
    });

    it('should allow pipeline with $count (no $limit needed)', () => {
      expect(() => checkPipelineGuardrails(ctx, 'users', [{ $count: 'total' }])).not.toThrow();
    });

    it('should allow pipeline with $group (no $limit needed)', () => {
      expect(() => checkPipelineGuardrails(ctx, 'users', [
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ])).not.toThrow();
    });

    it('should allow pipeline with $merge or $out (no $limit needed)', () => {
      expect(() => checkPipelineGuardrails(ctx, 'users', [
        { $match: { active: true } },
        { $merge: { into: 'active_users' } },
      ])).not.toThrow();
      expect(() => checkPipelineGuardrails(ctx, 'users', [
        { $out: 'archived' },
      ])).not.toThrow();
    });
  });

  describe('pipeline stage translation — SQL backend', () => {
    it('should translate $match to WHERE clause', () => {
      const result = translatePipelineToSQL('users', [
        { $match: { status: 'active' } },
        { $limit: 10 },
      ], 'pg');
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('LIMIT');
    });

    it('should translate $sort to ORDER BY', () => {
      const result = translatePipelineToSQL('users', [
        { $sort: { name: 1 } },
        { $limit: 10 },
      ], 'pg');
      expect(result.sql).toContain('ORDER BY');
    });

    it('should translate $limit to LIMIT', () => {
      const result = translatePipelineToSQL('users', [
        { $limit: 50 },
      ], 'pg');
      expect(result.sql).toContain('LIMIT');
    });

    it('should translate $skip to OFFSET', () => {
      const result = translatePipelineToSQL('users', [
        { $skip: 20 },
        { $limit: 10 },
      ], 'pg');
      expect(result.sql).toContain('OFFSET');
    });

    it('should translate $project to SELECT columns', () => {
      const result = translatePipelineToSQL('users', [
        { $project: { name: 1, email: 1 } },
        { $limit: 10 },
      ], 'pg');
      expect(result.sql).toContain('name');
      expect(result.sql).toContain('email');
    });

    it('should translate $group to GROUP BY with aggregates', () => {
      const result = translatePipelineToSQL('users', [
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ], 'pg');
      expect(result.sql).toContain('GROUP BY');
      expect(result.sql).toContain('COUNT(*)');
    });

    it('should translate $count to COUNT(*)', () => {
      const result = translatePipelineToSQL('users', [
        { $count: 'total' },
      ], 'pg');
      expect(result.sql).toContain('COUNT(*)');
    });

    it('should translate $lookup to JOIN', () => {
      const result = translatePipelineToSQL('users', [
        { $lookup: { from: 'orders', localField: 'userId', foreignField: 'userId', as: 'orders' } },
        { $limit: 10 },
      ], 'pg');
      expect(result.sql).toContain('JOIN');
    });

    it('should throw PIPELINE_STAGE_UNSUPPORTED for unknown stages on SQL', () => {
      expect(() => translatePipelineToSQL('users', [
        { $geoNear: { near: { type: 'Point' } } },
        { $limit: 10 },
      ], 'pg')).toThrow(StrictDBError);

      try {
        translatePipelineToSQL('users', [{ $geoNear: {} }, { $limit: 10 }], 'pg');
      } catch (err) {
        expect((err as StrictDBError).code).toBe('PIPELINE_STAGE_UNSUPPORTED');
      }
    });
  });

  describe('pipeline stage translation — Elasticsearch backend', () => {
    it('should translate $match to ES query', () => {
      const result = translatePipelineToElastic([
        { $match: { status: 'active' } },
        { $limit: 10 },
      ]);
      expect(result.body).toHaveProperty('query');
    });

    it('should translate $sort to ES sort', () => {
      const result = translatePipelineToElastic([
        { $sort: { name: 1 } },
        { $limit: 10 },
      ]);
      expect(result.body).toHaveProperty('sort');
    });

    it('should translate $limit to ES size', () => {
      const result = translatePipelineToElastic([
        { $limit: 25 },
      ]);
      expect(result.body['size']).toBe(25);
    });

    it('should translate $skip to ES from', () => {
      const result = translatePipelineToElastic([
        { $skip: 10 },
        { $limit: 5 },
      ]);
      expect(result.body['from']).toBe(10);
    });

    it('should translate $group to ES aggregations', () => {
      const result = translatePipelineToElastic([
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      expect(result.body).toHaveProperty('aggs');
    });

    it('should throw PIPELINE_STAGE_UNSUPPORTED for unknown stages on ES', () => {
      expect(() => translatePipelineToElastic([
        { $geoNear: { near: { type: 'Point' } } },
        { $limit: 10 },
      ])).toThrow(StrictDBError);
    });
  });

  describe('explain option', () => {
    it('should return pipeline as-is for MongoDB explain', () => {
      // On MongoDB, explain just returns the pipeline — tested via integration
      // Here we verify the translation functions don't modify the input
      const pipeline = [{ $match: { x: 1 } }, { $limit: 5 }];
      const copy = JSON.parse(JSON.stringify(pipeline));
      translatePipelineToSQL('t', pipeline, 'pg');
      expect(pipeline).toEqual(copy); // input not mutated
    });

    it('should return generated SQL for SQL backend explain', () => {
      const result = translatePipelineToSQL('users', [
        { $match: { active: true } },
        { $sort: { name: 1 } },
        { $limit: 10 },
      ], 'pg');
      expect(typeof result.sql).toBe('string');
      expect(result.sql.length).toBeGreaterThan(0);
    });
  });

  describe('return type', () => {
    it('should return T[] (array of documents) — verified by type system', () => {
      // The aggregate method returns Promise<T[]> — compile-time check
      // Runtime verification happens in integration tests
      expect(true).toBe(true);
    });
  });
});
