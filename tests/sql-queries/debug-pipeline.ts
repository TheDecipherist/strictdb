import { config } from 'dotenv';
config();
import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';

async function main() {
  const db = await StrictDB.create({
    uri: process.env['MONGODB_URI']!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });

  const queries = [
    {
      name: 'GROUP BY with HAVING',
      sql: "SELECT department, AVG(salary) AS avg_sal, COUNT(*) AS headcount FROM employees GROUP BY department HAVING AVG(salary) > 80000",
    },
    {
      name: 'JOIN + GROUP BY + HAVING',
      sql: "SELECT u.name, SUM(o.total) AS total_spent, COUNT(*) AS order_count FROM users u INNER JOIN orders o ON u.userId = o.userId GROUP BY u.name HAVING SUM(o.total) > 500",
    },
    {
      name: 'CASE + Aggregation',
      sql: "SELECT CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END AS status_group, COUNT(*) AS order_count FROM orders GROUP BY CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END",
    },
    {
      name: 'Calculated Fields + Filter + Sort',
      sql: "SELECT name, price, stock, ROUND(price * stock, 2) AS revenue_potential, category FROM products WHERE price * stock > 1000 ORDER BY price * stock DESC LIMIT 10",
    },
  ];

  for (const q of queries) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Query: ${q.name}`);
    console.log(`SQL: ${q.sql.slice(0, 80)}...`);

    // Show pipeline
    try {
      const ast = parseSql(q.sql);
      const plan = buildExecutionPlan(ast, q.sql);
      console.log('\nPipeline stages:');
      for (const stage of plan.pipelines[0]?.stages ?? []) {
        console.log('  ', JSON.stringify(stage));
      }
    } catch (err) {
      console.log('Plan error:', (err as Error).message);
    }

    // Execute
    try {
      const result = await db.sql(q.sql) as SqlMode2Result;
      console.log(`\nResults: ${result.data.length} docs`);
      if (result.data.length > 0) {
        console.log('First:', JSON.stringify(result.data[0], null, 2));
      }
    } catch (err) {
      console.log('Execution error:', (err as Error).message);
    }
  }

  await db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
