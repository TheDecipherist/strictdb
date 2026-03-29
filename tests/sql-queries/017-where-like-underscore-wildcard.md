# Query 017: WHERE LIKE with Underscore Wildcard

## Objective
Tests the SQL `_` single-character wildcard in `LIKE` patterns. Validates that each `_` in the pattern translates to `.` (any single character) in the resulting regex, while `%` still translates to `.*`.

## SQL Query
```sql
SELECT userId, name, email
FROM users
WHERE name LIKE 'J_n%' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      name: { $regex: "^J.n", $options: "i" }
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
Returns all users whose name starts with "J", followed by any single character, followed by "n" — and then anything after that. Matches names like "Jan", "Jon", "Jane", "John", "Jung", etc. The `_` matches exactly one character; `%` matches zero or more after "n".

## SQL Constructs Tested
- `_` single-character wildcard → `.` in regex
- `%` multi-character wildcard → `.*` (trailing, so effectively omitted from anchored pattern)
- Mixed `_` and `%` in same LIKE pattern
- Start-anchored regex from leading `J` (no leading `%`)
