# Query 006: WHERE with AND

## Objective
Tests compound filtering using `AND`. Validates that multiple `AND`-joined conditions produce a `$match` with a `$and` array, ensuring all conditions must be satisfied simultaneously.

## SQL Query
```sql
SELECT userId, name, age, department, salary
FROM users
WHERE department = 'Engineering' AND age > 30 AND salary >= 80000 LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $and: [
        { department: { $eq: "Engineering" } },
        { age: { $gt: 30 } },
        { salary: { $gte: 80000 } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      age: 1,
      department: 1,
      salary: 1
    }
  }
]
```

## Expected Behavior
Returns engineers over age 30 earning at least $80,000. All three conditions must be true. A small subset of users — likely 5–15 documents depending on sample data distribution.

## SQL Constructs Tested
- `AND` operator chaining multiple conditions
- Mixed field types in WHERE (string equality + numeric comparisons)
- `$and` array in `$match`
