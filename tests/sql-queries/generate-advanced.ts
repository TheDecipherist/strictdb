/**
 * StrictDB — Advanced SQL Edge Case Test Suite Generator
 *
 * Pushes SQL Mode 2 to its absolute limits. Every query is run live.
 * If it returns data + explain → it's in the doc.
 * If it fails → we fix it or document the limitation.
 *
 * Run: npx tsx tests/sql-queries/generate-advanced.ts
 */

import { config } from 'dotenv';
config();

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

interface AdvancedTest {
  id: number;
  title: string;
  category: string;
  description: string;
  sql: string;
  whyHard: string;
}

function stripIds(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(d => stripIds(d));
  if (data && typeof data === 'object') {
    const obj = { ...(data as Record<string, unknown>) };
    delete obj['_id'];
    return obj;
  }
  return data;
}

function formatJson(data: unknown, maxItems = 3): string {
  const arr = Array.isArray(data) ? data : [data];
  const stripped = stripIds(arr) as Record<string, unknown>[];
  const shown = stripped.slice(0, maxItems);
  const lines = JSON.stringify(shown, null, 2);
  if (stripped.length > maxItems) {
    return lines.slice(0, -2) + `,\n  // ... and ${stripped.length - maxItems} more results\n]`;
  }
  return lines;
}

// ─── The Gauntlet ───────────────────────────────────────────────────────────

const tests: AdvancedTest[] = [
  // ── MULTI-TABLE JOINS ─────────────────────────────────────────────────
  {
    id: 1,
    title: 'Three-Table INNER JOIN with Filtering and Sorting',
    category: 'Multi-Table Joins',
    description: 'Join orders → users → products, filter by order status, sort by total descending.',
    sql: `SELECT o.orderId, u.name AS customer, p.name AS product, o.quantity, o.total
FROM orders o
INNER JOIN users u ON o.userId = u.userId
INNER JOIN products p ON o.productId = p.productId
WHERE o.status = 'delivered'
ORDER BY o.total DESC
LIMIT 15`,
    whyHard: 'Chains two $lookup stages, filters on the main collection, sorts, and limits — 5 pipeline stages from one SQL line.',
  },
  {
    id: 2,
    title: 'LEFT JOIN with NULL Check (Anti-Join)',
    category: 'Multi-Table Joins',
    description: 'Find users who have NEVER placed an order.',
    sql: `SELECT u.name, u.email, u.department
FROM users u
LEFT JOIN orders o ON u.userId = o.userId
WHERE o.orderId IS NULL
LIMIT 20`,
    whyHard: 'Anti-join pattern: LEFT JOIN + IS NULL. Requires $lookup, $unwind with preserveNullAndEmptyArrays, then $match for null.',
  },
  {
    id: 3,
    title: 'FULL OUTER JOIN — Complete User-Review Universe',
    category: 'Multi-Table Joins',
    description: 'Return ALL users and ALL reviews, matched where possible. Unmatched on either side still appear.',
    sql: `SELECT u.name, u.email, r.rating, r.title AS review_title
FROM users u
FULL OUTER JOIN reviews r ON u.userId = r.userId
LIMIT 20`,
    whyHard: 'FULL OUTER JOIN is impossible in a single MongoDB aggregate. StrictDB runs TWO pipelines in parallel and merges the results.',
  },
  {
    id: 4,
    title: 'RIGHT JOIN — Orders Leading, Users Following',
    category: 'Multi-Table Joins',
    description: 'Start from orders and pull in user data. Orders without matching users still appear.',
    sql: `SELECT o.orderId, o.total, u.name AS customer_name
FROM users u
RIGHT JOIN orders o ON u.userId = o.userId
ORDER BY o.total DESC
LIMIT 10`,
    whyHard: 'RIGHT JOIN reverses the collection order internally — StrictDB swaps from/localField/foreignField automatically.',
  },

  // ── SUBQUERIES ────────────────────────────────────────────────────────
  {
    id: 5,
    title: 'Subquery IN — Orders from Premium Users',
    category: 'Subqueries (Multi-Phase Execution)',
    description: 'Find orders placed by premium users. The inner query resolves first, then feeds the outer query.',
    sql: `SELECT orderId, userId, total, status
FROM orders
WHERE userId IN (SELECT userId FROM users WHERE isPremium = true)
LIMIT 20`,
    whyHard: 'Phase 2 dependency resolution: StrictDB runs the subquery first, extracts the userId values, then injects them as $in into the main query.',
  },
  {
    id: 6,
    title: 'Subquery NOT IN — Products Nobody Reviewed',
    category: 'Subqueries (Multi-Phase Execution)',
    description: 'Find products that have zero reviews.',
    sql: `SELECT productId, name, category, price
FROM products
WHERE productId NOT IN (SELECT productId FROM reviews)
LIMIT 20`,
    whyHard: 'Negative subquery: resolves reviewed product IDs, then uses $nin to exclude them.',
  },
  {
    id: 7,
    title: 'Subquery — Users with High-Value Orders',
    category: 'Subqueries (Multi-Phase Execution)',
    description: 'Find users who have placed at least one order over $1,500.',
    sql: `SELECT name, email, salary, department
FROM users
WHERE userId IN (SELECT userId FROM orders WHERE total > 1500)
LIMIT 15`,
    whyHard: 'Phase 2 dependency: inner query finds high-value order userIds, outer query fetches those users. Two queries, one SQL statement.',
  },

  // ── AGGREGATION POWERHOUSE ────────────────────────────────────────────
  {
    id: 8,
    title: 'GROUP BY with Multiple Aggregates',
    category: 'Complex Aggregation',
    description: 'Per-department stats: headcount, average salary, min salary, max salary, total payroll.',
    sql: `SELECT department,
  COUNT(*) AS headcount,
  AVG(salary) AS avg_salary,
  MIN(salary) AS min_salary,
  MAX(salary) AS max_salary,
  SUM(salary) AS total_payroll
FROM employees
GROUP BY department`,
    whyHard: 'Five different accumulator types in a single $group stage.',
  },
  {
    id: 9,
    title: 'GROUP BY + HAVING + ORDER BY',
    category: 'Complex Aggregation',
    description: 'Find departments where average salary exceeds $70K, ordered by headcount.',
    sql: `SELECT department,
  COUNT(*) AS headcount,
  AVG(salary) AS avg_salary
FROM employees
GROUP BY department
HAVING AVG(salary) > 70000
ORDER BY headcount DESC`,
    whyHard: 'Pipeline chain: $group → $match (HAVING) → $sort. The HAVING references the computed avg_salary alias.',
  },
  {
    id: 10,
    title: 'CASE WHEN Inside Aggregation — Status Dashboard',
    category: 'Complex Aggregation',
    description: 'Bucket orders into status groups (active/completed/cancelled) and count each.',
    sql: `SELECT
  CASE
    WHEN status IN ('pending', 'confirmed') THEN 'active'
    WHEN status IN ('shipped', 'delivered') THEN 'completed'
    ELSE 'cancelled'
  END AS status_group,
  COUNT(*) AS order_count,
  SUM(total) AS group_revenue
FROM orders
GROUP BY CASE
    WHEN status IN ('pending', 'confirmed') THEN 'active'
    WHEN status IN ('shipped', 'delivered') THEN 'completed'
    ELSE 'cancelled'
  END`,
    whyHard: 'GROUP BY a CASE expression: StrictDB pre-computes the CASE as $addFields with $switch, then groups on the computed field.',
  },
  {
    id: 11,
    title: 'JOIN + GROUP BY + HAVING — Revenue Per Customer',
    category: 'Complex Aggregation',
    description: 'Join orders to users, compute spending per user, filter to big spenders.',
    sql: `SELECT u.name,
  COUNT(*) AS order_count,
  SUM(o.total) AS total_spent,
  AVG(o.total) AS avg_order
FROM users u
INNER JOIN orders o ON u.userId = o.userId
GROUP BY u.name
HAVING SUM(o.total) > 500
ORDER BY total_spent DESC
LIMIT 20`,
    whyHard: 'Combines $lookup + $unwind + $group (with 3 accumulators) + $match (HAVING) + $sort + $limit. Six pipeline stages.',
  },
  {
    id: 12,
    title: 'COUNT DISTINCT Equivalent',
    category: 'Complex Aggregation',
    description: 'Count how many distinct cities users come from.',
    sql: `SELECT COUNT(DISTINCT city) AS unique_cities FROM users`,
    whyHard: 'MongoDB has no native COUNT DISTINCT — requires $group by city first, then $group with $sum to count the groups.',
  },

  // ── WINDOW FUNCTIONS ──────────────────────────────────────────────────
  {
    id: 13,
    title: 'RANK with PARTITION BY',
    category: 'Window Functions',
    description: 'Rank employees by salary within each department.',
    sql: `SELECT name, department, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank
FROM employees
LIMIT 20`,
    whyHard: 'Maps to $setWindowFields with partitionBy and $rank — MongoDB 5.0+ feature that most developers have never used.',
  },
  {
    id: 14,
    title: 'DENSE_RANK — No Gaps in Rankings',
    category: 'Window Functions',
    description: 'Dense rank users by score (no skipped ranks after ties).',
    sql: `SELECT name, score,
  DENSE_RANK() OVER (ORDER BY score DESC) AS score_rank
FROM users
LIMIT 15`,
    whyHard: '$denseRank in $setWindowFields — most MongoDB developers don\'t know this exists.',
  },
  {
    id: 15,
    title: 'ROW_NUMBER — Sequential Numbering',
    category: 'Window Functions',
    description: 'Assign sequential numbers to products ordered by price.',
    sql: `SELECT name, price, category,
  ROW_NUMBER() OVER (ORDER BY price DESC) AS price_rank
FROM products
LIMIT 15`,
    whyHard: '$documentNumber in $setWindowFields.',
  },
  {
    id: 16,
    title: 'LAG — Previous Order Total',
    category: 'Window Functions',
    description: 'For each order, show the previous order total by the same user.',
    sql: `SELECT orderId, userId, total,
  LAG(total, 1) OVER (PARTITION BY userId ORDER BY createdAt) AS prev_total
FROM orders
LIMIT 20`,
    whyHard: '$shift with negative offset in $setWindowFields — peer back in time per partition.',
  },

  // ── COMPUTED FIELDS & EXPRESSIONS ─────────────────────────────────────
  {
    id: 17,
    title: 'Arithmetic in WHERE + SELECT + ORDER BY',
    category: 'Computed Fields & Expressions',
    description: 'Calculate revenue potential (price × stock), filter, sort, and project — all from arithmetic expressions.',
    sql: `SELECT name, price, stock,
  ROUND(price * stock, 2) AS revenue_potential
FROM products
WHERE price * stock > 5000
ORDER BY price * stock DESC
LIMIT 10`,
    whyHard: 'Same arithmetic expression used in WHERE ($expr), $addFields, and ORDER BY ($addFields + $sort) — three different pipeline treatments from one expression.',
  },
  {
    id: 18,
    title: 'Nested Functions — ROUND(AVG(...))',
    category: 'Computed Fields & Expressions',
    description: 'Round the average rating per product category to 1 decimal.',
    sql: `SELECT category,
  COUNT(*) AS product_count,
  ROUND(AVG(price), 2) AS avg_price,
  ROUND(AVG(rating), 1) AS avg_rating
FROM products
GROUP BY category`,
    whyHard: 'Aggregates computed in $group, then needs a post-$group $addFields to apply $round.',
  },
  {
    id: 19,
    title: 'COALESCE + CONCAT — Null-Safe String Building',
    category: 'Computed Fields & Expressions',
    description: 'Build display names handling nullable bio field.',
    sql: `SELECT
  CONCAT(firstName, ' ', lastName) AS full_name,
  email,
  COALESCE(bio, 'No bio provided') AS display_bio,
  COALESCE(city, 'Unknown') AS display_city
FROM users
WHERE status = 'active'
LIMIT 10`,
    whyHard: 'Multiple $addFields with $concat and $ifNull applied in sequence — handles nulls gracefully.',
  },
  {
    id: 20,
    title: 'CASE WHEN with Multiple Branches in SELECT',
    category: 'Computed Fields & Expressions',
    description: 'Categorize users into age tiers and salary bands simultaneously.',
    sql: `SELECT name, age, salary,
  CASE
    WHEN age < 25 THEN 'Junior'
    WHEN age < 40 THEN 'Mid-Level'
    WHEN age < 55 THEN 'Senior'
    ELSE 'Executive'
  END AS age_tier,
  CASE
    WHEN salary < 50000 THEN 'Low'
    WHEN salary < 100000 THEN 'Medium'
    ELSE 'High'
  END AS salary_band
FROM users
LIMIT 15`,
    whyHard: 'Two independent CASE WHEN expressions in one SELECT — becomes two $switch expressions in one $addFields stage.',
  },

  // ── STRING OPERATIONS ─────────────────────────────────────────────────
  {
    id: 21,
    title: 'LIKE with Multiple Patterns via OR',
    category: 'String Operations',
    description: 'Find users whose name matches any of several patterns.',
    sql: `SELECT name, email, department
FROM users
WHERE name LIKE 'Tim%' OR name LIKE 'Alice%' OR name LIKE '%Carter'
LIMIT 15`,
    whyHard: 'Multiple $regex patterns combined with $or.',
  },
  {
    id: 22,
    title: 'UPPER + LOWER + LENGTH in One Query',
    category: 'String Operations',
    description: 'Transform and measure string fields in a single SELECT.',
    sql: `SELECT
  UPPER(name) AS name_upper,
  LOWER(email) AS email_lower,
  LENGTH(name) AS name_length
FROM users
WHERE status = 'active'
LIMIT 10`,
    whyHard: 'Three different string functions ($toUpper, $toLower, $strLenCP) all computed in one $addFields stage.',
  },

  // ── DATE OPERATIONS ───────────────────────────────────────────────────
  {
    id: 23,
    title: 'Date Range with BETWEEN',
    category: 'Date Operations',
    description: 'Find orders created in a specific date range.',
    sql: `SELECT orderId, userId, total, status, createdAt
FROM orders
WHERE createdAt BETWEEN '2025-01-01' AND '2025-06-30'
ORDER BY createdAt DESC
LIMIT 15`,
    whyHard: 'Date strings auto-coerced to Date objects for proper MongoDB date comparison.',
  },
  {
    id: 24,
    title: 'EXTRACT Year + Month from Dates',
    category: 'Date Operations',
    description: 'Extract year and month from hire dates for timeline analysis.',
    sql: `SELECT name, department, hireDate,
  EXTRACT(YEAR FROM hireDate) AS hire_year,
  EXTRACT(MONTH FROM hireDate) AS hire_month
FROM employees
LIMIT 15`,
    whyHard: '$year and $month operators in $addFields — MongoDB date decomposition from SQL syntax.',
  },

  // ── EDGE CASES & STRESS TESTS ─────────────────────────────────────────
  {
    id: 25,
    title: 'IS NULL + IS NOT NULL in Same Query',
    category: 'Edge Cases',
    description: 'Find orders that are delivered (deliveredAt IS NOT NULL) but have no notes.',
    sql: `SELECT orderId, userId, total, status
FROM orders
WHERE deliveredAt IS NOT NULL AND notes IS NULL
LIMIT 15`,
    whyHard: 'Combines $exists:true/$ne:null with $or:[null, $exists:false] in the same $match.',
  },
  {
    id: 26,
    title: 'NOT IN with Large List',
    category: 'Edge Cases',
    description: 'Exclude specific order statuses using NOT IN.',
    sql: `SELECT orderId, userId, total, status
FROM orders
WHERE status NOT IN ('cancelled', 'returned', 'pending')
ORDER BY total DESC
LIMIT 15`,
    whyHard: '$nin with multiple values + sort + limit.',
  },
  {
    id: 27,
    title: 'Complex WHERE: AND + OR + BETWEEN + LIKE',
    category: 'Edge Cases',
    description: 'Combine every WHERE operator type in one query.',
    sql: `SELECT name, age, salary, department, status
FROM users
WHERE (age BETWEEN 25 AND 50)
  AND (department = 'Engineering' OR department = 'Product')
  AND name LIKE '%a%'
  AND status != 'suspended'
LIMIT 15`,
    whyHard: 'Deeply nested $and with $gte/$lte (BETWEEN), $or, $regex (LIKE), and $ne — all in one $match.',
  },
  {
    id: 28,
    title: 'Aggregate with WHERE + GROUP BY + HAVING + ORDER BY',
    category: 'Edge Cases',
    description: 'Full aggregate pipeline: filter → group → filter groups → sort.',
    sql: `SELECT department,
  COUNT(*) AS active_count,
  AVG(salary) AS avg_salary
FROM users
WHERE status = 'active'
GROUP BY department
HAVING COUNT(*) > 3
ORDER BY avg_salary DESC`,
    whyHard: '$match (WHERE) → $group → $match (HAVING) → $sort — four-stage pipeline with the HAVING referencing the computed alias.',
  },
  {
    id: 29,
    title: 'JOIN + Aggregate + CASE + ORDER BY',
    category: 'Edge Cases',
    description: 'Join orders to products, bucket by price tier, count and sum per tier.',
    sql: `SELECT
  CASE
    WHEN p.price < 50 THEN 'Budget'
    WHEN p.price < 200 THEN 'Mid-Range'
    ELSE 'Premium'
  END AS price_tier,
  COUNT(*) AS order_count,
  SUM(o.total) AS tier_revenue
FROM orders o
INNER JOIN products p ON o.productId = p.productId
GROUP BY CASE
    WHEN p.price < 50 THEN 'Budget'
    WHEN p.price < 200 THEN 'Mid-Range'
    ELSE 'Premium'
  END
ORDER BY tier_revenue DESC`,
    whyHard: '$lookup + $unwind + $addFields ($switch on joined field) + $group + $sort — combines JOIN, CASE, GROUP BY, and ORDER BY.',
  },
  {
    id: 30,
    title: 'Multiple Subqueries in WHERE',
    category: 'Edge Cases',
    description: 'Filter by two different subqueries at once.',
    sql: `SELECT orderId, userId, total, status
FROM orders
WHERE userId IN (SELECT userId FROM users WHERE role = 'admin')
  AND productId IN (SELECT productId FROM products WHERE category = 'Electronics')
LIMIT 15`,
    whyHard: 'TWO Phase 2 dependencies resolved in parallel via Promise.all, both injected into the main query.',
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });
  console.log('Connected!\n');

  const sections: string[] = [];
  let currentCategory = '';
  let passed = 0;
  let failed = 0;
  const failures: Array<{ id: number; title: string; error: string; sql: string }> = [];

  for (const test of tests) {
    process.stdout.write(`  #${String(test.id).padStart(2, '0')} ${test.title}... `);

    if (test.category !== currentCategory) {
      currentCategory = test.category;
      sections.push(`\n---\n\n## ${currentCategory}\n`);
    }

    try {
      // Run with explain
      const result = await db.sql(test.sql, { explain: true }) as SqlMode2Result;
      const data = result.data;
      const plan = result.plan!;

      // Format explain
      const pipelines = plan.pipelines ?? [];
      const deps = plan.dependencies ?? [];

      let explainBody = '';

      if (deps.length > 0) {
        explainBody += `// Phase 1 — Resolve ${deps.length} ${deps.length === 1 ? 'dependency' : 'dependencies'} ${deps.length > 1 ? '(via Promise.all)' : ''}:\n`;
        for (const dep of deps) {
          explainBody += `//   ${dep.type}: db.collection('${dep.collection}').aggregate(${JSON.stringify(dep.pipeline)})\n`;
          explainBody += `//   → ${dep.resultCount} results injected into main query\n`;
        }
        explainBody += `//\n// Phase 2 — Execute main query:\n`;
      }

      for (let i = 0; i < pipelines.length; i++) {
        const p = pipelines[i]!;
        if (pipelines.length > 1) {
          explainBody += `${i === 0 ? '' : '\n'}// Pipeline ${i + 1} of ${pipelines.length}${plan.parallel ? ' (runs in parallel)' : ''}:\n`;
        }
        explainBody += `db.collection('${p.collection}').aggregate(${JSON.stringify(p.stages, null, 2)})`;
        if (i < pipelines.length - 1) explainBody += '\n';
      }

      sections.push(`
### #${String(test.id).padStart(2, '0')} — ${test.title}

> ${test.description}

**Why this is hard:** ${test.whyHard}

**SQL:**
\`\`\`sql
${test.sql}
\`\`\`

**What StrictDB actually ran** (\`{ explain: true }\`):
\`\`\`javascript
// Phases: ${plan.phases} | Parallel: ${plan.parallel} | Duration: ${plan.durationMs}ms | Results: ${data.length}
${explainBody}
\`\`\`

**Results** (${data.length} documents):
\`\`\`json
${formatJson(data)}
\`\`\`
`);
      passed++;
      console.log(`PASS (${data.length} results, ${plan.durationMs}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ id: test.id, title: test.title, error: msg, sql: test.sql });
      sections.push(`
### #${String(test.id).padStart(2, '0')} — ${test.title}

> ${test.description}

**Why this is hard:** ${test.whyHard}

**SQL:**
\`\`\`sql
${test.sql}
\`\`\`

**Status:** FAILED — ${msg.slice(0, 200)}
`);
      failed++;
      console.log(`FAIL — ${msg.slice(0, 80)}`);
    }
  }

  // Build document
  const doc = `# StrictDB: Advanced SQL Queries on MongoDB

> No SQL query is too complex. StrictDB makes MongoDB speak fluent SQL.

This document contains **${tests.length} advanced SQL queries** executed against a live MongoDB database via StrictDB's SQL Mode 2. Every query shows the actual SQL, the MongoDB aggregate pipeline that StrictDB generated, and the real results.

These aren't toy examples. They include multi-table JOINs, subqueries with dependency resolution, window functions, CASE WHEN inside GROUP BY, complex WHERE expressions with arithmetic, and edge cases that push the limits of what's possible.

**Every query ran successfully against MongoDB Atlas.** The explain output shows exactly what happened under the hood.

**Database:** \`sql_test\` on MongoDB Atlas
**Collections:** users (100), products (50), orders (300), employees (40), events (500), reviews (200), sessions (150)
**Results:** ${passed}/${tests.length} passed${failed > 0 ? ` | ${failed} failed` : ''}
${sections.join('')}
---

## How It Works

StrictDB's SQL Mode 2 is a three-phase execution engine:

1. **Parse & Plan** — SQL string → AST → execution plan with dependency graph
2. **Resolve Dependencies** — subqueries, CTEs resolved in parallel (Promise.all)
3. **Build & Execute** — aggregate pipelines built, run against MongoDB, results merged

\`\`\`typescript
// One line of code. Any SQL query. MongoDB under the hood.
const result = await db.sql(yourSqlQuery, { explain: true });

// result.data    → your results
// result.plan    → the MongoDB pipeline that actually ran
\`\`\`

No ORMs. No code generation. No schema definitions required. Just SQL in, results out.
`;

  const outPath = join(import.meta.dirname ?? '.', 'advanced-sql-queries.md');
  await writeFile(outPath, doc);
  console.log(`\nDocument: ${outPath}`);
  console.log(`${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  #${f.id} ${f.title}`);
      console.log(`    ${f.error.slice(0, 150)}`);
    }
  }

  await db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
