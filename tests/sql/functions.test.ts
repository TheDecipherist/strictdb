import { describe, it, expect } from 'vitest';
import { translateFunction } from '../../src/sql/translators/functions.js';

/**
 * SQL Mode 2 — SQL Function Translation Tests
 *
 * Tests translateFunction() directly with mock AST nodes.
 * No parser, no planner, no database connections.
 */

// Helper to build a column_ref AST node
function colRef(column: string): Record<string, unknown> {
  return { type: 'column_ref', table: null, column };
}

// Helper to build a single-arg function AST node
function fnNode(name: string, argExpr: Record<string, unknown>): Record<string, unknown> {
  return { type: 'function', name, args: { expr: argExpr } };
}

// Helper to build a multi-arg function (expr_list)
function fnNodeMulti(name: string, args: Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: 'function',
    name,
    args: { expr: { type: 'expr_list', value: args } },
  };
}

// Helper to build a number literal node
function numNode(value: number): Record<string, unknown> {
  return { type: 'number', value };
}

// Helper to build a string literal node
function strNode(value: string): Record<string, unknown> {
  return { type: 'single_quote_string', value };
}

describe('SQL Mode 2 — Functions', () => {
  describe('string functions', () => {
    it('should translate UPPER(name) to { $toUpper: "$name" }', () => {
      const expr = fnNode('UPPER', colRef('name'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $toUpper: '$name' });
    });

    it('should translate LOWER(name) to { $toLower: "$name" }', () => {
      const expr = fnNode('LOWER', colRef('name'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $toLower: '$name' });
    });

    it('should translate TRIM(name) to { $trim: { input: "$name" } }', () => {
      const expr = fnNode('TRIM', colRef('name'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $trim: { input: '$name' } });
    });

    it('should translate CONCAT(first_name, last_name) to { $concat: [...] }', () => {
      const expr = fnNodeMulti('CONCAT', [colRef('first_name'), colRef('last_name')]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$concat');
      const concatArr = result['$concat'] as unknown[];
      expect(Array.isArray(concatArr)).toBe(true);
      expect(concatArr).toContain('$first_name');
      expect(concatArr).toContain('$last_name');
    });

    it('should translate LENGTH(name) to { $strLenCP: "$name" }', () => {
      const expr = fnNode('LENGTH', colRef('name'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $strLenCP: '$name' });
    });

    it('should translate CHAR_LENGTH(name) to { $strLenCP: "$name" }', () => {
      const expr = fnNode('CHAR_LENGTH', colRef('name'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $strLenCP: '$name' });
    });

    it('should translate SUBSTRING(name, 1, 3) to { $substrCP: ["$name", 0, 3] }', () => {
      const expr = fnNodeMulti('SUBSTRING', [colRef('name'), numNode(1), numNode(3)]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$substrCP');
      const substrArr = result['$substrCP'] as unknown[];
      expect(substrArr[0]).toBe('$name');
      // 1-based index is converted to 0-based: 1-1 = 0
      expect(substrArr[1]).toBe(0);
      expect(substrArr[2]).toBe(3);
    });
  });

  describe('numeric functions', () => {
    it('should translate ROUND(price, 2) to { $round: ["$price", 2] }', () => {
      const expr = fnNodeMulti('ROUND', [colRef('price'), numNode(2)]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$round');
      const roundArr = result['$round'] as unknown[];
      expect(roundArr[0]).toBe('$price');
      expect(roundArr[1]).toBe(2);
    });

    it('should translate ABS(value) to { $abs: "$value" }', () => {
      const expr = fnNode('ABS', colRef('value'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $abs: '$value' });
    });

    it('should translate CEIL(value) to { $ceil: "$value" }', () => {
      const expr = fnNode('CEIL', colRef('value'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $ceil: '$value' });
    });

    it('should translate FLOOR(value) to { $floor: "$value" }', () => {
      const expr = fnNode('FLOOR', colRef('value'));
      const result = translateFunction(expr);
      expect(result).toEqual({ $floor: '$value' });
    });
  });

  describe('date functions', () => {
    it('should translate NOW() to "$$NOW"', () => {
      const expr: Record<string, unknown> = { type: 'function', name: 'NOW', args: { expr: null } };
      const result = translateFunction(expr);
      expect(result).toBe('$$NOW');
    });

    it('should translate CURRENT_TIMESTAMP to "$$NOW"', () => {
      const expr: Record<string, unknown> = { type: 'function', name: 'CURRENT_TIMESTAMP', args: { expr: null } };
      const result = translateFunction(expr);
      expect(result).toBe('$$NOW');
    });

    it('should translate EXTRACT(YEAR FROM created_at) to { $year: "$created_at" }', () => {
      const expr: Record<string, unknown> = {
        type: 'function',
        name: 'EXTRACT',
        args: {
          field: 'year',
          source: { type: 'column_ref', column: 'created_at' },
        },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$year');
      expect(result['$year']).toBe('$created_at');
    });

    it('should translate DATEDIFF to { $dateDiff: {...} }', () => {
      const expr = fnNodeMulti('DATEDIFF', [
        colRef('end_date'),
        colRef('start_date'),
        strNode('day'),
      ]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$dateDiff');
    });
  });

  describe('conditional functions', () => {
    it('should translate simple CASE WHEN ... to { $cond: {...} }', () => {
      const expr: Record<string, unknown> = {
        type: 'case',
        when: [
          {
            cond: {
              type: 'binary_expr',
              operator: '=',
              left: { type: 'column_ref', column: 'status' },
              right: { type: 'single_quote_string', value: 'active' },
            },
            result: { type: 'number', value: 1 },
          },
        ],
        else: { type: 'number', value: 0 },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$cond');
      const cond = result['$cond'] as Record<string, unknown>;
      expect(cond).toHaveProperty('if');
      expect(cond).toHaveProperty('then');
      expect(cond).toHaveProperty('else');
    });

    it('should translate multi-branch CASE WHEN to { $switch: { branches: [...] } }', () => {
      const expr: Record<string, unknown> = {
        type: 'case',
        when: [
          {
            cond: {
              type: 'binary_expr',
              operator: '=',
              left: { type: 'column_ref', column: 'tier' },
              right: { type: 'single_quote_string', value: 'gold' },
            },
            result: { type: 'number', value: 3 },
          },
          {
            cond: {
              type: 'binary_expr',
              operator: '=',
              left: { type: 'column_ref', column: 'tier' },
              right: { type: 'single_quote_string', value: 'silver' },
            },
            result: { type: 'number', value: 2 },
          },
        ],
        else: { type: 'number', value: 1 },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$switch');
      const sw = result['$switch'] as Record<string, unknown>;
      expect(Array.isArray(sw['branches'])).toBe(true);
      expect((sw['branches'] as unknown[]).length).toBe(2);
    });

    it('should translate COALESCE(a, b) to { $ifNull: ["$a", "$b"] }', () => {
      const expr = fnNodeMulti('COALESCE', [colRef('nickname'), colRef('full_name')]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$ifNull');
      const ifNull = result['$ifNull'] as unknown[];
      expect(ifNull[0]).toBe('$nickname');
      expect(ifNull[1]).toBe('$full_name');
    });

    it('should translate NULLIF(a, b) to { $cond: { if: { $eq: [...] }, then: null, else: "$a" } }', () => {
      const expr = fnNodeMulti('NULLIF', [colRef('score'), numNode(0)]);
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$cond');
      const cond = result['$cond'] as Record<string, unknown>;
      expect(cond['then']).toBeNull();
      const ifClause = cond['if'] as Record<string, unknown>;
      expect(ifClause).toHaveProperty('$eq');
    });
  });

  describe('CAST', () => {
    it('should translate CAST(field AS INTEGER) to { $convert: { input: "$field", to: "int" } }', () => {
      const expr: Record<string, unknown> = {
        type: 'cast',
        expr: { type: 'column_ref', column: 'field' },
        target: { dataType: 'INTEGER' },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$convert');
      const convert = result['$convert'] as Record<string, unknown>;
      expect(convert['input']).toBe('$field');
      expect(convert['to']).toBe('int');
    });

    it('should translate CAST(field AS VARCHAR) to { $convert: { input: "$field", to: "string" } }', () => {
      const expr: Record<string, unknown> = {
        type: 'cast',
        expr: { type: 'column_ref', column: 'age' },
        target: { dataType: 'VARCHAR' },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      expect(result).toHaveProperty('$convert');
      const convert = result['$convert'] as Record<string, unknown>;
      expect(convert['to']).toBe('string');
    });

    it('should translate CAST(field AS BOOLEAN) to { $convert: { input: ..., to: "bool" } }', () => {
      const expr: Record<string, unknown> = {
        type: 'cast',
        expr: { type: 'column_ref', column: 'is_active' },
        target: { dataType: 'BOOLEAN' },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      const convert = result['$convert'] as Record<string, unknown>;
      expect(convert['to']).toBe('bool');
    });

    it('should translate CAST(field AS DATE) to { $convert: { input: ..., to: "date" } }', () => {
      const expr: Record<string, unknown> = {
        type: 'cast',
        expr: { type: 'column_ref', column: 'ts' },
        target: { dataType: 'DATE' },
      };
      const result = translateFunction(expr) as Record<string, unknown>;
      const convert = result['$convert'] as Record<string, unknown>;
      expect(convert['to']).toBe('date');
    });
  });

  describe('column_ref passthrough', () => {
    it('should return "$fieldName" for a column_ref node', () => {
      const expr = colRef('username');
      const result = translateFunction(expr);
      expect(result).toBe('$username');
    });
  });

  describe('literal passthrough', () => {
    it('should return the value for a number literal node', () => {
      const expr = numNode(42);
      const result = translateFunction(expr);
      expect(result).toBe(42);
    });

    it('should return the value for a string literal node', () => {
      const expr = strNode('hello');
      const result = translateFunction(expr);
      expect(result).toBe('hello');
    });
  });
});
