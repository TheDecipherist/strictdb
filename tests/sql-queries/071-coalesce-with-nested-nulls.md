# Query 071: COALESCE with Nested Nulls

## Objective
Test that COALESCE() with three or more arguments translates into a nested MongoDB $ifNull chain (or a $reduce-based approach), returning the first non-null value from the argument list.

## SQL Query
```sql
SELECT
  userId,
  name,
  COALESCE(bio, 'No bio provided') AS displayBio,
  COALESCE(city, country, 'Unknown location') AS location,
  COALESCE(deletedAt, updatedAt, createdAt) AS lastActivityAt
FROM users
WHERE status = 'active' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      name: 1,
      displayBio: {
        $ifNull: ["$bio", "No bio provided"]
      },
      location: {
        $ifNull: [
          "$city",
          { $ifNull: ["$country", "Unknown location"] }
        ]
      },
      lastActivityAt: {
        $ifNull: [
          "$deletedAt",
          { $ifNull: ["$updatedAt", "$createdAt"] }
        ]
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each active user, displayBio shows their bio or a fallback string if bio is null. location returns city if set, falling back to country, and ultimately the string "Unknown location" if both are null. lastActivityAt returns the first non-null timestamp among deletedAt, updatedAt, and createdAt — useful for deriving the most recent meaningful activity. COALESCE with two arguments maps to a single $ifNull; three or more require nesting.

## SQL Constructs Tested
- `COALESCE(field, literal)` two-argument form
- `COALESCE(field, field, literal)` three-argument form with a literal fallback
- `COALESCE(field, field, field)` three-argument form with all field references
- Nested $ifNull to model multi-argument COALESCE
- Nullable fields (bio, deletedAt) used as primary COALESCE inputs
