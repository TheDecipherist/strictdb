# Query 002: SELECT Specific Columns

## Objective
Tests column-level projection. Verifies that named columns in the SELECT list map to a MongoDB `$project` stage with only those fields included, while `_id` is suppressed unless explicitly selected.

## SQL Query
```sql
SELECT userId, name, email, role FROM users LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      email: 1,
      role: 1
    }
  }
]
```

## Expected Behavior
Returns all 100 user documents but each document contains only `userId`, `name`, `email`, and `role`. The `_id` field and all other fields are omitted from the result set.

## SQL Constructs Tested
- `SELECT <col1>, <col2>, ...` (explicit column list)
- Column-level projection (inclusion mode)
- Implicit `_id` exclusion
