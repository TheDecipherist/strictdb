# Query 004: WHERE with Comparison Operators (>, <, >=, <=)

## Objective
Tests all four numeric comparison operators in a single WHERE clause. Validates that `>`, `<`, `>=`, and `<=` map correctly to MongoDB `$gt`, `$lt`, `$gte`, and `$lte` operators within a `$match` stage.

## SQL Query
```sql
SELECT userId, name, age, salary
FROM users
WHERE age >= 25 AND age <= 45 AND salary > 50000 AND salary < 120000 LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $and: [
        { age: { $gte: 25 } },
        { age: { $lte: 45 } },
        { salary: { $gt: 50000 } },
        { salary: { $lt: 120000 } }
      ]
    }
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
Returns users aged 25–45 (inclusive) whose salary falls strictly between 50,000 and 120,000. Multiple `AND` conditions on numeric fields. Documents contain only the four projected columns.

## SQL Constructs Tested
- `>=` → `$gte`
- `<=` → `$lte`
- `>` → `$gt`
- `<` → `$lt`
- Multiple range conditions combined with `AND`
