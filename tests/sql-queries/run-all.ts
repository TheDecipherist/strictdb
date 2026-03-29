/**
 * SQL Mode 2 — Integration Test Runner (MDD Audit)
 *
 * Reads all .md query files, extracts SQL, runs via db.sql() against live sql_test db.
 * Reports pass/fail for each query. Writes results to .mdd/audits/
 *
 * Run: npx tsx tests/sql-queries/run-all.ts
 */

import { config } from 'dotenv';
config();

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { StrictDB } from '../../src/index.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

interface QueryTest {
  file: string;
  title: string;
  sql: string;
  isWrite: boolean;
}

interface TestResult {
  file: string;
  title: string;
  sql: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  error?: string;
  resultCount?: number;
  durationMs?: number;
}

// ─── Parse .md files ────────────────────────────────────────────────────────

function extractSql(content: string): string | null {
  // Extract SQL from ```sql ... ``` block
  const match = content.match(/```sql\n([\s\S]*?)```/);
  if (!match) return null;
  // Clean up: remove trailing semicolons, trim
  return match[1]!.trim().replace(/;\s*$/, '');
}

function extractTitle(content: string): string {
  const match = content.match(/^# (.+)/m);
  return match ? match[1]! : 'Unknown';
}

function isWriteQuery(sql: string): boolean {
  const upper = sql.toUpperCase().trim();
  return upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE');
}

function isParamQuery(content: string): boolean {
  return content.includes('params') || content.includes('Parameterized');
}

// ─── Main Runner ────────────────────────────────────────────────────────────

async function main() {
  const queryDir = join(import.meta.dirname ?? '.', '.');
  const files = (await readdir(queryDir))
    .filter(f => f.endsWith('.md') && /^\d{3}/.test(f))
    .sort();

  console.log(`Found ${files.length} query test files\n`);

  // Parse all query files
  const tests: QueryTest[] = [];
  for (const file of files) {
    const content = await readFile(join(queryDir, file), 'utf-8');
    const sql = extractSql(content);
    const title = extractTitle(content);

    if (!sql) {
      console.log(`  SKIP ${file} — no SQL found`);
      continue;
    }

    // Skip parameterized query tests (they need params, not raw SQL)
    if (isParamQuery(content)) {
      tests.push({ file, title, sql, isWrite: false }); // Still try them
    } else {
      tests.push({ file, title, sql, isWrite: isWriteQuery(sql) });
    }
  }

  console.log(`Parsed ${tests.length} queries\n`);

  // Connect to database
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false, // We test guardrails separately in unit tests
    logging: false,
  });
  console.log('Connected!\n');

  // Run all queries
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const test of tests) {
    const start = Date.now();
    try {
      // Skip param queries that have ? or $1 placeholders — they need params
      if (test.sql.includes('?') || /\$\d+/.test(test.sql)) {
        results.push({ file: test.file, title: test.title, sql: test.sql, status: 'SKIP', durationMs: 0 });
        skipped++;
        console.log(`  SKIP  ${test.file} — parameterized query (needs params)`);
        continue;
      }

      const result = await db.sql(test.sql);
      const durationMs = Date.now() - start;

      // Check result shape
      let resultCount = 0;
      if ('data' in result && Array.isArray(result.data)) {
        resultCount = result.data.length;
      } else if ('insertedCount' in result) {
        resultCount = (result as Record<string, unknown>).insertedCount as number ?? 0;
      } else if ('modifiedCount' in result) {
        resultCount = (result as Record<string, unknown>).modifiedCount as number ?? 0;
      } else if ('deletedCount' in result) {
        resultCount = (result as Record<string, unknown>).deletedCount as number ?? 0;
      }

      results.push({
        file: test.file,
        title: test.title,
        sql: test.sql,
        status: 'PASS',
        resultCount,
        durationMs,
      });
      passed++;
      console.log(`  PASS  ${test.file} (${resultCount} results, ${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        file: test.file,
        title: test.title,
        sql: test.sql,
        status: 'FAIL',
        error: errMsg,
        durationMs,
      });
      failed++;
      console.log(`  FAIL  ${test.file} — ${errMsg.slice(0, 120)}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${passed} PASS | ${failed} FAIL | ${skipped} SKIP | ${tests.length} TOTAL`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.log('\nFailed queries:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`\n  ${r.file}`);
      console.log(`  SQL: ${r.sql.slice(0, 100)}${r.sql.length > 100 ? '...' : ''}`);
      console.log(`  Error: ${r.error}`);
    }
  }

  // Write MDD audit report
  const auditDir = join(import.meta.dirname ?? '.', '../../.mdd/audits');
  await mkdir(auditDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const reportPath = join(auditDir, `integration-${date}.md`);

  const report = [
    `# SQL Mode 2 — Integration Test Audit`,
    ``,
    `**Date:** ${date}`,
    `**Database:** sql_test (MongoDB Atlas)`,
    `**Queries tested:** ${tests.length}`,
    `**Passed:** ${passed}`,
    `**Failed:** ${failed}`,
    `**Skipped:** ${skipped}`,
    ``,
    `## Results`,
    ``,
    `| # | File | Status | Results | Time | Error |`,
    `|---|------|--------|---------|------|-------|`,
    ...results.map(r =>
      `| ${r.file.slice(0, 3)} | ${r.file} | ${r.status} | ${r.resultCount ?? '-'} | ${r.durationMs ?? '-'}ms | ${r.error ? r.error.slice(0, 80) : '-'} |`
    ),
    ``,
    `## Failed Queries (Detail)`,
    ``,
    ...results.filter(r => r.status === 'FAIL').map(r => [
      `### ${r.file}`,
      ``,
      '```sql',
      r.sql,
      '```',
      ``,
      `**Error:** ${r.error}`,
      ``,
    ].join('\n')),
  ].join('\n');

  await writeFile(reportPath, report);
  console.log(`\nAudit report: ${reportPath}`);

  await db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
