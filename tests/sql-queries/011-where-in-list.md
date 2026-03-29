# Query 011: WHERE IN List

## Objective
Tests membership filtering with `IN`. Validates that `WHERE field IN (v1, v2, v3)` maps to a `$match` stage using `$in` with the literal array of values.

## SQL Query
```sql
SELECT userId, name, city, country
FROM users
WHERE country IN ('US', 'CA', 'GB', 'AU') LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      country: { $in: ["US", "CA", "GB", "AU"] }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      city: 1,
      country: 1
    }
  }
]
```

## Expected Behavior
Returns all users located in the United States, Canada, Great Britain, or Australia. The number of results depends on sample data distribution across countries. Order is natural (insertion order).

## SQL Constructs Tested
- `WHERE field IN (list)` → `$in`
- Multi-value membership test
- String values in IN list
