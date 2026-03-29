# Query 054: LAG with Offset

## Objective
Test that LAG() with an explicit offset value translates into a MongoDB pipeline using $shift with a negative offset, allowing access to a previous document's field value within the window partition.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  total,
  createdAt,
  LAG(total, 1) OVER (PARTITION BY userId ORDER BY createdAt ASC) AS previousOrderTotal
FROM orders
WHERE status != 'cancelled' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: { $ne: "cancelled" } } },
  {
    $setWindowFields: {
      partitionBy: "$userId",
      sortBy: { createdAt: 1 },
      output: {
        previousOrderTotal: {
          $shift: {
            output: "$total",
            by: -1,
            default: null
          }
        }
      }
    }
  },
  {
    $project: {
      orderId: 1,
      userId: 1,
      total: 1,
      createdAt: 1,
      previousOrderTotal: 1,
      _id: 0
    }
  }
]
```

## Expected Behavior
For each non-cancelled order, the query retrieves the total from the previous order placed by the same user (ordered chronologically). The first order per user has no preceding document so previousOrderTotal is null. LAG offset of 1 means one document back. Results are partitioned per user so order history does not bleed across users.

## SQL Constructs Tested
- `LAG(field, offset)` window function
- Explicit numeric offset (1)
- `OVER (PARTITION BY ... ORDER BY ASC)` with ascending sort
- Default null value for first row in partition
- `WHERE` inequality filter on string field
