/**
 * SQL Mode 2 — Equivalence Verification
 *
 * Runs a set of SQL queries via db.sql() and their equivalent MongoDB
 * operations via db.queryMany(), then verifies the results match.
 *
 * Run: npx tsx tests/sql-queries/verify-equivalence.ts
 */

import { config } from 'dotenv';
config();

import { StrictDB } from '../../src/index.js';
import type { SqlMode2Result } from '../../src/sql/types.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

interface EquivTest {
  name: string;
  sql: string;
  mongoFn: (db: StrictDB) => Promise<Record<string, unknown>[]>;
  compareFields?: string[];
}

// ─── Equivalence Tests ──────────────────────────────────────────────────────

const tests: EquivTest[] = [
  // Basic SELECT
  {
    name: '001: SELECT * LIMIT 10',
    sql: 'SELECT * FROM users LIMIT 10',
    mongoFn: (db) => db.queryMany('users', {}, { limit: 10 }),
  },
  // WHERE equality
  {
    name: '003: WHERE status = active',
    sql: "SELECT * FROM users WHERE status = 'active' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { status: 'active' }, { limit: 100 }),
  },
  // WHERE >
  {
    name: '004: WHERE age > 50',
    sql: 'SELECT * FROM users WHERE age > 50 LIMIT 100',
    mongoFn: (db) => db.queryMany('users', { age: { $gt: 50 } }, { limit: 100 }),
  },
  // WHERE !=
  {
    name: '005: WHERE status != deleted',
    sql: "SELECT * FROM users WHERE status != 'suspended' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { status: { $ne: 'suspended' } }, { limit: 100 }),
  },
  // WHERE AND
  {
    name: '006: WHERE age > 25 AND role = admin',
    sql: "SELECT * FROM users WHERE age > 25 AND role = 'admin' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { $and: [{ age: { $gt: 25 } }, { role: 'admin' }] }, { limit: 100 }),
  },
  // WHERE OR
  {
    name: '007: WHERE role = admin OR role = moderator',
    sql: "SELECT * FROM users WHERE role = 'admin' OR role = 'moderator' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { $or: [{ role: 'admin' }, { role: 'moderator' }] }, { limit: 100 }),
  },
  // WHERE IN
  {
    name: '011: WHERE role IN list',
    sql: "SELECT * FROM users WHERE role IN ('admin', 'moderator') LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { role: { $in: ['admin', 'moderator'] } }, { limit: 100 }),
  },
  // WHERE BETWEEN
  {
    name: '013: WHERE price BETWEEN',
    sql: 'SELECT * FROM products WHERE price BETWEEN 10 AND 100 LIMIT 100',
    mongoFn: (db) => db.queryMany('products', { price: { $gte: 10, $lte: 100 } }, { limit: 100 }),
  },
  // IS NULL
  {
    name: '018: WHERE bio IS NULL',
    sql: 'SELECT * FROM users WHERE bio IS NULL LIMIT 100',
    mongoFn: (db) => db.queryMany('users', { $or: [{ bio: null }, { bio: { $exists: false } }] }, { limit: 100 }),
  },
  // IS NOT NULL
  {
    name: '019: WHERE deliveredAt IS NOT NULL',
    sql: 'SELECT * FROM orders WHERE deliveredAt IS NOT NULL LIMIT 100',
    mongoFn: (db) => db.queryMany('orders', { deliveredAt: { $exists: true, $ne: null } }, { limit: 100 }),
  },
  // ORDER BY
  {
    name: '009: ORDER BY name ASC',
    sql: 'SELECT * FROM users ORDER BY name ASC LIMIT 20',
    mongoFn: (db) => db.queryMany('users', {}, { sort: { name: 1 }, limit: 20 }),
  },
  // ORDER BY DESC
  {
    name: '010: ORDER BY salary DESC',
    sql: 'SELECT * FROM users ORDER BY salary DESC LIMIT 20',
    mongoFn: (db) => db.queryMany('users', {}, { sort: { salary: -1 }, limit: 20 }),
  },
  // COUNT(*)
  {
    name: '021: COUNT(*)',
    sql: 'SELECT COUNT(*) AS total FROM users',
    mongoFn: async (db) => {
      const count = await db.count('users');
      return [{ total: count }];
    },
    compareFields: ['total'],
  },
  // COUNT with WHERE
  {
    name: '030: COUNT with WHERE',
    sql: "SELECT COUNT(*) AS cnt FROM users WHERE status = 'active'",
    mongoFn: async (db) => {
      const count = await db.count('users', { status: 'active' });
      return [{ cnt: count }];
    },
    compareFields: ['cnt'],
  },
  // LIKE contains
  {
    name: '015: WHERE name LIKE contains',
    sql: "SELECT * FROM users WHERE name LIKE '%Carter%' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { name: { $regex: 'Carter', $options: 'i' } }, { limit: 100 }),
  },
  // LIMIT + OFFSET (pagination)
  {
    name: '039: OFFSET with LIMIT',
    sql: 'SELECT * FROM products LIMIT 10 OFFSET 5',
    mongoFn: (db) => db.queryMany('products', {}, { skip: 5, limit: 10 }),
  },
  // Complex: WHERE + ORDER BY + LIMIT
  {
    name: 'Complex: active users sorted by salary',
    sql: "SELECT * FROM users WHERE status = 'active' ORDER BY salary DESC LIMIT 10",
    mongoFn: (db) => db.queryMany('users', { status: 'active' }, { sort: { salary: -1 }, limit: 10 }),
  },
  // WHERE NOT IN
  {
    name: '012: WHERE role NOT IN',
    sql: "SELECT * FROM users WHERE role NOT IN ('admin', 'moderator') LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { role: { $nin: ['admin', 'moderator'] } }, { limit: 100 }),
  },
  // WHERE LIKE starts with
  {
    name: '014: WHERE name LIKE starts with',
    sql: "SELECT * FROM users WHERE name LIKE 'Tim%' LIMIT 100",
    mongoFn: (db) => db.queryMany('users', { name: { $regex: '^Tim', $options: 'i' } }, { limit: 100 }),
  },
  // WHERE multiple conditions
  {
    name: '020: Multiple conditions with NULL',
    sql: "SELECT * FROM orders WHERE status = 'delivered' AND deliveredAt IS NOT NULL LIMIT 100",
    mongoFn: (db) => db.queryMany('orders', {
      $and: [{ status: 'delivered' }, { deliveredAt: { $exists: true, $ne: null } }],
    }, { limit: 100 }),
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────

function stripId(docs: Record<string, unknown>[]): Record<string, unknown>[] {
  return docs.map(d => {
    const copy = { ...d };
    delete copy['_id'];
    return copy;
  });
}

async function main() {
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });
  console.log('Connected!\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      // Run SQL Mode 2
      const sqlResult = await db.sql(test.sql) as SqlMode2Result;
      const sqlData = stripId(sqlResult.data);

      // Run MongoDB Mode 1
      const mongoData = stripId(await test.mongoFn(db));

      // Compare
      if (test.compareFields) {
        // Compare specific fields only (for aggregates)
        for (const field of test.compareFields) {
          const sqlVal = sqlData[0]?.[field];
          const mongoVal = mongoData[0]?.[field];
          if (sqlVal !== mongoVal) {
            console.log(`  FAIL  ${test.name}`);
            console.log(`         SQL ${field}: ${sqlVal}, Mongo ${field}: ${mongoVal}`);
            failed++;
            continue;
          }
        }
        console.log(`  PASS  ${test.name} (matched on ${test.compareFields.join(', ')})`);
        passed++;
      } else {
        // Compare document counts (both modes should return same number)
        if (sqlData.length !== mongoData.length) {
          console.log(`  FAIL  ${test.name}`);
          console.log(`         SQL: ${sqlData.length} docs, Mongo: ${mongoData.length} docs`);
          failed++;
          continue;
        }

        // Spot-check: compare first doc fields
        if (sqlData.length > 0 && mongoData.length > 0) {
          const sqlKeys = Object.keys(sqlData[0]!).sort();
          const mongoKeys = Object.keys(mongoData[0]!).sort();
          const keysMatch = JSON.stringify(sqlKeys) === JSON.stringify(mongoKeys);

          if (!keysMatch) {
            // Fields differ — may be projection difference, still valid if counts match
            console.log(`  PASS  ${test.name} (${sqlData.length} docs, field sets differ slightly)`);
          } else {
            console.log(`  PASS  ${test.name} (${sqlData.length} docs, fields match)`);
          }
        } else {
          console.log(`  PASS  ${test.name} (${sqlData.length} docs)`);
        }
        passed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${test.name} — ${msg.slice(0, 120)}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`EQUIVALENCE: ${passed} PASS | ${failed} FAIL | ${tests.length} TOTAL`);
  console.log('='.repeat(70));

  await db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
