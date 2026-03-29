# Query 063: CEIL / FLOOR

## Objective
Test that CEIL() and FLOOR() numeric functions translate into MongoDB $ceil and $floor expressions respectively, rounding values up or down to the nearest integer.

## SQL Query
```sql
SELECT
  productId,
  name,
  price,
  FLOOR(price) AS priceFloor,
  CEIL(price) AS priceCeil,
  FLOOR(rating) AS ratingFloor
FROM products
WHERE stock > 0
ORDER BY price ASC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { stock: { $gt: 0 } } },
  {
    $project: {
      productId: 1,
      name: 1,
      price: 1,
      priceFloor: { $floor: "$price" },
      priceCeil: { $ceil: "$price" },
      ratingFloor: { $floor: "$rating" },
      _id: 0
    }
  },
  { $sort: { price: 1 } }
]
```

## Expected Behavior
For in-stock products, priceFloor is the price rounded down to the nearest integer (e.g., 19.99 becomes 19), priceCeil is rounded up (e.g., 19.01 becomes 20), and ratingFloor is the whole-number floor of the rating. Results are ordered by the original price field ascending. CEIL of an integer value returns the same integer. FLOOR of a negative value rounds toward negative infinity.

## SQL Constructs Tested
- `CEIL(field)` ceiling function mapped to $ceil
- `FLOOR(field)` floor function mapped to $floor
- Both functions applied to the same field (price)
- FLOOR applied to a different field (rating)
- `ORDER BY` on raw field alongside computed values
