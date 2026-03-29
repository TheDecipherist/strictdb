# Query 028: GROUP BY with HAVING

## Objective
Tests post-aggregation filtering with `HAVING`. Validates that `HAVING` translates to a `$match` stage placed **after** the `$group` stage in the pipeline (not before), filtering on the computed aggregate values.

## SQL Query
```sql
SELECT department, COUNT(*) AS headcount, AVG(salary) AS avg_salary
FROM users
GROUP BY department
HAVING COUNT(*) > 5 AND AVG(salary) > 70000;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: "$department",
      headcount: { $sum: 1 },
      avg_salary: { $avg: "$salary" }
    }
  },
  {
    $match: {
      $and: [
        { headcount: { $gt: 5 } },
        { avg_salary: { $gt: 70000 } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      department: "$_id",
      headcount: 1,
      avg_salary: 1
    }
  }
]
```

## Expected Behavior
Returns only departments with more than 5 employees AND an average salary above $70,000. Departments like "Engineering" are likely to appear; smaller or lower-paying departments are filtered out. The `HAVING` filter runs on aggregated values, not raw document fields.

## SQL Constructs Tested
- `HAVING` clause → post-`$group` `$match` stage
- `HAVING` with `COUNT(*)` threshold → `$match` on computed field
- `HAVING` with `AVG()` threshold → `$match` on computed field
- `AND` in `HAVING` → `$and` in post-group `$match`
- Pipeline stage ordering: `$group` before `$match` before `$project`
