# Query 045: Subquery with IN

## Objective
Tests a correlated subquery used as the right-hand side of an `IN` expression. Validates that Mode 2 either evaluates the subquery first (two-pass) and inlines the result set, or uses `$lookup` with a pipeline to replicate the subquery semantics.

## SQL Query
```sql
SELECT userId, name, email, department
FROM users
WHERE userId IN (
  SELECT DISTINCT userId FROM orders WHERE status = 'cancelled'
) LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "orders",
      let: { uid: "$userId" },
      pipeline: [
        { $match: { $expr: { $eq: ["$userId", "$$uid"] }, status: "cancelled" } },
        { $limit: 1 }
      ],
      as: "cancelled_orders"
    }
  },
  {
    $match: {
      cancelled_orders: { $ne: [] }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      email: 1,
      department: 1
    }
  }
]
```

## Expected Behavior
Returns all users who have at least one cancelled order. The subquery in SQL finds the distinct set of `userId` values from cancelled orders; the outer query returns the matching user records. The pipeline approach uses a correlated `$lookup` with `$expr` to achieve the same result.

## SQL Constructs Tested
- Scalar subquery in `IN` clause
- Correlated subquery rewritten as `$lookup` with pipeline
- `$expr` for cross-document field comparison inside lookup pipeline
- `$match` on empty array (`{ $ne: [] }`) to filter "inner join" style
- `DISTINCT` in subquery context
