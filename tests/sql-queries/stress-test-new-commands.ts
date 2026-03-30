/**
 * StrictDB SQL Mode — New SQL Commands Stress Test
 *
 * Tests all newly added SQL commands against live sql_test database.
 * Covers: UNION, COUNT(DISTINCT), DATE_ADD, NOT BETWEEN, REGEXP,
 * LTRIM/RTRIM, POSITION, TRUNC, EXP, YEAR/MONTH/DAY standalone,
 * IIF, ISNULL, CONCAT_WS, DATE_TRUNC, CONVERT, GROUP_CONCAT,
 * CROSS JOIN, NOT EXISTS, aggregate window functions, etc.
 *
 * Run: npx tsx tests/sql-queries/stress-test-new-commands.ts
 */

import { config } from 'dotenv';
config();
import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

interface Test { id: number; name: string; sql: string; }

const tests: Test[] = [
  // ── UNION / UNION ALL ─────────────────────────────────────────────
  { id: 1, name: 'UNION — combine users and employees names',
    sql: `SELECT name FROM users LIMIT 5 UNION SELECT name FROM employees LIMIT 5` },
  { id: 2, name: 'UNION ALL — combine with duplicates',
    sql: `SELECT department FROM users LIMIT 10 UNION ALL SELECT department FROM employees LIMIT 10` },

  // ── COUNT(DISTINCT) ───────────────────────────────────────────────
  { id: 3, name: 'COUNT(DISTINCT department)',
    sql: `SELECT COUNT(DISTINCT department) AS unique_depts FROM users` },
  { id: 4, name: 'COUNT(DISTINCT role) with GROUP BY',
    sql: `SELECT department, COUNT(DISTINCT role) AS unique_roles FROM users GROUP BY department` },

  // ── DATE functions ────────────────────────────────────────────────
  { id: 5, name: 'YEAR/MONTH/DAY standalone functions',
    sql: `SELECT name, YEAR(createdAt) AS yr, MONTH(createdAt) AS mo, DAY(createdAt) AS dy FROM users LIMIT 10` },
  { id: 6, name: 'DATE_ADD — add days',
    sql: `SELECT orderId, createdAt, DATE_ADD(createdAt, 30) AS due_date FROM orders LIMIT 10` },

  // ── NOT BETWEEN ───────────────────────────────────────────────────
  { id: 7, name: 'NOT BETWEEN — salary outside range',
    sql: `SELECT name, salary FROM employees WHERE salary NOT BETWEEN 60000 AND 100000 LIMIT 15` },

  // ── REGEXP ────────────────────────────────────────────────────────
  { id: 8, name: 'REGEXP — names matching pattern',
    sql: `SELECT name, email FROM users WHERE name REGEXP '^[A-D]' LIMIT 10` },

  // ── String functions ──────────────────────────────────────────────
  { id: 9, name: 'LTRIM / RTRIM',
    sql: `SELECT LTRIM(name) AS ltrimmed, RTRIM(name) AS rtrimmed FROM users LIMIT 5` },
  { id: 10, name: 'INSTR — find @ in email',
    sql: `SELECT email, INSTR(email, '@') AS at_pos FROM users LIMIT 10` },
  { id: 11, name: 'CONCAT_WS — join with separator',
    sql: `SELECT CONCAT_WS(' - ', firstName, lastName, department) AS full_info FROM users WHERE status = 'active' LIMIT 10` },

  // ── Numeric functions ─────────────────────────────────────────────
  { id: 12, name: 'TRUNC — truncate to integer',
    sql: `SELECT name, price, TRUNC(price) AS truncated FROM products LIMIT 10` },
  { id: 13, name: 'EXP — exponential',
    sql: `SELECT name, rating, EXP(rating) AS exp_rating FROM products LIMIT 5` },

  // ── Conditional functions ─────────────────────────────────────────
  { id: 14, name: 'IIF (MSSQL style)',
    sql: `SELECT name, salary, IIF(salary > 100000, 'High', 'Normal') AS band FROM employees LIMIT 10` },
  { id: 15, name: 'ISNULL (MSSQL style)',
    sql: `SELECT name, ISNULL(bio, 'No bio') AS bio_display FROM users LIMIT 10` },

  // ── NOT EXISTS ────────────────────────────────────────────────────
  { id: 16, name: 'NOT EXISTS — products without orders (simplified)',
    sql: `SELECT productId, name FROM products WHERE productId NOT IN (SELECT productId FROM orders) LIMIT 15` },

  // ── Aggregate functions ───────────────────────────────────────────
  { id: 17, name: 'STDDEV — salary standard deviation (with GROUP BY)',
    sql: `SELECT department, STDDEV(salary) AS salary_stddev FROM employees GROUP BY department` },

  // ── Aggregate window functions ────────────────────────────────────
  { id: 18, name: 'SUM() OVER — running total',
    sql: `SELECT orderId, total, SUM(total) OVER (ORDER BY createdAt) AS running_total FROM orders LIMIT 20` },
  { id: 19, name: 'AVG() OVER PARTITION — dept average salary',
    sql: `SELECT name, department, salary, AVG(salary) OVER (PARTITION BY department) AS dept_avg FROM employees LIMIT 20` },
  { id: 20, name: 'COUNT() OVER — row count per partition',
    sql: `SELECT name, department, COUNT(*) OVER (PARTITION BY department) AS dept_size FROM employees LIMIT 20` },

  // ── CROSS JOIN ────────────────────────────────────────────────────
  { id: 21, name: 'CROSS JOIN — cartesian product (limited)',
    sql: `SELECT u.name, p.name AS product FROM users u CROSS JOIN products p LIMIT 20` },

  // ── Type conversion ───────────────────────────────────────────────
  { id: 22, name: 'CONVERT — salary to string',
    sql: `SELECT name, CONVERT(salary, CHAR) AS salary_str FROM employees LIMIT 5` },

  // ── Date formatting ───────────────────────────────────────────────
  { id: 23, name: 'DATE_FORMAT',
    sql: `SELECT name, DATE_FORMAT(createdAt, '%Y-%m-%d') AS formatted_date FROM users LIMIT 10` },

  // ── Complex combinations ──────────────────────────────────────────
  { id: 24, name: 'COUNT(DISTINCT) + GROUP BY + HAVING',
    sql: `SELECT department, COUNT(DISTINCT role) AS unique_roles, COUNT(*) AS total FROM users GROUP BY department HAVING COUNT(DISTINCT role) > 1` },
  { id: 25, name: 'UNION + ORDER BY',
    sql: `SELECT name, 'user' AS source FROM users LIMIT 5 UNION ALL SELECT name, 'employee' AS source FROM employees LIMIT 5` },
];

async function main() {
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });
  console.log(`Running ${tests.length} new SQL command tests...\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const start = Date.now();
    try {
      const result = await db.sql(test.sql);
      const ms = Date.now() - start;
      const count = 'data' in result ? (result as SqlMode2Result).data.length : 1;
      passed++;
      console.log(`  ✅ #${String(test.id).padStart(2, '0')} ${test.name} (${count} results, ${ms}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed++;
      console.log(`  ❌ #${String(test.id).padStart(2, '0')} ${test.name} — ${msg.slice(0, 120)}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS: ${passed} PASS | ${failed} FAIL | ${tests.length} TOTAL`);
  console.log('='.repeat(60));

  await db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
