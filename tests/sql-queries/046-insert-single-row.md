# Query 046: INSERT Single Row

## Objective
Tests inserting a single document via SQL `INSERT INTO ... VALUES (...)`. Validates that a single-row insert maps to `insertOne` in the StrictDB API, with column names becoming field names and values mapped to their appropriate types.

## SQL Query
```sql
INSERT INTO users (userId, name, firstName, lastName, email, age, role, status, department, salary, city, country, score, loginCount, isPremium, createdAt, updatedAt)
VALUES ('u101', 'Grace Hopper', 'Grace', 'Hopper', 'grace@example.com', 85, 'admin', 'active', 'Engineering', 95000, 'New York', 'US', 98.5, 12, true, '2024-01-15T09:00:00Z', '2024-01-15T09:00:00Z');
```

## Expected MongoDB Pipeline
```javascript
// Not a pipeline — maps to insertOne()
db.users.insertOne({
  userId:      "u101",
  name:        "Grace Hopper",
  firstName:   "Grace",
  lastName:    "Hopper",
  email:       "grace@example.com",
  age:         85,
  role:        "admin",
  status:      "active",
  department:  "Engineering",
  salary:      95000,
  city:        "New York",
  country:     "US",
  score:       98.5,
  loginCount:  12,
  isPremium:   true,
  createdAt:   "2024-01-15T09:00:00Z",
  updatedAt:   "2024-01-15T09:00:00Z"
})
```

## Expected Behavior
Inserts a new user document into the `users` collection. Returns an `insertOne` receipt with `insertedId`. The `bio` and `deletedAt` fields are omitted (nullable, not provided). No error expected assuming `userId` is unique.

## SQL Constructs Tested
- `INSERT INTO <collection> (columns) VALUES (values)`
- Column list → field name mapping
- Mixed value types: string, integer, float, boolean, ISO date string
- Single-row insert → `insertOne`
- Nullable field omission (fields not in column list are not set)
