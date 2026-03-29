# Query 075: Multiple Params in Complex WHERE

## Objective
Test that multiple parameterized placeholders inside a complex WHERE clause with AND, OR, IN, and BETWEEN conditions are all correctly substituted and translated into the equivalent MongoDB filter, including params used in nested logical groupings.

## SQL Query
```sql
SELECT
  reviewId,
  userId,
  productId,
  rating,
  title,
  verified,
  createdAt
FROM reviews
WHERE (rating >= ? AND rating <= ?)
  AND verified = ?
  AND productId IN (?, ?, ?)
  AND createdAt BETWEEN ? AND ?
ORDER BY rating DESC, createdAt DESC
LIMIT ?;
```

## Parameters Array
```javascript
[3, 5, true, "prod_001", "prod_002", "prod_003", "2024-01-01", "2024-12-31", 20]
```

## Expected MongoDB Pipeline (after param substitution)
```javascript
[
  {
    $match: {
      $and: [
        {
          rating: { $gte: 3, $lte: 5 }
        },
        { verified: true },
        { productId: { $in: ["prod_001", "prod_002", "prod_003"] } },
        {
          createdAt: {
            $gte: new Date("2024-01-01T00:00:00.000Z"),
            $lte: new Date("2024-12-31T23:59:59.999Z")
          }
        }
      ]
    }
  },
  {
    $project: {
      reviewId: 1,
      userId: 1,
      productId: 1,
      rating: 1,
      title: 1,
      verified: 1,
      createdAt: 1,
      _id: 0
    }
  },
  { $sort: { rating: -1, createdAt: -1 } },
  { $limit: 20 }
]
```

## Expected Behavior
Nine `?` placeholders are substituted in order: two numeric bounds for rating, a boolean for verified, three string product IDs for the IN list, two date strings for the BETWEEN range, and a numeric LIMIT. The IN clause receives an array of three substituted values. The date BETWEEN expands to $gte start-of-day and $lte end-of-day for the respective date strings. Boolean true is preserved as a boolean (not the string "true"). Multi-key sort applies rating descending first, then createdAt descending. This tests the full complexity of param substitution across all major WHERE clause patterns in a single query.

## SQL Constructs Tested
- Nine `?` placeholders across different clause types
- Boolean parameter (`true`) preserving boolean type after substitution
- `IN (?, ?, ?)` with multiple string parameters forming an array
- `BETWEEN ? AND ?` with date string parameters
- Parenthesized AND grouping combined with top-level AND
- Range condition (>= and <=) using two separate params on the same field
- Multi-key `ORDER BY` with two fields both descending
- `?` as the LIMIT value (final parameter)
