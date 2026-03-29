# Query 073: MySQL ? Style Params

## Objective
Test that MySQL-style positional parameters (?) in a parameterized query are correctly substituted with the corresponding values from the params array before translation into a MongoDB filter, in left-to-right positional order.

## SQL Query
```sql
SELECT
  userId,
  name,
  email,
  role,
  status
FROM users
WHERE role = ?
  AND status = ?
  AND age >= ?
ORDER BY name ASC
LIMIT ?;
```

## Parameters Array
```javascript
["admin", "active", 25, 50]
```

## Expected MongoDB Pipeline (after param substitution)
```javascript
[
  {
    $match: {
      role: "admin",
      status: "active",
      age: { $gte: 25 }
    }
  },
  {
    $project: {
      userId: 1,
      name: 1,
      email: 1,
      role: 1,
      status: 1,
      _id: 0
    }
  },
  { $sort: { name: 1 } },
  { $limit: 50 }
]
```

## Expected Behavior
Each `?` placeholder is replaced by the corresponding element from the params array in order: first `?` becomes "admin", second becomes "active", third becomes 25, fourth becomes 50. The substituted query is then parsed and translated normally. This prevents SQL injection by keeping values separate from the query structure during parsing. Type inference is applied after substitution — numeric params become $gte numeric, string params become equality strings.

## SQL Constructs Tested
- MySQL `?` positional parameter placeholders
- Four parameters of mixed types (string, string, number, number)
- `?` in WHERE equality conditions
- `?` in WHERE comparison condition (>=)
- `?` as the LIMIT value
- Left-to-right positional substitution order
