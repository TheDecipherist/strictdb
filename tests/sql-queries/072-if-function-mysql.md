# Query 072: IF Function (MySQL)

## Objective
Test that MySQL's IF(condition, true_value, false_value) function translates into a MongoDB $cond expression, producing a two-branch conditional that evaluates a boolean test and returns one of two values.

## SQL Query
```sql
SELECT
  productId,
  name,
  stock,
  price,
  IF(stock > 0, 'in_stock', 'out_of_stock') AS availability,
  IF(rating >= 4.0, price * 0.95, price) AS adjustedPrice
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
      stock: 1,
      price: 1,
      availability: {
        $cond: {
          if: { $gt: ["$stock", 0] },
          then: "in_stock",
          else: "out_of_stock"
        }
      },
      adjustedPrice: {
        $cond: {
          if: { $gte: ["$rating", 4.0] },
          then: { $multiply: ["$price", 0.95] },
          else: "$price"
        }
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each active product, availability is the string "in_stock" if stock is greater than zero, otherwise "out_of_stock". adjustedPrice applies a 5% discount for highly-rated products (rating >= 4.0) and returns the original price for lower-rated ones. MySQL's three-argument IF() maps directly to MongoDB's $cond with if/then/else. The true and false branches can be literals, field references, or compound expressions.

## SQL Constructs Tested
- MySQL `IF(condition, true_value, false_value)` function
- IF with string literal true/false values
- IF with an arithmetic expression in the true branch
- IF with a field reference as the false branch
- Multiple IF calls in same SELECT list
