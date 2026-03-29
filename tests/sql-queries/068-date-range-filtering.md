# Query 068: Date Range Filtering

## Objective
Test that BETWEEN applied to a date field translates into a MongoDB range filter with both $gte and $lte bounds inclusive, correctly handling date-only strings that need time component defaults.

## SQL Query
```sql
SELECT
  eventId,
  userId,
  type,
  page,
  timestamp
FROM events
WHERE timestamp BETWEEN '2024-06-01' AND '2024-06-30'
  AND type = 'pageview'
ORDER BY timestamp ASC
LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      timestamp: {
        $gte: new Date("2024-06-01T00:00:00.000Z"),
        $lte: new Date("2024-06-30T23:59:59.999Z")
      },
      type: "pageview"
    }
  },
  {
    $project: {
      eventId: 1,
      userId: 1,
      type: 1,
      page: 1,
      timestamp: 1,
      _id: 0
    }
  },
  { $sort: { timestamp: 1 } },
  { $limit: 100 }
]
```

## Expected Behavior
Returns up to 100 pageview events from June 2024, ordered chronologically. The BETWEEN operator is inclusive on both ends. The end date 2024-06-30 without a time component is expanded to end-of-day (23:59:59.999Z) to include all events on that calendar day. The LIMIT is applied after the sort so the earliest 100 matching events are returned.

## SQL Constructs Tested
- `BETWEEN date AND date` inclusive range on date field
- End-of-day expansion for date-only upper bound
- `AND` combining date range with string equality
- `ORDER BY` on date field ascending
- `LIMIT` applied after filter and sort
