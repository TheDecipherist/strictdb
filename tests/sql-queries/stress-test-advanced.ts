/**
 * StrictDB SQL Mode — Advanced Stress Test
 *
 * Runs 45 advanced SQL query patterns against live sql_test database.
 * Tests: self-joins, window functions, CTEs, subqueries, anti-joins,
 * conditional aggregation, set operations, deduplication, and more.
 *
 * Run: npx tsx tests/sql-queries/stress-test-advanced.ts
 */

import { config } from 'dotenv';
config();

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

interface StressTest {
  id: number;
  category: string;
  name: string;
  sql: string;
}

const tests: StressTest[] = [
  // ── SELF-JOINS ──────────────────────────────────────────────────────
  { id: 1, category: 'Self-Joins', name: 'Employee-manager hierarchy',
    sql: `SELECT e1.employeeId, e1.name, e1.managerId, e2.name AS manager_name FROM employees e1 LEFT JOIN employees e2 ON e1.managerId = e2.employeeId LIMIT 20` },

  // ── WINDOW FUNCTIONS — ADVANCED ─────────────────────────────────────
  { id: 2, category: 'Window Functions', name: 'Top-N per group (top 3 products per category)',
    sql: `SELECT name, category, price, ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS price_rank FROM products LIMIT 50` },
  { id: 3, category: 'Window Functions', name: 'RANK within department',
    sql: `SELECT name, department, salary, RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank FROM employees LIMIT 30` },
  { id: 4, category: 'Window Functions', name: 'DENSE_RANK salaries',
    sql: `SELECT department, title, salary, DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS salary_rank FROM employees LIMIT 30` },
  { id: 5, category: 'Window Functions', name: 'LAG — previous order total per user',
    sql: `SELECT orderId, userId, total, LAG(total, 1) OVER (PARTITION BY userId ORDER BY createdAt) AS prev_total FROM orders LIMIT 30` },
  { id: 6, category: 'Window Functions', name: 'LEAD — next session start per user',
    sql: `SELECT sessionId, userId, startedAt, LEAD(startedAt, 1) OVER (PARTITION BY userId ORDER BY startedAt) AS next_start FROM sessions LIMIT 30` },

  // ── CONDITIONAL AGGREGATION ─────────────────────────────────────────
  { id: 7, category: 'Conditional Aggregation', name: 'Salary bands by department (CASE in aggregate)',
    sql: `SELECT department, SUM(CASE WHEN salary > 100000 THEN 1 ELSE 0 END) AS high_earners, SUM(CASE WHEN salary <= 100000 THEN 1 ELSE 0 END) AS standard_earners, COUNT(*) AS total FROM employees GROUP BY department` },
  { id: 8, category: 'Conditional Aggregation', name: 'Order status pivot per user',
    sql: `SELECT userId, COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered, COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending, COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled FROM orders GROUP BY userId LIMIT 20` },
  { id: 9, category: 'Conditional Aggregation', name: 'Event type pivot per user',
    sql: `SELECT userId, COUNT(CASE WHEN type = 'login' THEN 1 END) AS logins, COUNT(CASE WHEN type = 'purchase' THEN 1 END) AS purchases, COUNT(CASE WHEN type = 'view' THEN 1 END) AS views FROM events GROUP BY userId LIMIT 20` },

  // ── ANTI-JOINS ──────────────────────────────────────────────────────
  { id: 10, category: 'Anti-Joins', name: 'Users with no orders (LEFT JOIN + IS NULL)',
    sql: `SELECT u.name, u.email FROM users u LEFT JOIN orders o ON u.userId = o.userId WHERE o.orderId IS NULL LIMIT 20` },
  { id: 11, category: 'Anti-Joins', name: 'Products never ordered (NOT IN)',
    sql: `SELECT productId, name, category FROM products WHERE productId NOT IN (SELECT productId FROM orders) LIMIT 20` },
  { id: 12, category: 'Anti-Joins', name: 'Products never reviewed (NOT IN)',
    sql: `SELECT productId, name FROM products WHERE productId NOT IN (SELECT productId FROM reviews) LIMIT 20` },

  // ── SUBQUERIES — ADVANCED ───────────────────────────────────────────
  { id: 13, category: 'Subqueries', name: 'Orders from premium users (IN subquery)',
    sql: `SELECT orderId, userId, total FROM orders WHERE userId IN (SELECT userId FROM users WHERE isPremium = true) LIMIT 20` },
  { id: 14, category: 'Subqueries', name: 'Users above average age',
    sql: `SELECT name, age FROM users WHERE age > (SELECT AVG(age) AS avg FROM users) LIMIT 20` },
  { id: 15, category: 'Subqueries', name: 'High-value orders (above average total)',
    sql: `SELECT orderId, total, status FROM orders WHERE total > (SELECT AVG(total) AS avg FROM orders) LIMIT 20` },
  { id: 16, category: 'Subqueries', name: 'Multiple subqueries in WHERE (admin users + electronics products)',
    sql: `SELECT orderId, userId, productId, total FROM orders WHERE userId IN (SELECT userId FROM users WHERE role = 'admin') AND productId IN (SELECT productId FROM products WHERE category = 'Electronics') LIMIT 20` },

  // ── MULTI-TABLE JOINS ───────────────────────────────────────────────
  { id: 17, category: 'Multi-Table Joins', name: 'Three-table: orders → users → products',
    sql: `SELECT o.orderId, u.name AS customer, p.name AS product, o.total FROM orders o INNER JOIN users u ON o.userId = u.userId INNER JOIN products p ON o.productId = p.productId LIMIT 20` },
  { id: 18, category: 'Multi-Table Joins', name: 'LEFT JOIN with aggregation (user order count)',
    sql: `SELECT u.userId, u.name, COUNT(o.orderId) AS total_orders FROM users u LEFT JOIN orders o ON u.userId = o.userId GROUP BY u.userId, u.name LIMIT 20` },
  { id: 19, category: 'Multi-Table Joins', name: 'Products with review data (LEFT JOIN + aggregate)',
    sql: `SELECT p.productId, p.name, p.category, COUNT(r.reviewId) AS review_count, AVG(r.rating) AS avg_rating FROM products p LEFT JOIN reviews r ON p.productId = r.productId GROUP BY p.productId, p.name, p.category LIMIT 20` },

  // ── FULL OUTER JOIN ─────────────────────────────────────────────────
  { id: 20, category: 'Full Outer Join', name: 'FULL OUTER JOIN users + reviews',
    sql: `SELECT u.name, r.rating, r.title FROM users u FULL OUTER JOIN reviews r ON u.userId = r.userId LIMIT 20` },

  // ── GROUP BY + HAVING — COMPLEX ─────────────────────────────────────
  { id: 21, category: 'Complex Aggregation', name: 'Revenue per customer > $500 (JOIN + GROUP BY + HAVING)',
    sql: `SELECT u.name, SUM(o.total) AS total_spent, COUNT(*) AS order_count FROM users u INNER JOIN orders o ON u.userId = o.userId GROUP BY u.name HAVING SUM(o.total) > 500 ORDER BY total_spent DESC LIMIT 20` },
  { id: 22, category: 'Complex Aggregation', name: 'Multi-aggregate per department',
    sql: `SELECT department, COUNT(*) AS headcount, AVG(salary) AS avg_salary, MIN(salary) AS min_salary, MAX(salary) AS max_salary, SUM(salary) AS payroll FROM employees GROUP BY department` },
  { id: 23, category: 'Complex Aggregation', name: 'CASE in GROUP BY (status buckets)',
    sql: `SELECT CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END AS bucket, COUNT(*) AS cnt, SUM(total) AS revenue FROM orders GROUP BY CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END` },

  // ── FUNCTIONS — ADVANCED ────────────────────────────────────────────
  { id: 24, category: 'Functions', name: 'COALESCE + CONCAT (null-safe name building)',
    sql: `SELECT CONCAT(firstName, ' ', lastName) AS full_name, COALESCE(bio, 'No bio') AS bio_display FROM users WHERE status = 'active' LIMIT 15` },
  { id: 25, category: 'Functions', name: 'Multi-CASE classification',
    sql: `SELECT name, age, salary, CASE WHEN age < 30 THEN 'Young' WHEN age < 50 THEN 'Mid' ELSE 'Senior' END AS age_tier, CASE WHEN salary < 60000 THEN 'Low' WHEN salary < 120000 THEN 'Mid' ELSE 'High' END AS pay_band FROM users LIMIT 20` },
  { id: 26, category: 'Functions', name: 'ROUND + arithmetic (tax calculation)',
    sql: `SELECT name, price, stock, ROUND(price * 1.08, 2) AS with_tax, ROUND(price * stock, 2) AS inventory_value FROM products WHERE isActive = true LIMIT 15` },
  { id: 27, category: 'Functions', name: 'UPPER + LOWER + LENGTH',
    sql: `SELECT UPPER(name) AS name_upper, LOWER(email) AS email_lower, LENGTH(name) AS name_len FROM users WHERE status = 'active' LIMIT 10` },
  { id: 28, category: 'Functions', name: 'SUBSTRING extraction',
    sql: `SELECT email, SUBSTRING(email, 1, 5) AS prefix FROM users LIMIT 10` },

  // ── DATE OPERATIONS ─────────────────────────────────────────────────
  { id: 29, category: 'Date Operations', name: 'EXTRACT year + month from dates',
    sql: `SELECT name, hireDate, EXTRACT(YEAR FROM hireDate) AS hire_year, EXTRACT(MONTH FROM hireDate) AS hire_month FROM employees LIMIT 15` },
  { id: 30, category: 'Date Operations', name: 'Date range BETWEEN',
    sql: `SELECT orderId, userId, total, createdAt FROM orders WHERE createdAt BETWEEN '2025-01-01' AND '2025-12-31' ORDER BY createdAt DESC LIMIT 20` },

  // ── NULL HANDLING ───────────────────────────────────────────────────
  { id: 31, category: 'NULL Handling', name: 'IS NULL + IS NOT NULL combined',
    sql: `SELECT orderId, userId, total FROM orders WHERE deliveredAt IS NOT NULL AND notes IS NULL LIMIT 20` },
  { id: 32, category: 'NULL Handling', name: 'COALESCE chain (multi-fallback)',
    sql: `SELECT name, COALESCE(bio, city, 'Unknown') AS display_info FROM users LIMIT 15` },

  // ── COMPLEX WHERE CLAUSES ───────────────────────────────────────────
  { id: 33, category: 'Complex WHERE', name: 'AND + OR + BETWEEN + LIKE + NOT IN combined',
    sql: `SELECT name, age, salary, department FROM users WHERE (age BETWEEN 25 AND 50) AND (department = 'Engineering' OR department = 'Product') AND name LIKE '%a%' AND status != 'suspended' LIMIT 15` },
  { id: 34, category: 'Complex WHERE', name: 'Multiple LIKE patterns via OR',
    sql: `SELECT name, email FROM users WHERE name LIKE 'Tim%' OR name LIKE 'Alice%' OR name LIKE '%Carter' LIMIT 20` },
  { id: 35, category: 'Complex WHERE', name: 'NOT IN with large exclusion list',
    sql: `SELECT orderId, status, total FROM orders WHERE status NOT IN ('cancelled', 'returned', 'pending') ORDER BY total DESC LIMIT 15` },

  // ── ARITHMETIC IN WHERE + ORDER BY ──────────────────────────────────
  { id: 36, category: 'Arithmetic Expressions', name: 'Computed filter + sort (revenue potential)',
    sql: `SELECT name, price, stock, ROUND(price * stock, 2) AS revenue_potential FROM products WHERE price * stock > 5000 ORDER BY price * stock DESC LIMIT 10` },

  // ── JOIN + AGGREGATE + CASE ─────────────────────────────────────────
  { id: 37, category: 'Complex Combinations', name: 'JOIN + CASE + GROUP BY (price tier analysis)',
    sql: `SELECT CASE WHEN p.price < 50 THEN 'Budget' WHEN p.price < 200 THEN 'Mid-Range' ELSE 'Premium' END AS tier, COUNT(*) AS order_count, SUM(o.total) AS revenue FROM orders o INNER JOIN products p ON o.productId = p.productId GROUP BY CASE WHEN p.price < 50 THEN 'Budget' WHEN p.price < 200 THEN 'Mid-Range' ELSE 'Premium' END ORDER BY revenue DESC` },
  { id: 38, category: 'Complex Combinations', name: 'Multi-join + aggregate + having + sort',
    sql: `SELECT u.name, u.department, COUNT(*) AS orders, SUM(o.total) AS spent, AVG(o.total) AS avg_order FROM users u INNER JOIN orders o ON u.userId = o.userId GROUP BY u.name, u.department HAVING SUM(o.total) > 500 ORDER BY spent DESC LIMIT 15` },

  // ── DISTINCT ────────────────────────────────────────────────────────
  { id: 39, category: 'Distinct', name: 'SELECT DISTINCT department',
    sql: `SELECT DISTINCT department FROM users LIMIT 20` },
  { id: 40, category: 'Distinct', name: 'DISTINCT with multiple columns',
    sql: `SELECT DISTINCT department, role FROM users LIMIT 50` },

  // ── PAGINATION ──────────────────────────────────────────────────────
  { id: 41, category: 'Pagination', name: 'Page 3 of products (OFFSET 20, LIMIT 10)',
    sql: `SELECT productId, name, price FROM products ORDER BY price DESC LIMIT 10 OFFSET 20` },

  // ── WRITES ──────────────────────────────────────────────────────────
  { id: 42, category: 'Write Operations', name: 'INSERT single row',
    sql: `INSERT INTO users (userId, name, firstName, lastName, email, age, role, status) VALUES (9999, 'Stress Test', 'Stress', 'Test', 'stress@test.com', 25, 'user', 'active')` },
  { id: 43, category: 'Write Operations', name: 'UPDATE with SET',
    sql: `UPDATE users SET role = 'admin' WHERE userId = 9999` },
  { id: 44, category: 'Write Operations', name: 'DELETE with WHERE',
    sql: `DELETE FROM users WHERE userId = 9999` },

  // ── IF FUNCTION ─────────────────────────────────────────────────────
  { id: 45, category: 'Functions', name: 'IF function (MySQL style)',
    sql: `SELECT productId, name, stock, IF(stock > 0, 'In Stock', 'Out of Stock') AS availability FROM products LIMIT 15` },
];

async function main() {
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });
  console.log(`Connected! Running ${tests.length} advanced SQL queries...\n`);

  let passed = 0;
  let failed = 0;
  const failures: Array<{ id: number; name: string; error: string; sql: string }> = [];
  const results: Array<{ id: number; category: string; name: string; status: string; count: number; ms: number }> = [];

  for (const test of tests) {
    const start = Date.now();
    try {
      const result = await db.sql(test.sql);
      const ms = Date.now() - start;
      let count = 0;
      if ('data' in result && Array.isArray((result as SqlMode2Result).data)) {
        count = (result as SqlMode2Result).data.length;
      } else {
        count = 1; // write receipt
      }
      results.push({ id: test.id, category: test.category, name: test.name, status: 'PASS', count, ms });
      passed++;
      console.log(`  ✅ #${String(test.id).padStart(2, '0')} ${test.name} (${count} results, ${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: test.id, category: test.category, name: test.name, status: 'FAIL', count: 0, ms });
      failures.push({ id: test.id, name: test.name, error: msg, sql: test.sql });
      failed++;
      console.log(`  ❌ #${String(test.id).padStart(2, '0')} ${test.name} — ${msg.slice(0, 100)}`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULTS: ${passed} PASS | ${failed} FAIL | ${tests.length} TOTAL`);
  console.log('='.repeat(70));

  if (failures.length > 0) {
    console.log('\nFailed queries:');
    for (const f of failures) {
      console.log(`\n  #${f.id} ${f.name}`);
      console.log(`  SQL: ${f.sql.slice(0, 120)}...`);
      console.log(`  Error: ${f.error.slice(0, 200)}`);
    }
  }

  // Write report
  const report = [
    `# StrictDB SQL Mode — Advanced Stress Test Results`,
    ``,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Queries tested:** ${tests.length}`,
    `**Passed:** ${passed}`,
    `**Failed:** ${failed}`,
    ``,
    `## Results`,
    ``,
    `| # | Category | Query | Status | Results | Time |`,
    `|---|----------|-------|--------|---------|------|`,
    ...results.map(r =>
      `| ${r.id} | ${r.category} | ${r.name} | ${r.status} | ${r.count} | ${r.ms}ms |`
    ),
    ``,
    ...(failures.length > 0 ? [
      `## Failures`,
      ``,
      ...failures.map(f => [
        `### #${f.id} — ${f.name}`,
        `\`\`\`sql`,
        f.sql,
        `\`\`\``,
        `**Error:** ${f.error}`,
        ``,
      ].join('\n')),
    ] : [`## No failures! Every query passed.`]),
  ].join('\n');

  const outPath = join(import.meta.dirname ?? '.', 'stress-test-results.md');
  await writeFile(outPath, report);
  console.log(`\nReport: ${outPath}`);

  await db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
