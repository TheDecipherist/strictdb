# Query 034: INNER JOIN with WHERE

## Objective
Tests an INNER JOIN combined with a WHERE filter. Validates that the WHERE clause generates a `$match` stage after the `$lookup`/`$unwind`, filtering the joined result set — and that fields from both sides of the join are eligible for filtering.

## SQL Query
```sql
SELECT o.orderId, o.total, o.status, u.name, u.country
FROM orders o
INNER JOIN users u ON o.userId = u.userId
WHERE o.status = 'delivered' AND u.country = 'US' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "userId",
      as: "user"
    }
  },
  {
    $unwind: {
      path: "$user",
      preserveNullAndEmpty: false
    }
  },
  {
    $match: {
      $and: [
        { status: { $eq: "delivered" } },
        { "user.country": { $eq: "US" } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      orderId: 1,
      total: 1,
      status: 1,
      "user.name": 1,
      "user.country": 1
    }
  }
]
```

## Expected Behavior
Returns delivered orders placed by US-based customers. Both the order's `status` and the joined user's `country` must match. A small subset of the 300 orders, limited to those with a matching user in the US who has a delivered order.

## SQL Constructs Tested
- INNER JOIN + WHERE filter on fields from both tables
- `$match` after `$lookup`+`$unwind` targeting joined document fields using dot notation
- Multi-condition `$and` across root document and embedded joined document
