# Query 051: ROW_NUMBER() OVER (ORDER BY)

## Objective
Test that ROW_NUMBER() window function with an ORDER BY clause translates into a MongoDB pipeline that emulates row numbering via $setWindowFields or a $group + $push + $unwind approach.

## SQL Query
```sql
SELECT
  userId,
  name,
  salary,
  ROW_NUMBER() OVER (ORDER BY salary DESC) AS salaryRank
FROM users
WHERE status = 'active' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $setWindowFields: {
      sortBy: { salary: -1 },
      output: {
        salaryRank: {
          $documentNumber: {}
        }
      }
    }
  },
  {
    $project: {
      userId: 1,
      name: 1,
      salary: 1,
      salaryRank: 1,
      _id: 0
    }
  }
]
```

## Expected Behavior
Each active user receives a unique sequential integer starting from 1, ordered by salary descending. No two documents share the same rank value. If two users have the same salary, the ordering among them is arbitrary but stable within a single execution. The result set is not itself sorted unless an outer ORDER BY is added.

## SQL Constructs Tested
- `ROW_NUMBER()` window function
- `OVER (ORDER BY field DESC)` window specification
- Column alias for computed window value
- `WHERE` pre-filter applied before window computation
- Projection of original fields alongside computed rank
