# Query 008: WHERE with AND + OR Combined

## Objective
Tests operator precedence when `AND` and `OR` are mixed in a single WHERE clause. Validates that parentheses are respected and that the resulting pipeline correctly nests `$and` inside `$or` (or vice versa) to preserve logical grouping.

## SQL Query
```sql
SELECT userId, name, age, role, country
FROM users
WHERE (role = 'admin' OR role = 'manager') AND (country = 'US' OR country = 'CA') AND age > 25 LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $and: [
        {
          $or: [
            { role: { $eq: "admin" } },
            { role: { $eq: "manager" } }
          ]
        },
        {
          $or: [
            { country: { $eq: "US" } },
            { country: { $eq: "CA" } }
          ]
        },
        { age: { $gt: 25 } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      age: 1,
      role: 1,
      country: 1
    }
  }
]
```

## Expected Behavior
Returns admins or managers located in the US or Canada who are older than 25. All three top-level AND conditions must be met: correct role, correct country, and minimum age. A small subset of 100 users expected.

## SQL Constructs Tested
- Parenthesized `OR` groups inside an `AND` expression
- Operator precedence: `AND` binds tighter than `OR` without parens, but parens override
- Nested `$or` arrays within `$and`
- Three separate conditions joined by `AND`
