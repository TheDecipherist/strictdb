# Query 031: INNER JOIN

## Objective
Tests a basic INNER JOIN between two collections. Validates that `JOIN ... ON` maps to a `$lookup` stage followed by `$unwind` (to flatten the joined array) and an implicit match that drops documents with no join match.

## SQL Query
```sql
SELECT o.orderId, o.total, o.status, u.name, u.email
FROM orders o
INNER JOIN users u ON o.userId = u.userId
LIMIT 20;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "userId",
      as: "user"
    }
  },
  {
    $unwind: {
      path: "$user",
      preserveNullAndEmpty: false
    }
  },
  {
    $limit: 20
  },
  {
    $project: {
      _id: 0,
      orderId: 1,
      total: 1,
      status: 1,
      "user.name": 1,
      "user.email": 1
    }
  }
]
```

## Expected Behavior
Returns up to 20 orders with the associated user's name and email embedded. Orders with no matching user (orphaned orders) are excluded because `preserveNullAndEmpty: false` in `$unwind` drops unmatched documents — equivalent to INNER JOIN semantics.

## SQL Constructs Tested
- `INNER JOIN ... ON field = field` → `$lookup` + `$unwind` (drop nulls)
- Table aliases (`o`, `u`) for disambiguating columns
- Cross-collection field projection using dot notation
- INNER JOIN null exclusion via `preserveNullAndEmpty: false`
