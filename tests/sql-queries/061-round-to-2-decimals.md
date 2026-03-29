# Query 061: ROUND to 2 Decimals

## Objective
Test that ROUND(field, 2) translates into a MongoDB $round expression with a place argument of 2, rounding numeric values to exactly two decimal places.

## SQL Query
```sql
SELECT
  productId,
  name,
  price,
  ROUND(price * 1.08, 2) AS priceWithTax,
  ROUND(rating, 2) AS roundedRating
FROM products
WHERE isActive = true LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { isActive: true } },
  {
    $project: {
      productId: 1,
      name: 1,
      price: 1,
      priceWithTax: {
        $round: [{ $multiply: ["$price", 1.08] }, 2]
      },
      roundedRating: {
        $round: ["$rating", 2]
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each active product, the price is multiplied by 1.08 to simulate an 8% tax and then rounded to 2 decimal places. The rating field is also rounded to 2 decimal places. Rounding follows standard half-up rules (e.g., 2.345 rounds to 2.35). Both computed values are returned alongside the original price. The original rating is not included.

## SQL Constructs Tested
- `ROUND(expression, precision)` numeric function
- ROUND applied to an arithmetic expression
- ROUND applied directly to a field
- `$multiply` as inner expression inside ROUND
- Two decimal place precision
