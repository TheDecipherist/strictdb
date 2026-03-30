<a href="https://strictdb.com/">
  <img src="https://strictdb.com/banner.webp" alt="StrictDB — The Unified Database Driver for AI-First Development" width="100%">
</a>

<p align="center">
  <a href="https://strictdb.com/"><strong>View Full Documentation Website &rarr;</strong></a>
</p>

# StrictDB

One unified API for MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch. Write database queries once — run them anywhere.

StrictDB is an AI-first database driver with built-in guardrails, self-correcting errors, schema discovery, and a Model Context Protocol (MCP) server for AI agent integration.

## Why StrictDB?

- **One syntax, six backends** — MongoDB-style filters translate automatically to SQL WHERE clauses and Elasticsearch Query DSL
- **SQL Mode** — write native SQL queries against MongoDB. JOINs, subqueries, window functions — all translated to aggregate pipelines automatically
- **Native pipelines** — `db.aggregate()` accepts any MongoDB pipeline, translated across all backends
- **AI-first** — `describe()`, `validate()`, and `explain()` let AI agents discover schemas and dry-run queries before execution
- **Guardrails** — blocks empty-filter deletes, unbounded queries, and other dangerous operations by default
- **Self-correcting errors** — every error includes a `.fix` field with the exact corrective action
- **Zero config** — auto-detects backend from URI, optional peer dependencies
- **Stable API contract** — Drivers change. Your code doesn't. When drivers release breaking updates, StrictDB absorbs the change internally. Your queries stay identical across every version, every upgrade, every migration.
- **Structured receipts** — every write returns an `OperationReceipt` (never void)
- **MCP server** — 14 tools for AI agents to interact with any database through one interface

## The StrictDB Contract

**Drivers change. Your code doesn't.**

This is why it's called **Strict**DB.

StrictDB's API surface is frozen. Your code never changes — even when the drivers underneath do.

- MongoDB bumps to v7 and changes their API? **StrictDB absorbs it.**
- `pg` releases breaking changes? **StrictDB absorbs it.**
- Elasticsearch moves from 7 to 8 with a different client? **StrictDB absorbs it.**
- MySQL2 deprecates a method? **StrictDB absorbs it.**

ORMs break on major upgrades. Prisma has migration headaches. Mongoose had breaking changes between v6 and v7. Sequelize broke between v5 and v6. Every ORM eventually forces you to rewrite something.

**StrictDB's contract is different:** the translation layer evolves, your queries don't.

- Change your database → change one URI string
- Upgrade your driver → run `npm update`
- Your application code → stays identical. Always.

> *"You're always afraid to upgrade your databases because new drivers always break something. So most people just stay on older versions saying they'll get around to upgrading — but never do."*
>
> *"Why should the 'language' you're writing be different from Mongo to SQL to Elasticsearch? It's data. Give me my data. Get out of the way and let me build what I want."*
>
> — TheDecipherist, creator of StrictDB

StrictDB runs an automated analyzer every day that checks every supported driver for changes. When a driver updates, StrictDB absorbs it internally — before it ever reaches your code. This is not a version policy. It's engineered.

StrictDB monitors MongoDB, pg, mysql2, mssql, better-sqlite3, and @elastic/elasticsearch for breaking changes daily.

## Installation

```bash
npm install strictdb
```

Install only the driver(s) you need:

```bash
# MongoDB
npm install mongodb

# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# MSSQL
npm install mssql

# SQLite
npm install better-sqlite3

# Elasticsearch
npm install @elastic/elasticsearch
```

## Quick Start

```typescript
import { StrictDB } from 'strictdb';

const db = await StrictDB.create({ uri: process.env.STRICTDB_URI });

// Find one document
const user = await db.queryOne('users', { email: 'tim@example.com' });

// Find many with filters, sorting, and limits
const admins = await db.queryMany('users', {
  role: 'admin',
  status: { $in: ['active', 'pending'] },
  age: { $gte: 18 }
}, { sort: { createdAt: -1 }, limit: 50 });

// Insert
const receipt = await db.insertOne('users', {
  email: 'new@example.com',
  name: 'New User',
  role: 'user',
});
console.log(receipt.insertedCount); // 1

// Update with operators
await db.updateOne('users',
  { email: 'tim@example.com' },
  { $set: { role: 'admin' }, $inc: { loginCount: 1 } }
);

// Delete
await db.deleteOne('users', { email: 'old@example.com' });

// Batch operations
await db.batch([
  { operation: 'insertOne', collection: 'orders', doc: { item: 'widget', qty: 5 } },
  { operation: 'updateOne', collection: 'inventory', filter: { sku: 'W1' }, update: { $inc: { stock: -5 } } },
]);

// Close when done
await db.close();
```

## SQL Mode — Write SQL, Run on MongoDB

StrictDB is the first database driver that lets you write native SQL and execute it directly against MongoDB. Not a translator — a full execution engine. SQL in, results out.

```typescript
// Write SQL you already know
const users = await db.sql('SELECT * FROM users WHERE age > 25 LIMIT 50');

// Parameterized queries
const user = await db.sql(
  'SELECT * FROM users WHERE email = ? AND status = ? LIMIT 1',
  { params: ['tim@example.com', 'active'] }
);

// See what MongoDB actually ran
const result = await db.sql(
  'SELECT u.name, COUNT(o.id) as order_count FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name HAVING COUNT(o.id) > 5 ORDER BY order_count DESC LIMIT 10',
  { explain: true }
);
// result.data — query results
// result.plan — the aggregate pipeline that ran
```

### What SQL Mode Supports

- **SELECT** with WHERE, ORDER BY, LIMIT, OFFSET, DISTINCT, aliases
- **JOINs** — INNER, LEFT, RIGHT, FULL OUTER (runs parallel pipelines)
- **Aggregates** — COUNT, SUM, AVG, MIN, MAX, GROUP BY, HAVING
- **Window Functions** — ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD
- **Subqueries** — IN, NOT IN, EXISTS (multi-phase dependency resolution)
- **Functions** — UPPER, LOWER, CONCAT, ROUND, COALESCE, CASE WHEN, and 30+ more
- **Writes** — INSERT, UPDATE, DELETE with guardrails
- **Transactions** — BEGIN/COMMIT/ROLLBACK with MongoDB sessions
- **Parameters** — MySQL (?) and PostgreSQL ($1) styles
- **RETURNING** — INSERT ... RETURNING for ID retrieval
- **{ explain: true }** — see the exact MongoDB pipeline generated

Every SQL query goes through StrictDB's guardrails, logging, and error handling — same safety as Mode 1.

## Native Pipeline — db.aggregate() & db.bulkWrite()

Pro MongoDB developers can pass native aggregate pipelines directly. Zero-overhead on MongoDB — pipelines pass straight to the driver. On SQL/ES, pipeline stages are translated automatically.

```typescript
// Native aggregate pipeline
const topDepts = await db.aggregate('employees', [
  { $match: { status: 'active' } },
  { $group: { _id: '$department', avg_salary: { $avg: '$salary' } } },
  { $sort: { avg_salary: -1 } },
  { $limit: 5 }
]);

// Native bulk write (exact MongoDB format)
const receipt = await db.bulkWrite('users', [
  { insertOne: { document: { name: 'Tim', role: 'admin' } } },
  { updateOne: { filter: { email: 'old@test.com' }, update: { $set: { active: false } } } },
  { deleteOne: { filter: { status: 'banned' } } },
]);
```

## URI Auto-Detection

StrictDB detects the backend from the connection URI:

| URI Scheme | Backend |
|---|---|
| `mongodb://` `mongodb+srv://` | MongoDB |
| `postgresql://` `postgres://` | PostgreSQL |
| `mysql://` | MySQL |
| `mssql://` | MSSQL |
| `file:` `sqlite:` | SQLite |
| `http://` `https://` | Elasticsearch |

## API Reference

### Read Operations

```typescript
db.queryOne<T>(collection, filter, options?)        // → Promise<T | null>
db.queryMany<T>(collection, filter, options?)       // → Promise<T[]>  (MUST include { limit: N })
db.queryWithLookup<T>(collection, lookupOptions)    // → Promise<T | null>
db.count<T>(collection, filter?)                    // → Promise<number>
```

**QueryOptions:** `{ sort?: { field: 1 | -1 }, limit?: number, skip?: number, projection?: { field: 1 | 0 } }`

### Write Operations

All write operations return `OperationReceipt`.

```typescript
db.insertOne<T>(collection, doc)                               // → Promise<OperationReceipt>
db.insertMany<T>(collection, docs)                             // → Promise<OperationReceipt>
db.updateOne<T>(collection, filter, update, upsert?)           // → Promise<OperationReceipt>
db.updateMany<T>(collection, filter, update, options?)         // → Promise<OperationReceipt>
db.deleteOne<T>(collection, filter, options?)                  // → Promise<OperationReceipt>
db.deleteMany<T>(collection, filter, options?)                 // → Promise<OperationReceipt>
db.batch(operations)                                           // → Promise<OperationReceipt>
```

**OperationReceipt:**
```typescript
{
  operation: string;
  collection: string;
  success: boolean;
  matchedCount: number;
  modifiedCount: number;
  insertedCount: number;
  deletedCount: number;
  duration: number;
  backend: 'mongo' | 'sql' | 'elastic';
  insertedId?: string;      // The _id of the inserted document
  insertedIds?: string[];   // Array of _ids for batch inserts
  upsertedId?: string;      // The _id if upsert created a new doc
}
```

### SQL Mode

```typescript
db.sql(sql, options?)  // → Promise<SqlMode2Result | OperationReceipt>
```

**SqlOptions:** `{ params?: any[], dialect?: 'mysql' | 'postgresql', explain?: boolean, raw?: boolean }`

### Native Pipeline

```typescript
db.aggregate<T>(collection, pipeline, options?)    // → Promise<T[]>
db.bulkWrite(collection, operations)               // → Promise<OperationReceipt>
```

### AI-First Discovery

```typescript
// Discover schema — call this BEFORE querying an unfamiliar collection
const schema = await db.describe('users');
// → { name, backend, fields: [{ name, type, required, enum? }], indexes, documentCount, exampleFilter }

// Dry-run validation — catches errors before execution
const check = await db.validate('users', { filter: { role: 'admin' }, doc: { email: 'test@test.com' } });
// → { valid: boolean, errors: [{ field, message, expected, received }] }

// See what runs under the hood
const plan = await db.explain('users', { filter: { role: 'admin' }, limit: 50 });
// → { backend: 'sql', native: 'SELECT * FROM "users" WHERE "role" = $1 LIMIT 50' }
```

### Schema Registration (Optional)

```typescript
import { z } from 'zod';

db.registerCollection({
  name: 'users',
  schema: z.object({
    email: z.string().max(255),
    name: z.string(),
    role: z.enum(['admin', 'user', 'mod']),
    age: z.number().int().optional(),
  }),
  indexes: [{ collection: 'users', fields: { email: 1 }, unique: true }],
});

// Creates tables/indexes from Zod schemas (SQL + ES)
await db.ensureCollections();
await db.ensureIndexes();
```

When `schema: true` is set in the config, all writes are validated against Zod schemas before hitting the database.

### Events

```typescript
db.on('connected', ({ backend, dbName, label }) => {});
db.on('disconnected', ({ backend, reason, timestamp }) => {});
db.on('reconnecting', ({ backend, attempt, maxAttempts, delayMs }) => {});
db.on('reconnected', ({ backend, attempt, downtimeMs }) => {});
db.on('error', ({ code, message, fix, backend }) => {});
db.on('operation', ({ collection, operation, durationMs, receipt }) => {});
db.on('slow-query', ({ collection, operation, durationMs, threshold }) => {});
db.on('guardrail-blocked', ({ collection, operation, reason }) => {});
db.on('shutdown', ({ exitCode }) => {});
```

### Lifecycle

```typescript
db.close();                  // Close connection
db.gracefulShutdown(0);      // Emit shutdown event + close
db.status();                 // → { state, backend, driver, uri, dbName, uptimeMs, pool, reconnect }
db.raw();                    // Escape hatch — native driver access
```

## Filter Operators

StrictDB uses MongoDB-style filter syntax across all backends:

```typescript
{ field: value }                // equality
{ field: { $eq: val } }        // equal
{ field: { $ne: val } }        // not equal
{ field: { $gt: val } }        // greater than
{ field: { $gte: val } }       // greater than or equal
{ field: { $lt: val } }        // less than
{ field: { $lte: val } }       // less than or equal
{ field: { $in: [a, b] } }     // in array
{ field: { $nin: [a, b] } }    // not in array
{ field: { $exists: true } }   // field exists (IS NOT NULL)
{ field: { $exists: false } }  // field missing (IS NULL)
{ field: { $regex: '^Tim' } }  // regex match
{ field: { $not: { $gt: 5 } }} // negate condition
{ field: { $size: 3 } }        // array length
{ $and: [filter1, filter2] }   // all must match
{ $or: [filter1, filter2] }    // any must match
{ $nor: [filter1, filter2] }   // none must match
```

## Update Operators

```typescript
{ $set: { name: 'Bob' } }           // set field value
{ $inc: { views: 1, score: -5 } }   // increment/decrement number
{ $unset: { tempField: true } }     // remove field (set NULL in SQL)
{ $push: { tags: 'new' } }          // add to array
{ $pull: { tags: 'old' } }          // remove from array
```

## Guardrails

Enabled by default. Blocks dangerous operations before they reach the database:

| Blocked | Why | Override |
|---|---|---|
| `deleteMany({})` | Deletes all documents | `{ confirm: 'DELETE_ALL' }` with `{ _id: { $exists: true } }` filter |
| `updateMany({})` | Updates all documents | `{ confirm: 'UPDATE_ALL' }` with `{ _id: { $exists: true } }` filter |
| `deleteOne({})` | Deletes arbitrary document | Specify a filter |
| `queryMany` no limit | Unbounded result set | Always include `{ limit: N }` |

## Error Handling

Every `StrictDBError` includes a `.fix` field:

```typescript
try {
  await db.insertOne('users', { email: 'dupe@test.com' });
} catch (err) {
  if (err instanceof StrictDBError) {
    console.log(err.code);    // 'DUPLICATE_KEY'
    console.log(err.fix);     // 'Use updateOne() instead or check existence with queryOne() first.'
    console.log(err.retryable); // false
  }
}
```

| Code | Retryable | Meaning |
|---|---|---|
| `DUPLICATE_KEY` | No | Unique constraint violated |
| `CONNECTION_FAILED` | Yes | Cannot connect — check URI and server |
| `CONNECTION_LOST` | Yes | Connection dropped — will auto-reconnect |
| `AUTHENTICATION_FAILED` | No | Bad credentials |
| `TIMEOUT` | Yes | Query too slow — add filter, index, or increase timeout |
| `POOL_EXHAUSTED` | Yes | All connections in use |
| `VALIDATION_ERROR` | No | Document fails schema |
| `COLLECTION_NOT_FOUND` | No | Table/index missing — includes fuzzy matching for typos |
| `QUERY_ERROR` | No | Bad query — check field names and operators |
| `GUARDRAIL_BLOCKED` | No | Dangerous operation blocked |
| `UNKNOWN_OPERATOR` | No | Unsupported operator |
| `UNSUPPORTED_OPERATION` | No | Method doesn't exist — suggests StrictDB equivalent |

## Configuration

```typescript
StrictDB.create({
  uri: string,                          // required — auto-detects backend
  pool?: 'high' | 'standard' | 'low',  // connection pool preset
  dbName?: string,                      // override database name
  label?: string,                       // logging label
  schema?: boolean,                     // enable Zod validation on writes (default: false)
  sanitize?: boolean,                   // input sanitization (default: true)
  guardrails?: boolean,                 // dangerous op protection (default: true)
  logging?: boolean | 'verbose',        // structured logging (default: true)
  slowQueryMs?: number,                 // slow query threshold in ms (default: 1000)
  reconnect?: {                         // auto-reconnect with exponential backoff
    enabled?: boolean,
    maxAttempts?: number,               // default: 10
    initialDelayMs?: number,            // default: 1000
    maxDelayMs?: number,                // default: 30000
    backoffMultiplier?: number,         // default: 2
  } | boolean,
  elastic?: {                           // Elasticsearch-specific options
    apiKey?: string,
    caFingerprint?: string,
    sniffOnStart?: boolean,
  },
});
```

## MCP Server

StrictDB ships with an MCP server that exposes 14 tools for AI agents:

```
strictdb_describe        strictdb_validate        strictdb_explain
strictdb_query_one       strictdb_query_many      strictdb_count
strictdb_insert_one      strictdb_insert_many
strictdb_update_one      strictdb_update_many
strictdb_delete_one      strictdb_delete_many
strictdb_batch           strictdb_status
```

Set `STRICTDB_URI` in the environment and start the MCP server to give AI agents full database access through the unified StrictDB API.

## Project Structure

```
src/
  index.ts               # Public API entry point
  types.ts               # All shared types (single source of truth)
  errors.ts              # StrictDBError + self-correcting error mappers
  strictdb.ts            # Main StrictDB class (router + pipeline)
  filter-translator.ts   # Filter → SQL + ES Query DSL translation
  events.ts              # Typed event emitter
  reconnect.ts           # Exponential backoff reconnection manager
  sanitize.ts            # Input sanitization (field whitelists, regex checks)
  guardrails.ts          # Dangerous operation blocker
  receipts.ts            # Structured operation receipts
  logger.ts              # Operation + slow query event logger
  schema.ts              # Zod registry, SQL DDL, ES mapping generation
  adapters/
    adapter.ts           # DatabaseAdapter interface
    mongo-adapter.ts     # MongoDB adapter
    sql-adapter.ts       # PostgreSQL/MySQL/MSSQL/SQLite adapter
    elastic-adapter.ts   # Elasticsearch adapter
  sql/                   # SQL Mode 2 execution engine
    parser.ts            # SQL parser (lazy-loaded)
    planner.ts           # AST → execution plan
    executor.ts          # Three-phase execution
    translators/         # SQL → MongoDB pipeline translators
  translators/           # Backend-agnostic pipeline translators
    sql-filter.ts        # MongoDB filter → SQL WHERE
    sql-builder.ts       # SQL query builders
    elastic-filter.ts    # MongoDB filter → ES Query DSL
    pipeline-sql.ts      # Aggregate pipeline → SQL
    pipeline-elastic.ts  # Aggregate pipeline → ES
  errors/                # Per-backend error mappers
mcp/
  server.ts              # MCP server entry point
  tools.ts               # 14 MCP tool definitions
tests/                            # 627 tests across 28 files
  filter-translator.test.ts  # 71 tests
  errors.test.ts             # 30 tests
  sanitize.test.ts           # 18 tests
  schema.test.ts             # 18 tests
  guardrails.test.ts         # 12 tests
  receipts.test.ts           # 5 tests
  events.test.ts             # 4 tests
```

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run all tests
npm run lint         # Type check without emitting
```

## AI Integration

StrictDB ships with `AI.md` — a token-optimized reference document designed for AI agents. Include it in your AI context to give agents complete knowledge of the StrictDB API, operators, error codes, and guardrails.

## License

MIT
