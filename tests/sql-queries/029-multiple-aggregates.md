# Query 029: Multiple Aggregates in One Query

## Objective
Tests a query with several different aggregate functions computed simultaneously. Validates that `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX` can all appear in a single `$group` stage, each producing its own named field.

## SQL Query
```sql
SELECT
  COUNT(*)      AS total_orders,
  SUM(total)    AS total_revenue,
  AVG(total)    AS avg_order_value,
  MIN(total)    AS min_order,
  MAX(total)    AS max_order
FROM orders;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: null,
      total_orders: { $sum: 1 },
      total_revenue: { $sum: "$total" },
      avg_order_value: { $avg: "$total" },
      min_order: { $min: "$total" },
      max_order: { $max: "$total" }
    }
  },
  {
    $project: {
      _id: 0,
      total_orders: 1,
      total_revenue: 1,
      avg_order_value: 1,
      min_order: 1,
      max_order: 1
    }
  }
]
```

## Expected Behavior
Returns a single document with five aggregate values computed over all 300 orders — total count, total revenue, average order value, cheapest order, and most expensive order. All computed in one pipeline pass.

## SQL Constructs Tested
- Five aggregate functions in one SELECT: `COUNT(*)`, `SUM`, `AVG`, `MIN`, `MAX`
- All five mapped to a single `$group` stage with `_id: null`
- Individual column aliases for each aggregate
- `$project` stripping `_id` and exposing all aliased fields
