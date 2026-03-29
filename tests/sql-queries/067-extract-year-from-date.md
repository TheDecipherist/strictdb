# Query 067: EXTRACT Year from Date

## Objective
Test that EXTRACT(YEAR FROM field) translates into a MongoDB $year expression within a $project stage, extracting only the four-digit year component from a date field.

## SQL Query
```sql
SELECT
  userId,
  name,
  createdAt,
  EXTRACT(YEAR FROM createdAt) AS signupYear,
  EXTRACT(MONTH FROM createdAt) AS signupMonth
FROM users
WHERE status = 'active'
ORDER BY signupYear DESC, signupMonth ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      name: 1,
      createdAt: 1,
      signupYear: { $year: "$createdAt" },
      signupMonth: { $month: "$createdAt" },
      _id: 0
    }
  },
  { $sort: { signupYear: -1, signupMonth: 1 } }
]
```

## Expected Behavior
For each active user, the year and month components are extracted from their createdAt timestamp. signupYear returns a four-digit integer (e.g., 2023). signupMonth returns a one or two digit integer (1-12, where 1 is January). Results are sorted by year descending then month ascending. EXTRACT with YEAR and MONTH are the two most common date part extractions and both map to dedicated MongoDB date operators.

## SQL Constructs Tested
- `EXTRACT(YEAR FROM field)` mapped to $year
- `EXTRACT(MONTH FROM field)` mapped to $month
- Multiple EXTRACT calls in same SELECT
- Column aliases for extracted date parts
- Multi-key `ORDER BY` on computed aliases
