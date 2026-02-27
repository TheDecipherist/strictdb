# strictdb-mcp

MCP server for [StrictDB](https://www.npmjs.com/package/strictdb) — AI agents talk to any database through one unified interface.

Connect Claude, GPT, or any MCP-compatible client to MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, or Elasticsearch. StrictDB's guardrails, sanitization, and self-correcting errors are enforced on every tool call.

**[Full Documentation](https://strictdb.com/)** | **[GitHub](https://github.com/TheDecipherist/strictdb)** | **[strictdb on npm](https://www.npmjs.com/package/strictdb)**

## Install

```bash
npm install strictdb-mcp
```

You also need the database driver for your backend:

```bash
npm install mongodb        # MongoDB
npm install pg             # PostgreSQL
npm install mysql2         # MySQL
npm install mssql          # MSSQL
npm install better-sqlite3 # SQLite
npm install @elastic/elasticsearch # Elasticsearch
```

## Usage

Set the `STRICTDB_URI` environment variable and run the server:

```bash
STRICTDB_URI="postgresql://user:pass@localhost:5432/mydb" npx strictdb-mcp
```

### Claude Desktop Configuration

Add this to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "strictdb": {
      "command": "npx",
      "args": ["strictdb-mcp"],
      "env": {
        "STRICTDB_URI": "postgresql://user:pass@localhost:5432/mydb"
      }
    }
  }
}
```

### Claude Code Configuration

```bash
claude mcp add strictdb -- npx strictdb-mcp
```

Then set the environment variable in your shell before launching Claude Code:

```bash
export STRICTDB_URI="postgresql://user:pass@localhost:5432/mydb"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRICTDB_URI` | Yes | Database connection URI (auto-detects backend) |
| `STRICTDB_DB_NAME` | No | Override the database name from the URI |
| `STRICTDB_ES_API_KEY` | No | Elasticsearch API key (if using ES with auth) |

## Available Tools (14)

### Discovery & Validation

| Tool | Description |
|------|-------------|
| `strictdb_describe` | Discover the schema of a collection — call this BEFORE writing any query |
| `strictdb_validate` | Dry-run validate an operation without executing it |
| `strictdb_explain` | Show the native query that would be executed |
| `strictdb_status` | Check database connection health |

### Read Operations

| Tool | Description |
|------|-------------|
| `strictdb_query_one` | Find a single document matching the filter |
| `strictdb_query_many` | Find multiple documents (always include a limit) |
| `strictdb_count` | Count documents matching the filter |

### Write Operations

| Tool | Description |
|------|-------------|
| `strictdb_insert_one` | Insert a single document |
| `strictdb_insert_many` | Insert multiple documents |
| `strictdb_update_one` | Update a single document matching the filter |
| `strictdb_update_many` | Update all documents matching the filter |
| `strictdb_delete_one` | Delete a single document matching the filter |
| `strictdb_delete_many` | Delete all documents matching the filter (requires non-empty filter) |
| `strictdb_batch` | Execute multiple operations in a single optimized batch |

## Filter Syntax

All tools that accept a `filter` parameter use MongoDB-style syntax, regardless of backend:

```json
{ "status": "active" }
{ "age": { "$gte": 18 } }
{ "role": { "$in": ["admin", "mod"] } }
{ "$or": [{ "status": "active" }, { "role": "admin" }] }
```

Supported operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$not`, `$size`, `$and`, `$or`, `$nor`.

## Safety

All StrictDB guardrails are enforced automatically:

- **Empty filter blocking** — `deleteMany` and `updateMany` with `{}` are rejected
- **Unbounded query blocking** — `queryMany` requires a `limit`
- **SQL field validation** — column names are whitelisted to prevent injection
- **ES internal field blocking** — fields starting with `_` are blocked
- **Regex complexity validation** — ReDoS patterns are rejected
- **Self-correcting errors** — every error includes a `.fix` field with actionable instructions

## Supported Databases

| Database | URI Scheme | Driver |
|----------|-----------|--------|
| MongoDB | `mongodb://` `mongodb+srv://` | `mongodb` |
| PostgreSQL | `postgresql://` `postgres://` | `pg` |
| MySQL | `mysql://` | `mysql2` |
| MSSQL | `mssql://` | `mssql` |
| SQLite | `sqlite://` `file:` | `better-sqlite3` |
| Elasticsearch | `http://` `https://` | `@elastic/elasticsearch` |

## Related

- [strictdb](https://www.npmjs.com/package/strictdb) — Core library
- [Full Documentation](https://strictdb.com/) — Complete docs with examples
- [GitHub](https://github.com/TheDecipherist/strictdb) — Source code and issues

## License

MIT
