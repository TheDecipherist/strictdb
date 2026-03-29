# Query 047: INSERT Multiple Rows

## Objective
Tests bulk insertion of multiple rows via a single `INSERT INTO ... VALUES (...), (...)` statement. Validates that multi-row insert maps to `insertMany` with an array of documents, preserving value types and column-to-field mapping for every row.

## SQL Query
```sql
INSERT INTO products (productId, name, category, price, stock, rating, reviewCount, isActive, weight, createdAt)
VALUES
  ('p051', 'Wireless Mouse',   'Electronics', 29.99,  200, 4.3, 87,  true,  0.15, '2024-03-01T00:00:00Z'),
  ('p052', 'USB-C Hub',        'Electronics', 49.99,  150, 4.5, 124, true,  0.25, '2024-03-01T00:00:00Z'),
  ('p053', 'Desk Lamp',        'Furniture',   39.99,   75, 4.1, 42,  true,  1.20, '2024-03-01T00:00:00Z');
```

## Expected MongoDB Pipeline
```javascript
// Not a pipeline — maps to insertMany()
db.products.insertMany([
  {
    productId:    "p051",
    name:         "Wireless Mouse",
    category:     "Electronics",
    price:        29.99,
    stock:        200,
    rating:       4.3,
    reviewCount:  87,
    isActive:     true,
    weight:       0.15,
    createdAt:    "2024-03-01T00:00:00Z"
  },
  {
    productId:    "p052",
    name:         "USB-C Hub",
    category:     "Electronics",
    price:        49.99,
    stock:        150,
    rating:       4.5,
    reviewCount:  124,
    isActive:     true,
    weight:       0.25,
    createdAt:    "2024-03-01T00:00:00Z"
  },
  {
    productId:    "p053",
    name:         "Desk Lamp",
    category:     "Furniture",
    price:        39.99,
    stock:        75,
    rating:       4.1,
    reviewCount:  42,
    isActive:     true,
    weight:       1.20,
    createdAt:    "2024-03-01T00:00:00Z"
  }
])
```

## Expected Behavior
Inserts three new product documents in a single operation. Returns an `insertMany` receipt with `insertedCount: 3` and the array of inserted IDs. The `tags` field is omitted from all three (nullable array not provided). All three rows use the same `createdAt` timestamp.

## SQL Constructs Tested
- `INSERT INTO ... VALUES (...), (...), (...)` multi-row syntax
- Multi-row insert → `insertMany` with document array
- Column list reused across all rows
- Mixed types: string, float, integer, boolean, ISO date string
