# Query 062: ABS of Negative Expression

## Objective
Test that ABS() applied to a field or expression translates into a MongoDB $abs expression, returning the absolute (non-negative) value of the input regardless of sign.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  total,
  discount,
  ABS(total - discount) AS netTotal,
  ABS(discount) AS absDiscount
FROM orders
WHERE status = 'refunded' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "refunded" } },
  {
    $project: {
      orderId: 1,
      userId: 1,
      total: 1,
      discount: 1,
      netTotal: {
        $abs: { $subtract: ["$total", "$discount"] }
      },
      absDiscount: {
        $abs: "$discount"
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each refunded order, the query returns the absolute value of (total minus discount) as netTotal, ensuring negative results (where discount exceeds total) are returned as positive. absDiscount returns the absolute value of the discount field. Refunded orders may have negative or unusual values, so ABS ensures the output is always non-negative. The original fields are also included for comparison.

## SQL Constructs Tested
- `ABS(expression)` with a compound arithmetic expression inside
- `ABS(field)` applied directly to a field reference
- `$subtract` as inner expression inside $abs
- Column aliases for both computed values
- `WHERE` equality filter on status field
