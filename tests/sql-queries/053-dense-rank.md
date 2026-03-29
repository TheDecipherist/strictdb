# Query 053: DENSE_RANK()

## Objective
Test that DENSE_RANK() translates correctly, producing consecutive rank values with no gaps when ties occur, unlike RANK() which leaves gaps.

## SQL Query
```sql
SELECT
  userId,
  name,
  score,
  DENSE_RANK() OVER (ORDER BY score DESC) AS scoreRank
FROM users
WHERE status = 'active'
ORDER BY scoreRank ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $setWindowFields: {
      sortBy: { score: -1 },
      output: {
        scoreRank: {
          $denseRank: {}
        }
      }
    }
  },
  {
    $project: {
      userId: 1,
      name: 1,
      score: 1,
      scoreRank: 1,
      _id: 0
    }
  },
  { $sort: { scoreRank: 1 } }
]
```

## Expected Behavior
Active users are assigned a dense rank based on score descending. Multiple users with the same score receive the same rank, and the next distinct score receives the immediately following integer rank with no gap. The final result is ordered by rank ascending. This is distinct from RANK() behavior where ties cause gaps.

## SQL Constructs Tested
- `DENSE_RANK()` window function
- No-gap rank assignment on ties
- `OVER (ORDER BY field DESC)` without PARTITION BY
- Outer `ORDER BY` on computed alias
- Behavioral difference from `RANK()` (no skipped values)
