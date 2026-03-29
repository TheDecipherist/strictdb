# Query 003: WHERE with Equality

## Objective
Tests single-condition equality filtering. Validates that `WHERE field = value` translates to a `$match` stage using `$eq`, and that string values are passed through without modification.

## SQL Query
```sql
SELECT userId, name, email FROM users WHERE role = 'admin' LIMIT 100;
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
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      email: 1
    }
  }
]
```

## Expected Behavior
Returns documents for all users whose `role` field equals the string `"admin"`. Typically a small subset of the 100 users. Each result contains only `userId`, `name`, and `email`.

## SQL Constructs Tested
- `WHERE <field> = <string_literal>`
- `$match` with `$eq`
- Combined filtering and projection
