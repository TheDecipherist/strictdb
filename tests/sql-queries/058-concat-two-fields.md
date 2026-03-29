# Query 058: CONCAT Two Fields

## Objective
Test that CONCAT() applied to two or more fields (with optional literal string separators) translates into a MongoDB $concat expression within a $project stage, producing a single combined string.

## SQL Query
```sql
SELECT
  userId,
  CONCAT(firstName, ' ', lastName) AS fullName,
  email
FROM users
WHERE status = 'active'
ORDER BY fullName ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      fullName: {
        $concat: ["$firstName", " ", "$lastName"]
      },
      email: 1,
      _id: 0
    }
  },
  { $sort: { fullName: 1 } }
]
```

## Expected Behavior
Each active user row includes a computed fullName field formed by joining firstName, a space literal, and lastName. The result is alphabetically sorted by fullName ascending. The firstName and lastName fields are not included individually in the output. If either component field is null, MongoDB $concat returns null for that document.

## SQL Constructs Tested
- `CONCAT(field, literal, field)` with a literal separator
- Mixed field references and string literals in CONCAT arguments
- Column alias for concatenated result
- `ORDER BY` on a computed alias
- Null propagation behavior of $concat
