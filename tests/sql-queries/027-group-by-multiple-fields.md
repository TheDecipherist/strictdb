# Query 027: GROUP BY Multiple Fields

## Objective
Tests partitioned aggregation with a composite `GROUP BY`. Validates that `GROUP BY field1, field2` maps to a compound `_id` object `{ field1: "$field1", field2: "$field2" }` in the `$group` stage.

## SQL Query
```sql
SELECT department, role, COUNT(*) AS headcount
FROM users
GROUP BY department, role;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: {
        department: "$department",
        role: "$role"
      },
      headcount: { $sum: 1 }
    }
  },
  {
    $project: {
      _id: 0,
      department: "$_id.department",
      role: "$_id.role",
      headcount: 1
    }
  }
]
```

## Expected Behavior
Returns one document per unique `(department, role)` combination. For example: `{ department: "Engineering", role: "developer", headcount: 18 }`. The number of result documents equals the number of distinct combinations across the 100 users.

## SQL Constructs Tested
- `GROUP BY field1, field2` → compound `_id` object in `$group`
- Composite group key with two fields
- `$project` unpacking nested `_id` back to top-level fields
- `$sum: 1` count per group
