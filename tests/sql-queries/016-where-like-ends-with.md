# Query 016: WHERE LIKE — Ends With

## Objective
Tests the `LIKE` pattern with a leading wildcard (`%`). Validates that `LIKE '%suffix'` maps to a MongoDB `$regex` anchored at the end of the string (`suffix$`).

## SQL Query
```sql
SELECT userId, name, email
FROM users
WHERE email LIKE '%@example.com' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      email: { $regex: "@example\\.com$", $options: "i" }
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
Returns all users whose email address ends with `@example.com`. The dot in the domain suffix must be escaped in the regex pattern to match a literal dot rather than any character. Returns a subset of the 100 users.

## SQL Constructs Tested
- `LIKE '%suffix'` → end-anchored `$regex` with `$` anchor
- Leading `%` wildcard
- Regex special character escaping (`.` → `\\.`)
- Case-insensitive matching via `$options: "i"`
