# Query 056: UPPER in SELECT

## Objective
Test that UPPER() applied to a string field in the SELECT list translates into a MongoDB $toUpper expression within a $project stage, returning the field value in all uppercase.

## SQL Query
```sql
SELECT
  userId,
  UPPER(name) AS nameUpper,
  UPPER(email) AS emailUpper,
  role
FROM users
WHERE status = 'active' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      nameUpper: { $toUpper: "$name" },
      emailUpper: { $toUpper: "$email" },
      role: 1,
      _id: 0
    }
  }
]
```

## Expected Behavior
Each active user row returns userId and role unchanged, with name and email transformed to uppercase strings. The original name and email fields are not included unless also listed. The transformation is applied in the projection stage and does not affect stored values in the database.

## SQL Constructs Tested
- `UPPER(field)` string function in SELECT
- Multiple UPPER calls in same projection
- Column aliases for computed string values
- Mix of raw fields and computed fields in projection
- `WHERE` equality filter
