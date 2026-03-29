# Query 020: WHERE with Multiple Conditions Including NULL Check

## Objective
Tests combining standard comparison filters with a null check in a single WHERE clause. Validates that `IS NULL` can coexist with `AND` alongside numeric and string comparisons in the generated `$match` stage.

## SQL Query
```sql
SELECT orderId, userId, total, status, deliveredAt
FROM orders
WHERE status = 'shipped' AND total > 100 AND deliveredAt IS NULL LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $and: [
        { status: { $eq: "shipped" } },
        { total: { $gt: 100 } },
        { deliveredAt: { $in: [null] } }
      ]
    }
  },
  {
    $project: {
      _id: 0,
      orderId: 1,
      userId: 1,
      total: 1,
      status: 1,
      deliveredAt: 1
    }
  }
]
```

## Expected Behavior
Returns orders with status `"shipped"`, a total exceeding $100, and no delivery timestamp yet recorded. This represents orders that are in transit but not yet confirmed delivered. A small subset of the 300 orders.

## SQL Constructs Tested
- `AND` combining three heterogeneous conditions
- String equality filter
- Numeric comparison filter
- `IS NULL` null check inside an `AND` compound expression
- `$and` array mixing `$eq`, `$gt`, and `$in: [null]`
