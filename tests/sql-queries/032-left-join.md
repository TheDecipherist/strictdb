# Query 032: LEFT JOIN

## Objective
Tests a LEFT JOIN, which preserves all left-side documents regardless of whether a match exists on the right side. Validates that this maps to `$lookup` with `$unwind` using `preserveNullAndEmpty: true`, keeping documents where the joined array is empty.

## SQL Query
```sql
SELECT u.userId, u.name, o.orderId, o.total
FROM users u
LEFT JOIN orders o ON u.userId = o.userId
LIMIT 25;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "orders",
      localField: "userId",
      foreignField: "userId",
      as: "order"
    }
  },
  {
    $unwind: {
      path: "$order",
      preserveNullAndEmpty: true
    }
  },
  {
    $limit: 25
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      "order.orderId": 1,
      "order.total": 1
    }
  }
]
```

## Expected Behavior
Returns up to 25 rows. Users with orders appear once per order. Users with no orders also appear with `order.orderId` and `order.total` as `null` or absent. This preserves all users — the LEFT JOIN guarantee.

## SQL Constructs Tested
- `LEFT JOIN ... ON` → `$lookup` + `$unwind` with `preserveNullAndEmpty: true`
- Preservation of left-side documents with no match
- Null fields in result when no right-side match exists
- Difference from INNER JOIN in `$unwind` options
