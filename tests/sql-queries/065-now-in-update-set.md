# Query 065: NOW() in UPDATE SET

## Objective
Test that NOW() (or CURRENT_TIMESTAMP) used in an UPDATE SET clause translates into setting a field to the current date-time using the JavaScript Date object or MongoDB $$NOW system variable, capturing the exact moment of the update operation.

## SQL Query
```sql
UPDATE orders
SET
  status = 'delivered',
  deliveredAt = NOW(),
  updatedAt = NOW()
WHERE orderId = 'ord_abc123'
  AND status = 'shipped';
```

## Expected MongoDB Operation
```javascript
db.orders.updateOne(
  {
    orderId: "ord_abc123",
    status: "shipped"
  },
  {
    $set: {
      status: "delivered",
      deliveredAt: "$$NOW",
      updatedAt: "$$NOW"
    }
  }
)
```

## Expected Behavior
The single matching order (orderId = ord_abc123, currently in shipped status) is updated atomically. Both deliveredAt and updatedAt are set to the same timestamp representing the moment the update operation executes on the server. Using $$NOW ensures both fields receive the identical timestamp within a single operation. If no document matches both filter conditions, no update is performed and no error is raised.

## SQL Constructs Tested
- `NOW()` date function in SET clause
- `CURRENT_TIMESTAMP` synonym behavior
- Multiple fields set to NOW() in same update
- Compound `WHERE` filter with AND
- UPDATE affecting a nullable field (deliveredAt)
