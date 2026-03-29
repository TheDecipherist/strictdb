# Query 005: WHERE with != (Not Equal)

## Objective
Tests the inequality operator. Validates that `!=` (and its alias `<>`) translates to MongoDB's `$ne` operator inside a `$match` stage.

## SQL Query
```sql
SELECT userId, name, status, department
FROM users
WHERE status != 'inactive' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      status: { $ne: "inactive" }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      status: 1,
      department: 1
    }
  }
]
```

## Expected Behavior
Returns all users whose `status` field is anything other than `"inactive"`. Includes users with `status` of `"active"`, `"pending"`, or any other value. Approximately 80–90 of the 100 user documents are expected.

## SQL Constructs Tested
- `!=` inequality operator → `$ne`
- String literal comparison in WHERE
- Exclusion-style filter (everything except a value)
