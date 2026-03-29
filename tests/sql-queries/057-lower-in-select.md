# Query 057: LOWER in SELECT

## Objective
Test that LOWER() applied to a string field in the SELECT list translates into a MongoDB $toLower expression within a $project stage, returning the field value in all lowercase.

## SQL Query
```sql
SELECT
  userId,
  LOWER(email) AS emailLower,
  LOWER(city) AS cityLower
FROM users
WHERE role = 'admin' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { role: "admin" } },
  {
    $project: {
      userId: 1,
      emailLower: { $toLower: "$email" },
      cityLower: { $toLower: "$city" },
      _id: 0
    }
  }
]
```

## Expected Behavior
All admin users are returned with their email and city fields converted to lowercase strings. This is useful for case-insensitive display or downstream comparisons. The stored documents are not modified. If a field value is already lowercase, the output is unchanged.

## SQL Constructs Tested
- `LOWER(field)` string function in SELECT
- Multiple LOWER calls in same SELECT list
- Column aliases for lowercased fields
- Projection with mix of raw and computed fields
- `WHERE` equality filter on role field
