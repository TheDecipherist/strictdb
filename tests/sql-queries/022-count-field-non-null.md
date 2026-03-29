# Query 022: COUNT(field) — Non-Null Count

## Objective
Tests `COUNT(field)` which, unlike `COUNT(*)`, counts only documents where the specified field is non-null. Validates that this maps to a pre-filtering `$match` for `$exists: true` + `$ne: null` before the `$count` stage.

## SQL Query
```sql
SELECT COUNT(bio) AS users_with_bio FROM users;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      bio: { $ne: null, $exists: true }
    }
  },
  {
    $count: "users_with_bio"
  }
]
```

## Expected Behavior
Returns a single document like `{ users_with_bio: 67 }` (exact value depends on seed data). Only users with a non-null, present `bio` field are counted. Users where `bio` is `null` or missing are excluded from the count — this is standard SQL `COUNT(column)` behavior.

## SQL Constructs Tested
- `COUNT(field)` vs `COUNT(*)` — non-null semantics
- Implicit `IS NOT NULL` filter before counting
- `$match` with `$exists: true` and `$ne: null` as pre-count filter
- Column alias on aggregate (`AS users_with_bio`)
