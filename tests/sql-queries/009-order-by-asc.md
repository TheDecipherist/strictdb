# Query 009: ORDER BY ASC

## Objective
Tests ascending sort order. Validates that `ORDER BY field ASC` (or `ORDER BY field` with the implicit default) maps to a `$sort` stage with value `1`.

## SQL Query
```sql
SELECT userId, name, age, salary
FROM users
ORDER BY age ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $sort: { age: 1 }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      age: 1,
      salary: 1
    }
  }
]
```

## Expected Behavior
Returns all 100 users sorted from youngest to oldest. Users with the same `age` value appear in undefined relative order (natural order within the tie group). All four projected fields are returned for each document.

## SQL Constructs Tested
- `ORDER BY <field> ASC`
- `$sort` stage with ascending direction (`1`)
- Sort applied before projection in pipeline
