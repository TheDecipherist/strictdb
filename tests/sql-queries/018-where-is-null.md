# Query 018: WHERE IS NULL

## Objective
Tests null-checking with `IS NULL`. Validates that `WHERE field IS NULL` maps to a `$match` that selects documents where the field is either `null` or absent entirely, matching SQL's handling of missing values.

## SQL Query
```sql
SELECT userId, name, bio, deletedAt
FROM users
WHERE deletedAt IS NULL LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      deletedAt: { $in: [null] }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      bio: 1,
      deletedAt: 1
    }
  }
]
```

## Expected Behavior
Returns all users who have not been soft-deleted — meaning `deletedAt` is `null` or the field does not exist on the document. This is the standard soft-delete pattern. The majority of the 100 users are expected to match.

## SQL Constructs Tested
- `IS NULL` → `{ $in: [null] }` (matches both explicit `null` and missing field)
- Nullable field check
- Soft-delete filter pattern
