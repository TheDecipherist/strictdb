# Query 012: WHERE NOT IN List

## Objective
Tests exclusion filtering with `NOT IN`. Validates that `WHERE field NOT IN (v1, v2, ...)` maps to `$nin` in the `$match` stage, excluding documents whose field value appears in the list.

## SQL Query
```sql
SELECT productId, name, category, price
FROM products
WHERE category NOT IN ('Electronics', 'Software') LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      category: { $nin: ["Electronics", "Software"] }
    }
  },
  {
    $project: {
      _id: 0,
      productId: 1,
      name: 1,
      category: 1,
      price: 1
    }
  }
]
```

## Expected Behavior
Returns all products that do NOT belong to the `"Electronics"` or `"Software"` categories. Documents where `category` is `null` or missing are also excluded by `$nin` semantics. Returns a subset of the 50 products collection.

## SQL Constructs Tested
- `WHERE field NOT IN (list)` → `$nin`
- Exclusion membership test
- `NOT IN` as the logical inverse of `IN`
