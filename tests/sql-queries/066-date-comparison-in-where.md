# Query 066: Date Comparison in WHERE

## Objective
Test that date comparisons in a WHERE clause (greater than, less than, between) translate into MongoDB $gt, $lt, $gte, $lte filters with proper ISO 8601 date values or Date objects.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  total,
  status,
  createdAt
FROM orders
WHERE createdAt >= '2024-01-01'
  AND createdAt < '2025-01-01'
  AND status = 'completed' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      createdAt: {
        $gte: new Date("2024-01-01T00:00:00.000Z"),
        $lt: new Date("2025-01-01T00:00:00.000Z")
      },
      status: "completed"
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
  }
]
```

## Expected Behavior
Only completed orders created within the calendar year 2024 are returned. The >= 2024-01-01 lower bound is inclusive and the < 2025-01-01 upper bound is exclusive, together forming a closed-open date range covering the full year. Date strings from SQL are parsed into Date objects for MongoDB comparison. Times not specified in the SQL date literal default to midnight UTC (00:00:00.000Z).

## SQL Constructs Tested
- `>=` and `<` comparison operators on date fields
- ISO 8601 date string literals in WHERE
- Date string to Date object conversion
- Compound AND combining date range and string equality
- Inclusive lower bound, exclusive upper bound pattern
