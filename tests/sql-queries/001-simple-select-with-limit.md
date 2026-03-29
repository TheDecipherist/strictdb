# Query 001: Simple SELECT * with LIMIT

## Objective
Tests the most basic query form: retrieve all columns from a collection with a row cap. Validates that SQL Mode 2 maps `SELECT *` to an empty projection and `LIMIT n` to `$limit`.

## SQL Query
```sql
SELECT * FROM users LIMIT 10;
```

## Expected MongoDB Pipeline
```javascript
[
  { $limit: 10 }
]
```

## Expected Behavior
Returns the first 10 documents from the `users` collection with all fields included. No filtering, no sorting — documents are returned in natural insertion order.

## SQL Constructs Tested
- `SELECT *` (wildcard projection — all fields)
- `FROM <collection>`
- `LIMIT n`
