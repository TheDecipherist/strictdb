# Query 043: UPPER / LOWER Functions

## Objective
Tests string transformation functions `UPPER()` and `LOWER()`. Validates that these SQL functions map to MongoDB's `$toUpper` and `$toLower` string operators in an `$addFields` or `$project` stage.

## SQL Query
```sql
SELECT
  userId,
  UPPER(name)       AS name_upper,
  LOWER(email)      AS email_lower,
  UPPER(department) AS dept_upper
FROM users
WHERE role = 'admin'
LIMIT 5;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      role: { $eq: "admin" }
    }
  },
  {
    $limit: 5
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name_upper:  { $toUpper: "$name" },
      email_lower: { $toLower: "$email" },
      dept_upper:  { $toUpper: "$department" }
    }
  }
]
```

## Expected Behavior
Returns up to 5 admin users. Each result has `name_upper` (e.g., `"ALICE JOHNSON"`), `email_lower` (e.g., `"alice@example.com"`), and `dept_upper` (e.g., `"ENGINEERING"`). The `$toUpper` and `$toLower` operators are applied inline in the `$project` stage as expression operators.

## SQL Constructs Tested
- `UPPER(field)` → `$toUpper: "$field"` in `$project`
- `LOWER(field)` → `$toLower: "$field"` in `$project`
- String function operators in projection expressions
- Mixed function calls across multiple columns
