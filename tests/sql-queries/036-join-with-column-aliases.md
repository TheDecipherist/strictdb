# Query 036: JOIN with Column Aliases

## Objective
Tests column aliases (`AS`) on fields from both sides of a JOIN. Validates that `AS` aliases on projected fields from joined documents are renamed correctly in the final `$project` stage, remapping dot-notation paths to flat alias names.

## SQL Query
```sql
SELECT
  o.orderId       AS order_id,
  o.total         AS order_total,
  u.name          AS customer_name,
  u.email         AS customer_email,
  p.name          AS product_name
FROM orders o
INNER JOIN users    u ON o.userId    = u.userId
INNER JOIN products p ON o.productId = p.productId
LIMIT 10;
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
    $lookup: {
      from: "products",
      localField: "productId",
      foreignField: "productId",
      as: "product"
    }
  },
  {
    $unwind: {
      path: "$product",
      preserveNullAndEmpty: false
    }
  },
  {
    $limit: 10
  },
  {
    $project: {
      _id: 0,
      order_id:       "$orderId",
      order_total:    "$total",
      customer_name:  "$user.name",
      customer_email: "$user.email",
      product_name:   "$product.name"
    }
  }
]
```

## Expected Behavior
Returns up to 10 orders with flattened field names: `order_id`, `order_total`, `customer_name`, `customer_email`, `product_name`. The alias names appear as top-level keys in each result document — no nested objects.

## SQL Constructs Tested
- Column `AS` aliases on both root and joined fields
- `$project` using string expression values (`"$field"`) to rename
- Multiple INNER JOINs in the same query (covered more in 037, but aliases are the focus here)
- Flattening dot-notation paths to top-level names via `$project`
