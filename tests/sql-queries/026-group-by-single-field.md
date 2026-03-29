# Query 026: GROUP BY Single Field

## Objective
Tests partitioned aggregation with a single `GROUP BY` field. Validates that `GROUP BY field` maps to `_id: "$field"` in the `$group` stage, producing one result document per distinct value of the grouping field.

## SQL Query
```sql
SELECT department, COUNT(*) AS headcount
FROM users
GROUP BY department;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: "$department",
      headcount: { $sum: 1 }
    }
  },
  {
    $project: {
      _id: 0,
      department: "$_id",
      headcount: 1
    }
  }
]
```

## Expected Behavior
Returns one document per department with the number of users in that department. For example: `{ department: "Engineering", headcount: 22 }`, `{ department: "Marketing", headcount: 15 }`, etc. Total headcount across all groups equals 100.

## SQL Constructs Tested
- `GROUP BY <field>` → `$group: { _id: "$field" }`
- `COUNT(*)` as `$sum: 1` within a group
- `$project` renaming `_id` back to the field name
- One result row per distinct group value
