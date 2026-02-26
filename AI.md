# StrictDB — AI Context Reference

> Token-optimized. Read once, know everything. Auto-generated from TypeScript types.

## Setup

```typescript
import { StrictDB } from 'strictdb';
const db = await StrictDB.create({ uri: process.env.STRICTDB_URI });
```

URI auto-detects backend: `mongodb://` `mongodb+srv://` → Mongo | `postgresql://` `postgres://` `mysql://` `mssql://` `file:` `sqlite:` → SQL | `http://` `https://` → Elasticsearch

## BEFORE ANY QUERY

```typescript
const schema = await db.describe('collectionName'); // Returns fields, types, enums, indexes, example filter
const check = await db.validate('collectionName', { filter, update, doc }); // Dry-run — catches errors before execution
```

**Always call `describe()` first. Never guess field names or types.**

---

## Read Operations

```typescript
db.queryOne<T>(collection, filter, options?) → Promise<T | null>
db.queryMany<T>(collection, filter, options?) → Promise<T[]>       // MUST include { limit: N }
db.queryWithLookup<T>(collection, lookupOptions) → Promise<T | null>
db.count<T>(collection, filter?) → Promise<number>
```

**QueryOptions:** `{ sort?: { field: 1 | -1 }, limit?: number, skip?: number, projection?: { field: 1 | 0 } }`

## Write Operations — All return `OperationReceipt`

```typescript
db.insertOne<T>(collection, doc) → Promise<OperationReceipt>
db.insertMany<T>(collection, docs) → Promise<OperationReceipt>
db.updateOne<T>(collection, filter, update, upsert?) → Promise<OperationReceipt>
db.updateMany<T>(collection, filter, update, options?) → Promise<OperationReceipt>
db.deleteOne<T>(collection, filter, options?) → Promise<OperationReceipt>
db.deleteMany<T>(collection, filter, options?) → Promise<OperationReceipt>
db.batch(operations) → Promise<OperationReceipt>
```

**OperationReceipt:** `{ operation, collection, success, matchedCount, modifiedCount, insertedCount, deletedCount, duration, backend }`

## Filter Operators

```
{ field: value }              → equality
{ field: { $eq: val } }       → equal
{ field: { $ne: val } }       → not equal
{ field: { $gt: val } }       → greater than
{ field: { $gte: val } }      → greater than or equal
{ field: { $lt: val } }       → less than
{ field: { $lte: val } }      → less than or equal
{ field: { $in: [a, b] } }    → in array
{ field: { $nin: [a, b] } }   → not in array
{ field: { $exists: true } }   → field exists (IS NOT NULL)
{ field: { $exists: false } }  → field missing (IS NULL)
{ field: { $regex: '^Tim' } }  → regex match
{ field: { $not: { $gt: 5 } } } → negate condition
{ field: { $size: 3 } }       → array length
{ $and: [filter1, filter2] }  → all must match
{ $or: [filter1, filter2] }   → any must match
{ $nor: [filter1, filter2] }  → none must match
```

## Update Operators

```
{ $set: { name: 'Bob' } }           → set field value
{ $inc: { views: 1, score: -5 } }   → increment/decrement number
{ $unset: { tempField: true } }      → remove field (set NULL in SQL)
{ $push: { tags: 'new' } }           → add to array
{ $pull: { tags: 'old' } }           → remove from array
```

## Guardrails (enabled by default)

| Blocked | Why | Override |
|---------|-----|----------|
| `deleteMany({})` | Deletes all documents | `db.deleteMany('col', { _id: { $exists: true } }, { confirm: 'DELETE_ALL' })` |
| `updateMany({})` | Updates all documents | `db.updateMany('col', { _id: { $exists: true } }, update, { confirm: 'UPDATE_ALL' })` |
| `deleteOne({})` | Deletes arbitrary document | Specify a filter |
| `queryMany` no limit | Unbounded result set | Always include `{ limit: N }` |

## Error Codes

| Code | Retryable | Meaning |
|------|-----------|---------|
| `DUPLICATE_KEY` | No | Unique constraint violated — use updateOne() or check existence first |
| `CONNECTION_FAILED` | Yes | Cannot connect — check URI and server |
| `CONNECTION_LOST` | Yes | Connection dropped — will auto-reconnect |
| `AUTHENTICATION_FAILED` | No | Bad credentials — check username/password |
| `TIMEOUT` | Yes | Query too slow — add filter, add index, or increase timeout |
| `POOL_EXHAUSTED` | Yes | All connections in use — increase pool or fix leaks |
| `VALIDATION_ERROR` | No | Document fails schema — fix data to match schema |
| `COLLECTION_NOT_FOUND` | No | Table/index missing — run ensureCollections() |
| `QUERY_ERROR` | No | Bad query — check field names and operator usage |
| `GUARDRAIL_BLOCKED` | No | Dangerous operation — see guardrails table above |
| `UNKNOWN_OPERATOR` | No | Unsupported operator — see operator list above |
| `UNSUPPORTED_OPERATION` | No | Method doesn't exist — check API above |

Every error includes a `.fix` field with the exact corrective action.

## Events

```typescript
db.on('connected', ({ backend, dbName, label }) => {})
db.on('disconnected', ({ backend, reason, timestamp }) => {})
db.on('reconnecting', ({ backend, attempt, maxAttempts, delayMs }) => {})
db.on('reconnected', ({ backend, attempt, downtimeMs }) => {})
db.on('error', ({ code, message, fix, backend }) => {})
db.on('operation', ({ collection, operation, durationMs, receipt }) => {})
db.on('slow-query', ({ collection, operation, durationMs, threshold }) => {})
db.on('guardrail-blocked', ({ collection, operation, reason }) => {})
db.on('shutdown', ({ exitCode }) => {})
```

## Schema Registration (Optional)

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

await db.ensureCollections(); // Creates tables/indexes
await db.ensureIndexes();
```

## Config

```typescript
StrictDB.create({
  uri: string,                           // required — auto-detects backend
  pool?: 'high' | 'standard' | 'low',   // connection pool size
  dbName?: string,                       // override database name
  label?: string,                        // logging label
  schema?: boolean,                      // enable Zod validation on writes (default: false)
  sanitize?: boolean,                    // input sanitization (default: true)
  guardrails?: boolean,                  // dangerous op protection (default: true)
  logging?: boolean | 'verbose',         // structured logging (default: true)
  slowQueryMs?: number,                  // slow query threshold ms (default: 1000)
  reconnect?: { enabled, maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier } | boolean,
  elastic?: { apiKey?, caFingerprint?, sniffOnStart? },
})
```

## Banned Patterns — NEVER DO

```
❌ import { MongoClient } from 'mongodb'
❌ import pg from 'pg'
❌ import mongoose from 'mongoose'
❌ import { PrismaClient } from '@prisma/client'
❌ import { drizzle } from 'drizzle-orm'
❌ db.collection('users').find()
❌ pool.query('SELECT * FROM users')
❌ client.search({ index: 'users' })

✅ import { StrictDB } from 'strictdb'
✅ db.queryMany('users', { role: 'admin' }, { limit: 50 })
```

## Quick Examples

```typescript
// Find one user
const user = await db.queryOne('users', { email: 'tim@example.com' });

// Find active admins, sorted by newest
const admins = await db.queryMany('users', {
  role: 'admin',
  status: { $in: ['active', 'pending'] },
  age: { $gte: 18 }
}, { sort: { createdAt: -1 }, limit: 50 });

// Update with increment
const receipt = await db.updateOne('users',
  { email: 'tim@example.com' },
  { $set: { role: 'admin' }, $inc: { loginCount: 1 } }
);

// Batch operations
const receipt = await db.batch([
  { operation: 'insertOne', collection: 'orders', doc: { item: 'widget', qty: 5 } },
  { operation: 'updateOne', collection: 'inventory', filter: { sku: 'W1' }, update: { $inc: { stock: -5 } } },
]);

// See what runs under the hood
const plan = await db.explain('users', { filter: { role: 'admin' }, limit: 50 });
```

## Lifecycle

```typescript
db.close()                    // close connection
db.gracefulShutdown(0)        // emit shutdown event + close
db.status()                   // { state, backend, driver, uri, dbName, uptimeMs, pool, reconnect }
db.raw()                      // escape hatch — native driver access
```
