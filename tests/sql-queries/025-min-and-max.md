# Query 025: MIN and MAX

## Objective
Tests `MIN` and `MAX` in the same query. Validates that both functions map to `$min` and `$max` accumulators within a single `$group` stage, and that multiple aggregates can coexist in one pipeline stage.

## SQL Query
```sql
SELECT MIN(price) AS min_price, MAX(price) AS max_price FROM products;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: null,
      min_price: { $min: "$price" },
      max_price: { $max: "$price" }
    }
  },
  {
    $project: {
      _id: 0,
      min_price: 1,
      max_price: 1
    }
  }
]
```

## Expected Behavior
Returns a single document like `{ min_price: 4.99, max_price: 999.00 }`. Shows the cheapest and most expensive product price in the catalog. Both values are computed in one pass through the 50-document collection.

## SQL Constructs Tested
- `MIN(field)` → `$min: "$field"` accumulator
- `MAX(field)` → `$max: "$field"` accumulator
- Multiple aggregates in a single `$group` stage
- Column aliases on both aggregates
