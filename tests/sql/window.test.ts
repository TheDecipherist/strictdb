import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';

/**
 * SQL Mode 2 — Window Function Tests
 *
 * Verifies: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD → $setWindowFields.
 * NOTE: Window queries still require LIMIT to pass guardrails.
 * We parse the query and verify the $setWindowFields stage is present.
 */

describe('SQL Mode 2 — Window Functions', () => {
  describe('ROW_NUMBER', () => {
    it('should translate ROW_NUMBER() OVER (ORDER BY salary DESC) to $setWindowFields with $documentNumber', () => {
      const sql = 'SELECT ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('select');
      expect(plan.collection).toBe('employees');

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      expect(swf).toBeDefined();

      const output = swf['output'] as Record<string, unknown>;
      expect(output).toBeDefined();

      // The alias 'rn' should map to $documentNumber
      const rnField = output['rn'] as Record<string, unknown>;
      expect(rnField).toBeDefined();
      expect(rnField).toHaveProperty('$documentNumber');

      // sortBy should have salary: -1
      const sortBy = swf['sortBy'] as Record<string, unknown>;
      expect(sortBy).toBeDefined();
      expect(sortBy['salary']).toBe(-1);
    });

    it('should include PARTITION BY as partitionBy field in $setWindowFields', () => {
      const sql = 'SELECT ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      expect(swf['partitionBy']).toBe('$dept');
    });
  });

  describe('RANK / DENSE_RANK', () => {
    it('should translate RANK() OVER (...) to $setWindowFields with $rank', () => {
      const sql = 'SELECT RANK() OVER (ORDER BY score DESC) AS rnk FROM players LIMIT 50';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;

      const rnkField = output['rnk'] as Record<string, unknown>;
      expect(rnkField).toBeDefined();
      expect(rnkField).toHaveProperty('$rank');
    });

    it('should translate DENSE_RANK() OVER (...) to $setWindowFields with $denseRank', () => {
      const sql = 'SELECT DENSE_RANK() OVER (ORDER BY score DESC) AS dr FROM players LIMIT 50';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;

      const drField = output['dr'] as Record<string, unknown>;
      expect(drField).toBeDefined();
      expect(drField).toHaveProperty('$denseRank');
    });
  });

  describe('LAG / LEAD', () => {
    it('should translate LAG(salary, 1) OVER (ORDER BY hire_date) to $setWindowFields with $shift by: -1', () => {
      const sql = 'SELECT LAG(salary, 1) OVER (ORDER BY hire_date) AS prev_salary FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;

      const lagField = output['prev_salary'] as Record<string, unknown>;
      expect(lagField).toBeDefined();

      const shift = lagField['$shift'] as Record<string, unknown>;
      expect(shift).toBeDefined();
      expect(shift['by']).toBeLessThan(0); // LAG is a negative shift
    });

    it('should translate LEAD(salary, 1) OVER (ORDER BY hire_date) to $setWindowFields with $shift by: 1', () => {
      const sql = 'SELECT LEAD(salary, 1) OVER (ORDER BY hire_date) AS next_salary FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;

      const leadField = output['next_salary'] as Record<string, unknown>;
      expect(leadField).toBeDefined();

      const shift = leadField['$shift'] as Record<string, unknown>;
      expect(shift).toBeDefined();
      expect(shift['by']).toBeGreaterThan(0); // LEAD is a positive shift
    });
  });

  describe('aggregate window functions (SUM/AVG/COUNT/MIN/MAX OVER)', () => {
    it('should translate SUM(salary) OVER (PARTITION BY dept) to $setWindowFields with $sum', () => {
      const sql = 'SELECT SUM(salary) OVER (PARTITION BY dept ORDER BY name) AS dept_total FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      // Should NOT be treated as a regular aggregate (no $group stage)
      expect(plan.isAggregate).toBe(false);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;
      const field = output['dept_total'] as Record<string, unknown>;
      expect(field).toBeDefined();
      expect(field['$sum']).toBe('$salary');
      expect(field['window']).toEqual({ documents: ['unbounded', 'unbounded'] });
    });

    it('should translate AVG(score) OVER (PARTITION BY class) to $setWindowFields with $avg', () => {
      const sql = 'SELECT AVG(score) OVER (PARTITION BY class ORDER BY name) AS class_avg FROM students LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.isAggregate).toBe(false);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;
      const field = output['class_avg'] as Record<string, unknown>;
      expect(field).toBeDefined();
      expect(field['$avg']).toBe('$score');
    });

    it('should translate COUNT(*) OVER (PARTITION BY dept) to $setWindowFields with $sum: 1', () => {
      const sql = 'SELECT COUNT(*) OVER (PARTITION BY dept ORDER BY name) AS dept_count FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.isAggregate).toBe(false);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;
      const field = output['dept_count'] as Record<string, unknown>;
      expect(field).toBeDefined();
      expect(field['$sum']).toBe(1);
    });

    it('should translate MIN(price) OVER (...) to $setWindowFields with $min', () => {
      const sql = 'SELECT MIN(price) OVER (PARTITION BY category ORDER BY name) AS cat_min FROM products LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;
      const field = output['cat_min'] as Record<string, unknown>;
      expect(field['$min']).toBe('$price');
    });

    it('should translate MAX(score) OVER (...) to $setWindowFields with $max', () => {
      const sql = 'SELECT MAX(score) OVER (PARTITION BY class ORDER BY name) AS max_score FROM students LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;
      const output = swf['output'] as Record<string, unknown>;
      const field = output['max_score'] as Record<string, unknown>;
      expect(field['$max']).toBe('$score');
    });
  });

  describe('window with PARTITION BY and ORDER BY', () => {
    it('should include both partitionBy and sortBy in $setWindowFields', () => {
      const sql = 'SELECT RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS dept_rank FROM employees LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const windowStage = plan.pipelines[0]?.stages.find(s => '$setWindowFields' in s);
      expect(windowStage).toBeDefined();

      const swf = (windowStage as Record<string, unknown>)['$setWindowFields'] as Record<string, unknown>;

      // Must have partitionBy
      expect(swf['partitionBy']).toBeDefined();
      expect(swf['partitionBy']).toBe('$dept');

      // Must have sortBy
      const sortBy = swf['sortBy'] as Record<string, unknown>;
      expect(sortBy).toBeDefined();
      expect(sortBy['salary']).toBe(-1);
    });

    it('should produce a pipeline with $setWindowFields stage among the stages', () => {
      const sql = 'SELECT ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn FROM orders LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.pipelines[0]?.stages.length).toBeGreaterThan(0);

      const stageTypes = plan.pipelines[0]?.stages.map(s => Object.keys(s)[0]);
      expect(stageTypes).toContain('$setWindowFields');
    });
  });
});
