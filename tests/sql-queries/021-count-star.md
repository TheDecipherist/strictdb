# Query 021: COUNT(*)

## Objective
Tests the simplest aggregate: counting all documents in a collection. Validates that `SELECT COUNT(*)` maps to a `$count` stage (or `$group` with `$sum: 1`) and returns a single document with the count value.

## SQL Query
```sql
SELECT COUNT(*) AS total FROM users;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $count: "total"
  }
]
```

## Expected Behavior
Returns a single document: `{ total: 100 }`. No filtering, no grouping — counts every document in the `users` collection. The alias `total` becomes the field name in the result document.

## SQL Constructs Tested
- `COUNT(*)` → `$count` stage
- Column alias on aggregate result (`AS total`)
- Single-document aggregate result
