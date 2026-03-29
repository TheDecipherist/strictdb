# Query 040: Column Aliases (AS)

## Objective
Tests `AS` aliases on plain column references (not aggregates). Validates that `SELECT field AS alias` maps to a `$project` stage that renames the field by using `"$field"` as the expression value for the alias key.

## SQL Query
```sql
SELECT
  userId          AS id,
  name            AS full_name,
  email           AS contact_email,
  salary          AS annual_salary,
  department      AS team
FROM users
WHERE status = 'active'
LIMIT 5;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      status: { $eq: "active" }
    }
  },
  {
    $limit: 5
  },
  {
    $project: {
      _id: 0,
      id:             "$userId",
      full_name:      "$name",
      contact_email:  "$email",
      annual_salary:  "$salary",
      team:           "$department"
    }
  }
]
```

## Expected Behavior
Returns up to 5 active users with renamed fields: `id`, `full_name`, `contact_email`, `annual_salary`, and `team`. The original field names do not appear in the output. This tests that the alias mapping in `$project` uses expression syntax rather than inclusion syntax.

## SQL Constructs Tested
- `SELECT field AS alias` → `$project: { alias: "$field" }` (expression rename)
- Multiple column aliases in a single SELECT
- Combined with WHERE and LIMIT
- `_id` suppression alongside renamed fields
