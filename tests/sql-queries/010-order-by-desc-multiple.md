# Query 010: ORDER BY DESC, Multiple Fields

## Objective
Tests descending sort and multi-field sort keys. Validates that `ORDER BY field1 DESC, field2 ASC` produces a `$sort` stage with the correct direction values and that key order within the sort document is preserved.

## SQL Query
```sql
SELECT userId, name, department, salary, age
FROM users
ORDER BY salary DESC, age ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $sort: {
      salary: -1,
      age: 1
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      department: 1,
      salary: 1,
      age: 1
    }
  }
]
```

## Expected Behavior
Returns all 100 users ordered from highest to lowest salary. Among users with identical salary values, those with a lower age are listed first. Key ordering in the `$sort` stage is significant — `salary` is the primary sort key, `age` is the tiebreaker.

## SQL Constructs Tested
- `ORDER BY <field> DESC` → `$sort: { field: -1 }`
- `ORDER BY <field> ASC` → `$sort: { field: 1 }`
- Multi-key sort with mixed directions
- Sort key order preservation
