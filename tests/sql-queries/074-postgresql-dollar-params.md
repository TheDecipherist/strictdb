# Query 074: PostgreSQL $1 Style Params

## Objective
Test that PostgreSQL-style numbered parameters ($1, $2, $3, ...) in a parameterized query are correctly substituted with the corresponding values from the params array using 1-based index lookup before translation into a MongoDB filter.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  total,
  status,
  createdAt
FROM orders
WHERE userId = $1
  AND status = $2
  AND total >= $3
  AND createdAt >= $4
ORDER BY createdAt DESC
LIMIT $5;
```

## Parameters Array
```javascript
["user_xyz789", "completed", 50.00, "2024-01-01", 25]
```

## Expected MongoDB Pipeline (after param substitution)
```javascript
[
  {
    $match: {
      userId: "user_xyz789",
      status: "completed",
      total: { $gte: 50.00 },
      createdAt: { $gte: new Date("2024-01-01T00:00:00.000Z") }
    }
  },
  {
    $project: {
      orderId: 1,
      userId: 1,
      total: 1,
      status: 1,
      createdAt: 1,
      _id: 0
    }
  },
  { $sort: { createdAt: -1 } },
  { $limit: 25 }
]
```

## Expected Behavior
Each $N placeholder is replaced by params[N-1] (1-based indexing). $1 becomes "user_xyz789", $2 becomes "completed", $3 becomes 50.00, $4 becomes "2024-01-01", $5 becomes 25. Parameters can be reused in the same query by referencing the same number multiple times. Date strings in parameter position are recognized and converted to Date objects during translation. Numeric parameters become numeric comparisons.

## SQL Constructs Tested
- PostgreSQL `$1`, `$2`, `$3`, `$4`, `$5` numbered parameter placeholders
- 1-based index mapping from placeholder number to params array
- Five parameters of mixed types (string, string, number, date string, number)
- Date string parameter converted to Date object in $match
- `$N` as the LIMIT value
- Parameters in both equality and comparison conditions
