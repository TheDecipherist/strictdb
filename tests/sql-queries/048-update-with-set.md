# Query 048: UPDATE with SET

## Objective
Tests a standard `UPDATE ... SET ... WHERE` statement. Validates that SQL `SET field = value` maps to MongoDB's `$set` operator inside an `updateMany` call, with the `WHERE` clause becoming the filter document.

## SQL Query
```sql
UPDATE users
SET status = 'inactive', updatedAt = '2024-06-01T00:00:00Z'
WHERE department = 'Marketing' AND loginCount = 0;
```

## Expected MongoDB Operation
```javascript
// Not a pipeline — maps to updateMany()
db.users.updateMany(
  {
    $and: [
      { department: { $eq: "Marketing" } },
      { loginCount: { $eq: 0 } }
    ]
  },
  {
    $set: {
      status:    "inactive",
      updatedAt: "2024-06-01T00:00:00Z"
    }
  }
)
```

## Expected Behavior
Updates all Marketing department users who have never logged in, setting their status to `"inactive"` and updating the `updatedAt` timestamp. Returns an update receipt with `matchedCount` and `modifiedCount`. Fields not listed in `SET` are untouched.

## SQL Constructs Tested
- `UPDATE <collection> SET field = value, field = value`
- Multiple fields in `SET` → `$set` with multiple key-value pairs
- `WHERE` clause on UPDATE → filter document for `updateMany`
- Compound `AND` condition in WHERE
- Mixed type updates: string and ISO date string
