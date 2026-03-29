# Query 033: RIGHT JOIN

## Objective
Tests RIGHT JOIN semantics, which preserve all right-side documents. Validates that Mode 2 either reverses the join direction (swapping the lookup source) or uses a `$lookup` on the right-side collection driving from it, effectively converting RIGHT JOIN into a LEFT JOIN from the other side.

## SQL Query
```sql
SELECT o.orderId, o.total, p.name AS product_name, p.category
FROM orders o
RIGHT JOIN products p ON o.productId = p.productId
LIMIT 20;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "orders",
      localField: "productId",
      foreignField: "productId",
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
    $limit: 20
  },
  {
    $project: {
      _id: 0,
      "order.orderId": 1,
      "order.total": 1,
      name: 1,
      category: 1
    }
  }
]
```

## Expected Behavior
Returns up to 20 rows starting from the `products` collection. All products appear — even those with no orders placed. For products with orders, one row per order is produced. The RIGHT JOIN is executed as a LEFT JOIN driven from `products`.

## SQL Constructs Tested
- `RIGHT JOIN` → reversed `$lookup` (right-side becomes the driving collection)
- All right-side documents preserved (`preserveNullAndEmpty: true`)
- Table alias column references from the originally "left" table (`o.orderId`)
- Conceptual inversion: RIGHT JOIN = LEFT JOIN from right side
