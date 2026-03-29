# Query 007: WHERE with OR

## Objective
Tests disjunctive filtering using `OR`. Validates that `OR`-joined conditions produce a `$match` with a `$or` array, where any one condition being true is sufficient to include a document.

## SQL Query
```sql
SELECT userId, name, role, department
FROM users
WHERE role = 'admin' OR role = 'manager' OR department = 'Executive' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $or: [
        { role: { $eq: "admin" } },
        { role: { $eq: "manager" } },
        { department: { $eq: "Executive" } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      role: 1,
      department: 1
    }
  }
]
```

## Expected Behavior
Returns users who are admins, managers, or belong to the Executive department. Documents satisfying any one of the three conditions are included. Some documents may satisfy multiple conditions (e.g., a manager in Executive) but appear only once.

## SQL Constructs Tested
- `OR` operator across multiple conditions
- Same-field OR (two role checks) mixed with different-field OR
- `$or` array in `$match`
