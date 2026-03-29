# Query 041: CASE WHEN Simple

## Objective
Tests a simple `CASE WHEN ... THEN ... ELSE ... END` expression. Validates that `CASE WHEN` maps to a `$addFields` stage using `$switch` (with `branches`) or `$cond` (for two-branch cases), producing a computed field in the result.

## SQL Query
```sql
SELECT
  userId,
  name,
  salary,
  CASE
    WHEN salary >= 100000 THEN 'high'
    WHEN salary >= 60000  THEN 'medium'
    ELSE 'low'
  END AS salary_tier
FROM users
LIMIT 20;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $limit: 20
  },
  {
    $addFields: {
      salary_tier: {
        $switch: {
          branches: [
            { case: { $gte: ["$salary", 100000] }, then: "high" },
            { case: { $gte: ["$salary", 60000] },  then: "medium" }
          ],
          default: "low"
        }
      }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      salary: 1,
      salary_tier: 1
    }
  }
]
```

## Expected Behavior
Returns 20 users, each with an added `salary_tier` field: `"high"` for salaries at or above $100,000, `"medium"` for $60,000–$99,999, and `"low"` for under $60,000. The computed field is added via `$addFields` and then projected.

## SQL Constructs Tested
- `CASE WHEN condition THEN value ... ELSE default END` → `$switch` with `branches`
- Multiple WHEN branches with numeric comparisons
- `ELSE` clause → `default` in `$switch`
- `$addFields` for computed column
- Column alias on CASE expression (`AS salary_tier`)
