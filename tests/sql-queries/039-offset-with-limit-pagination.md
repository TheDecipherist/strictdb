# Query 039: OFFSET with LIMIT (Pagination)

## Objective
Tests cursor-style pagination using `LIMIT` and `OFFSET`. Validates that `LIMIT n OFFSET m` maps to a `$skip` stage followed by a `$limit` stage in the correct order, implementing the standard SQL pagination pattern.

## SQL Query
```sql
SELECT userId, name, email, createdAt
FROM users
ORDER BY createdAt ASC
LIMIT 10 OFFSET 20;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $sort: { createdAt: 1 }
  },
  {
    $skip: 20
  },
  {
    $limit: 10
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      email: 1,
      createdAt: 1
    }
  }
]
```

## Expected Behavior
Returns users 21–30 when sorted by `createdAt` ascending (0-indexed: skip the first 20, then take the next 10). This is page 3 of a 10-items-per-page paginated result. `ORDER BY` is required for deterministic pagination.

## SQL Constructs Tested
- `LIMIT n OFFSET m` → `$skip: m` then `$limit: n`
- `$skip` before `$limit` in pipeline (order is critical)
- Paginated query with `ORDER BY` for determinism
- Page 3 (offset = 20, limit = 10) of a 100-document set
