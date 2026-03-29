# Query 019: WHERE IS NOT NULL

## Objective
Tests non-null checking with `IS NOT NULL`. Validates that `WHERE field IS NOT NULL` maps to a `$match` that excludes documents where the field is `null` or absent, selecting only documents with a real value present.

## SQL Query
```sql
SELECT orderId, userId, notes, createdAt
FROM orders
WHERE notes IS NOT NULL LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      notes: { $ne: null, $exists: true }
    }
  },
  {
    $project: {
      _id: 0,
      orderId: 1,
      userId: 1,
      notes: 1,
      createdAt: 1
    }
  }
]
```

## Expected Behavior
Returns only the orders that have a non-null `notes` field. Orders where `notes` is `null` or where the field is entirely absent from the document are excluded. A subset of the 300 orders — perhaps 30–50% depending on data generation.

## SQL Constructs Tested
- `IS NOT NULL` → `{ $ne: null, $exists: true }`
- Non-null presence check
- Filtering a nullable field to get only populated records
