# Query 070: NULLIF

## Objective
Test that NULLIF(expr, value) translates into a MongoDB $cond expression that returns null when the expression equals the comparison value, and returns the original expression otherwise — matching the standard NULLIF behavior.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  total,
  discount,
  NULLIF(discount, 0) AS discountOrNull,
  total / NULLIF(discount, 0) AS ratioOrNull
FROM orders
WHERE status = 'completed' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "completed" } },
  {
    $project: {
      orderId: 1,
      userId: 1,
      total: 1,
      discount: 1,
      discountOrNull: {
        $cond: {
          if: { $eq: ["$discount", 0] },
          then: null,
          else: "$discount"
        }
      },
      ratioOrNull: {
        $cond: {
          if: { $eq: ["$discount", 0] },
          then: null,
          else: { $divide: ["$total", "$discount"] }
        }
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For completed orders, NULLIF(discount, 0) returns null when discount is zero, and the actual discount value otherwise. This is primarily used to guard against division by zero: total / NULLIF(discount, 0) returns null instead of throwing a divide-by-zero error when discount is 0. When discount is non-zero, the ratio is computed normally. The pattern maps cleanly to a $cond with an $eq check.

## SQL Constructs Tested
- `NULLIF(expr, value)` returning null on equality match
- `NULLIF` as a division guard (prevents divide-by-zero)
- Nested `NULLIF` inside a division expression
- Translation to $cond with $eq check
- Null as the "then" branch in $cond
