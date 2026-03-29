# Query 013: WHERE BETWEEN

## Objective
Tests the `BETWEEN` range operator. Validates that `WHERE field BETWEEN low AND high` expands to a `$match` with both `$gte` and `$lte` on the same field (inclusive on both ends, matching SQL semantics).

## SQL Query
```sql
SELECT productId, name, price, rating
FROM products
WHERE price BETWEEN 10.00 AND 99.99 LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      price: {
        $gte: 10.00,
        $lte: 99.99
      }
    }
  },
  {
    $project: {
      _id: 0,
      productId: 1,
      name: 1,
      price: 1,
      rating: 1
    }
  }
]
```

## Expected Behavior
Returns all products priced from $10.00 to $99.99 inclusive. `BETWEEN` in SQL is always inclusive on both bounds. Results are in natural order. Likely returns the majority of the 50 products depending on price distribution.

## SQL Constructs Tested
- `BETWEEN low AND high` → `{ $gte: low, $lte: high }`
- Inclusive range check on a numeric (decimal) field
- Single-field dual-bound match
