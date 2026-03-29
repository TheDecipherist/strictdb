# Query 055: LEAD with Offset

## Objective
Test that LEAD() with an explicit offset translates into a MongoDB pipeline using $shift with a positive offset, allowing access to a future document's field value within the window partition.

## SQL Query
```sql
SELECT
  sessionId,
  userId,
  startedAt,
  pageViews,
  LEAD(startedAt, 1) OVER (PARTITION BY userId ORDER BY startedAt ASC) AS nextSessionStart
FROM sessions
WHERE isActive = false LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { isActive: false } },
  {
    $setWindowFields: {
      partitionBy: "$userId",
      sortBy: { startedAt: 1 },
      output: {
        nextSessionStart: {
          $shift: {
            output: "$startedAt",
            by: 1,
            default: null
          }
        }
      }
    }
  },
  {
    $project: {
      sessionId: 1,
      userId: 1,
      startedAt: 1,
      pageViews: 1,
      nextSessionStart: 1,
      _id: 0
    }
  }
]
```

## Expected Behavior
For each completed (inactive) session, the query retrieves the start time of the next session by the same user. The last session per user has no subsequent document so nextSessionStart is null. A positive shift of 1 looks one document ahead within the partition. Sessions are partitioned per user and ordered by start time ascending.

## SQL Constructs Tested
- `LEAD(field, offset)` window function
- Positive offset (look-ahead by 1)
- `OVER (PARTITION BY ... ORDER BY ASC)` window specification
- Default null for last row in partition
- Boolean equality filter in `WHERE`
