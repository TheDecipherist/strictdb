# Query 044: COUNT with GROUP BY and ORDER BY

## Objective
Tests the common pattern of counting per group and sorting the results. Validates that `GROUP BY` + `COUNT(*)` + `ORDER BY` generates a `$group` → `$sort` → `$project` pipeline in the correct order, with sort referencing the computed aggregate field.

## SQL Query
```sql
SELECT status, COUNT(*) AS order_count
FROM orders
GROUP BY status
ORDER BY order_count DESC;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: "$status",
      order_count: { $sum: 1 }
    }
  },
  {
    $sort: { order_count: -1 }
  },
  {
    $project: {
      _id: 0,
      status: "$_id",
      order_count: 1
    }
  }
]
```

## Expected Behavior
Returns one document per order status (e.g., `"pending"`, `"shipped"`, `"delivered"`, `"cancelled"`), sorted from the most frequent status to the least. The `ORDER BY` references the computed alias `order_count`, which requires the sort to occur after the `$group` stage.

## SQL Constructs Tested
- `GROUP BY` + `COUNT(*)` + `ORDER BY <aggregate_alias>`
- `$sort` on a computed accumulator field (not an original document field)
- `$sort` after `$group` in pipeline
- `ORDER BY aggregate_alias DESC` → `$sort: { field: -1 }` post-group
