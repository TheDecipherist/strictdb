# Query 050: DELETE with WHERE

## Objective
Tests `DELETE FROM ... WHERE` to remove matching documents. Validates that a filtered DELETE maps to `deleteMany` with the WHERE clause as the filter, and that StrictDB's guardrails block a `DELETE` with no WHERE clause (empty filter).

## SQL Query
```sql
DELETE FROM sessions
WHERE isActive = false AND endedAt < '2024-01-01T00:00:00Z';
```

## Expected MongoDB Operation
```javascript
// Not a pipeline — maps to deleteMany()
db.sessions.deleteMany({
  $and: [
    { isActive:  { $eq: false } },
    { endedAt:   { $lt: "2024-01-01T00:00:00Z" } }
  ]
})
```

## Expected Behavior
Deletes all sessions that are no longer active AND ended before January 1, 2024 (i.e., stale/expired sessions). Returns a delete receipt with `deletedCount`. The non-empty WHERE clause is required — StrictDB's guardrails would block `DELETE FROM sessions` with no condition to prevent accidental full-collection wipes.

## SQL Constructs Tested
- `DELETE FROM <collection> WHERE condition`
- Boolean equality filter (`isActive = false`)
- Date comparison with `<` operator → `$lt`
- Compound `AND` in DELETE WHERE → `$and` in filter document
- DELETE maps to `deleteMany` (affects all matching documents)
- StrictDB guardrail: non-empty filter required for delete operations
