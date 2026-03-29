# Query 014: WHERE LIKE — Starts With

## Objective
Tests the `LIKE` pattern with a trailing wildcard (`%`). Validates that `LIKE 'prefix%'` maps to a MongoDB `$regex` anchored at the start of the string (`^prefix`), optionally with case-insensitive matching.

## SQL Query
```sql
SELECT userId, name, email
FROM users
WHERE name LIKE 'A%' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      name: { $regex: "^A", $options: "i" }
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
Returns all users whose `name` starts with the letter "A" (case-insensitive). For example, names like "Alice", "Aaron", "angela" all match. The number of results depends on name distribution in the 100-user sample.

## SQL Constructs Tested
- `LIKE 'prefix%'` → `$regex: "^prefix"`
- Trailing `%` wildcard → start-anchored regex
- Case-insensitive regex matching (`$options: "i"`)
