# Query 049: UPDATE with Increment (SET field = field + 1)

## Objective
Tests a self-referential update where a field is incremented by a value relative to its current state. Validates that `SET field = field + N` maps to MongoDB's `$inc` operator rather than a literal `$set`, preserving the atomic increment semantics.

## SQL Query
```sql
UPDATE products
SET stock = stock - 1, reviewCount = reviewCount + 1
WHERE productId = 'p001';
```

## Expected MongoDB Operation
```javascript
// Not a pipeline — maps to updateOne() (single document by unique key)
db.products.updateOne(
  { productId: { $eq: "p001" } },
  {
    $inc: {
      stock:       -1,
      reviewCount: 1
    }
  }
)
```

## Expected Behavior
Decrements `stock` by 1 and increments `reviewCount` by 1 atomically on the product with `productId = "p001"`. MongoDB's `$inc` handles both positive and negative increments. The WHERE clause targets a single unique product, so `updateOne` is appropriate. Returns receipt with `matchedCount: 1`, `modifiedCount: 1`.

## SQL Constructs Tested
- `SET field = field + N` → `$inc: { field: N }`
- `SET field = field - N` → `$inc: { field: -N }`
- Self-referential arithmetic update → atomic `$inc`
- Single-document update via unique key → `updateOne`
- Mixed increment directions: positive and negative in same update
