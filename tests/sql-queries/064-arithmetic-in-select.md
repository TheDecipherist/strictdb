# Query 064: Arithmetic in SELECT (price * quantity)

## Objective
Test that arithmetic expressions in the SELECT list (multiplication, addition, subtraction, division) translate into the corresponding MongoDB arithmetic operators ($multiply, $add, $subtract, $divide) within a $project stage.

## SQL Query
```sql
SELECT
  orderId,
  userId,
  quantity,
  total,
  discount,
  quantity * total AS grossValue,
  total - discount AS netValue,
  discount / total * 100 AS discountPct
FROM orders
WHERE status = 'completed' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "completed" } },
  {
    $project: {
      orderId: 1,
      userId: 1,
      quantity: 1,
      total: 1,
      discount: 1,
      grossValue: { $multiply: ["$quantity", "$total"] },
      netValue: { $subtract: ["$total", "$discount"] },
      discountPct: {
        $multiply: [
          { $divide: ["$discount", "$total"] },
          100
        ]
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each completed order, three computed columns are returned alongside the raw fields. grossValue multiplies quantity by total. netValue subtracts discount from total. discountPct calculates the discount as a percentage of total, computed as (discount / total) * 100. Division by zero (when total is 0) produces null in MongoDB. Operator precedence follows standard math rules and is preserved in nested expression translation.

## SQL Constructs Tested
- `*` multiplication operator mapped to $multiply
- `-` subtraction operator mapped to $subtract
- `/` division operator mapped to $divide
- Compound expression with nested arithmetic
- Literal numeric value (100) in arithmetic expression
- Multiple computed columns in same SELECT
