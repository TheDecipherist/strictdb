import { config } from 'dotenv';
config();
import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';

async function main() {
  const db = await StrictDB.create({
    uri: process.env['MONGODB_URI']!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });

  // Test scalar subquery with explain
  const sql = "SELECT name, age FROM users WHERE age > (SELECT AVG(age) AS avg FROM users) LIMIT 10";
  const r = await db.sql(sql, { explain: true }) as SqlMode2Result;

  console.log('Results:', r.data.length);
  if (r.data.length > 0) console.log('First:', JSON.stringify(r.data[0]));
  console.log('\nPlan:');
  console.log('Phases:', r.plan?.phases);
  console.log('Deps:', r.plan?.dependencies.length);
  for (const dep of r.plan?.dependencies ?? []) {
    console.log(`  ${dep.type}: collection=${dep.collection}, results=${dep.resultCount}`);
    console.log('  pipeline:', JSON.stringify(dep.pipeline));
  }
  console.log('\nPipeline stages:');
  for (const stage of r.plan?.pipelines[0]?.stages ?? []) {
    console.log(' ', JSON.stringify(stage));
  }

  // Also test: orders above average total
  console.log('\n=== Orders above average total ===');
  const r2 = await db.sql("SELECT orderId, total FROM orders WHERE total > (SELECT AVG(total) AS avg FROM orders) LIMIT 10", { explain: true }) as SqlMode2Result;
  console.log('Results:', r2.data.length);
  if (r2.data.length > 0) console.log('First:', JSON.stringify(r2.data[0]));

  await db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
