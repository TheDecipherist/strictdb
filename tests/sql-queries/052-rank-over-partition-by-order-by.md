# Query 052: RANK() OVER (PARTITION BY ... ORDER BY)

## Objective
Test that RANK() partitioned by a field translates into a MongoDB pipeline that assigns ranks within each partition group, with gaps in rank values when ties occur.

## SQL Query
```sql
SELECT
  employeeId,
  name,
  department,
  salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS deptRank
FROM employees
WHERE isRemote = false LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { isRemote: false } },
  {
    $setWindowFields: {
      partitionBy: "$department",
      sortBy: { salary: -1 },
      output: {
        deptRank: {
          $rank: {}
        }
      }
    }
  },
  {
    $project: {
      employeeId: 1,
      name: 1,
      department: 1,
      salary: 1,
      deptRank: 1,
      _id: 0
    }
  }
]
```

## Expected Behavior
Within each department partition, employees are ranked by salary descending. Employees with identical salaries receive the same rank. The next rank after a tie skips values equal to the number of tied documents (e.g., two employees tied at rank 1 means the next rank is 3). Each department restarts ranking at 1. Only non-remote employees are included.

## SQL Constructs Tested
- `RANK()` window function
- `OVER (PARTITION BY field ORDER BY field DESC)` full window specification
- Partitioned window computation
- Rank gap behavior on ties
- `WHERE` pre-filter on boolean field
