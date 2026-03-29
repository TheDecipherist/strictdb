# Query 042: COALESCE

## Objective
Tests `COALESCE(field, fallback)` which returns the first non-null value in its argument list. Validates that `COALESCE` maps to MongoDB's `$ifNull` operator (for two-argument form) or `$coalesce` equivalent using nested `$ifNull` for more arguments.

## SQL Query
```sql
SELECT
  userId,
  name,
  COALESCE(bio, 'No bio provided') AS bio_text,
  COALESCE(deletedAt, createdAt)   AS effective_date
FROM users
LIMIT 10;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $limit: 10
  },
  {
    $addFields: {
      bio_text:       { $ifNull: ["$bio",       "No bio provided"] },
      effective_date: { $ifNull: ["$deletedAt", "$createdAt"] }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      bio_text: 1,
      effective_date: 1
    }
  }
]
```

## Expected Behavior
Returns 10 users. `bio_text` shows the user's bio if present, or the fallback string `"No bio provided"` if `bio` is null. `effective_date` shows `deletedAt` if the user was deleted, otherwise falls back to `createdAt`. Demonstrates two forms of `COALESCE`: string literal fallback and field fallback.

## SQL Constructs Tested
- `COALESCE(field, literal)` → `$ifNull: ["$field", literal]`
- `COALESCE(field1, field2)` → `$ifNull: ["$field1", "$field2"]`
- `$addFields` for computed columns
- Null-handling in projection
