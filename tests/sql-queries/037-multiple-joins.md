# Query 037: Multiple JOINs

## Objective
Tests a query joining three collections. Validates that multiple `$lookup` + `$unwind` stage pairs are chained sequentially in the pipeline, each lookup finding in the document context enriched by prior lookups.

## SQL Query
```sql
SELECT
  r.reviewId,
  r.rating,
  r.title,
  u.name    AS reviewer,
  p.name    AS product,
  p.category
FROM reviews r
INNER JOIN users    u ON r.userId    = u.userId
INNER JOIN products p ON r.productId = p.productId
WHERE r.verified = true
LIMIT 15;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      verified: { $eq: true }
    }
  },
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
    $limit: 15
  },
  {
    $project: {
      _id: 0,
      reviewId: 1,
      rating: 1,
      title: 1,
      reviewer: "$user.name",
      product:  "$product.name",
      category: "$product.category"
    }
  }
]
```

## Expected Behavior
Returns up to 15 verified reviews, each enriched with the reviewer's name and the reviewed product's name and category. The `$match` on `verified` is pushed early to reduce the working set before the expensive lookups.

## SQL Constructs Tested
- Three-table JOIN (reviews → users, reviews → products)
- Sequential `$lookup` + `$unwind` for each join
- Pre-join `$match` optimization (WHERE before JOINs)
- Column aliases mapping joined fields to flat output names
