# Query 030: Aggregate with WHERE Filter

## Objective
Tests combining a `WHERE` filter with an aggregate function. Validates that the `WHERE` clause maps to a `$match` stage placed **before** the `$group` stage, reducing the document set prior to aggregation.

## SQL Query
```sql
SELECT COUNT(*) AS active_products, AVG(price) AS avg_price
FROM products
WHERE isActive = true AND category = 'Electronics';
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      $and: [
        { isActive: { $eq: true } },
        { category: { $eq: "Electronics" } }
      ]
    }
  },
  {
    $group: {
      _id: null,
      active_products: { $sum: 1 },
      avg_price: { $avg: "$price" }
    }
  },
  {
    $project: {
      _id: 0,
      active_products: 1,
      avg_price: 1
    }
  }
]
```

## Expected Behavior
Returns a single document with the count and average price of active Electronics products only. The `$match` reduces the 50 products down to the Electronics subset before aggregation runs. Pipeline stage order matters: `$match` before `$group` is critical for correctness and performance.

## SQL Constructs Tested
- `WHERE` with aggregate → `$match` before `$group`
- Boolean field equality (`isActive = true`)
- String equality combined with boolean filter via `AND`
- Pipeline ordering: `$match` → `$group` → `$project`
