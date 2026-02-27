# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # TypeScript → dist/ (tsc)
npm run dev            # Watch mode (tsc --watch)
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode tests
npm run lint           # Type check only (tsc --noEmit)
npx vitest run tests/filter-translator.test.ts   # Run a single test file
```

## The StrictDB Contract

**The public API must never change.** This is the core promise of StrictDB and the reason it's called "Strict." Method signatures, filter syntax, option shapes, return types, error codes — all frozen. When underlying drivers release breaking changes, StrictDB absorbs them internally. The consumer's code stays identical. Only the translation layer and adapter internals evolve. Never introduce a breaking change to anything exported from `src/index.ts`.

## Architecture

StrictDB is a unified database driver — one API surface for MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch. It is **not** an ORM. There are no models, migrations, or code generation.

### Pipeline Flow

Every operation follows this path through `src/strictdb.ts`:

```
Call → sanitize → guardrails → validate (if schema enabled) → adapter → receipts → logger → return
```

### Adapter Pattern

`src/adapters/adapter.ts` defines `DatabaseAdapter`. Three implementations:
- `MongoAdapter` — passes filters natively (MongoDB is the canonical syntax)
- `SqlAdapter` — translates filters via `filter-translator.ts` for pg, mysql2, mssql, better-sqlite3
- `ElasticAdapter` — translates filters to Elasticsearch Query DSL

StrictDB auto-detects which adapter to use from the connection URI.

### Type Hub

`src/types.ts` is the single source for all shared types. Every file imports types from here. No circular dependencies. No cross-adapter imports.

### Filter Translation (Critical Path)

`src/filter-translator.ts` converts MongoDB-style filters (`$eq`, `$gt`, `$in`, `$and`, etc.) into:
- SQL: parameterized WHERE clauses (dialect-aware: pg uses `$1`, mysql/sqlite use `?`, mssql uses `@p1`)
- Elasticsearch: Query DSL objects (`bool`, `term`, `range`, etc.)

MongoDB needs no translation — filters pass through natively.

### SQL Dialect Differences

- **Pagination**: pg/mysql/sqlite use `LIMIT/OFFSET`. MSSQL uses `TOP(n)` for limit-only, `OFFSET FETCH` for skip+limit.
- **Single-row operations**: pg uses `ctid`, mysql uses `LIMIT 1`, sqlite uses `rowid`, mssql uses `TOP(1)`.
- **Upsert**: All dialects use UPDATE-then-INSERT via `performUpsert()` helper.
- **Transactions**: MSSQL uses `BEGIN TRANSACTION` (not `BEGIN`).

## Import Conventions

```typescript
import type { StrictDBConfig } from './types.js';   // Always use 'type' for type-only imports
import { translateToSQL } from './filter-translator.js';  // Always .js extension (Node16 module resolution)
```

ES modules throughout. Target ES2022 with full strict mode, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.

## Testing

220 tests across 9 files using vitest. Tests are pure unit tests — no database connections, no mocks of external services. Filter translation and error mapping are the most heavily tested paths.

Key test files:
- `filter-translator.test.ts` (81 tests) — all operators × all SQL dialects + ES
- `errors.test.ts` (30 tests) — all 3 backends, self-correcting `.fix` messages
- `sql-gaps.test.ts` (23 tests) — MSSQL pagination, updateOne limits, upsert, projection, lookup

## Error Handling

Every error is a `StrictDBError` with `.code`, `.fix` (corrective action string), and `.retryable`. Backend-specific errors from mongo/pg/mysql/mssql/es are mapped to StrictDBError codes in `src/errors.ts`. The `.fix` field is designed for AI self-correction — it tells the caller exactly what to do differently.

## Guardrails (Default: Enabled)

`src/guardrails.ts` hard-blocks dangerous operations before they reach the database:
- `deleteMany({})` / `updateMany({})` — blocked unless `confirm: 'DELETE_ALL'` / `'UPDATE_ALL'`
- `deleteOne({})` — blocked (requires a filter)
- `queryMany` without `{ limit: N }` — blocked

## Dependencies

- **Required**: `zod` (schema validation and DDL generation)
- **Peer (all optional)**: mongodb, pg, mysql2, mssql, better-sqlite3, @elastic/elasticsearch — install only the driver(s) you use
- **Node.js** >= 18.0.0

## MCP Server

`mcp/` is a separate npm package (`strictdb-mcp`) with its own `package.json`. It exposes 14 MCP tools for AI agents. Set `STRICTDB_URI` env var and run the server.

## Key Implementation Notes

- Zod runtime introspection uses: `(schema as unknown as Record<string, unknown>)['_def']`
- Node EventEmitter `error` event throws if no listener — use different event names for tests
- `src/index.ts` is the public API surface — only exports what consumers should use
- `AI.md` at repo root is a token-optimized reference document for AI agent context
