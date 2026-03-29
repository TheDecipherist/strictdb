# Query 060: SUBSTRING Extraction

## Objective
Test that SUBSTRING() (or SUBSTR()) with start position and length arguments translates into a MongoDB $substrCP expression, extracting a portion of a string field.

## SQL Query
```sql
SELECT
  userId,
  email,
  SUBSTRING(email, 1, 5) AS emailPrefix
FROM users
WHERE status = 'active' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      email: 1,
      emailUsername: {
        $substrCP: [
          "$email",
          0,
          {
            $subtract: [
              { $indexOfCP: ["$email", "@"] },
              0
            ]
          }
        ]
      },
      _id: 0
    }
  }
]
```

## Expected Behavior
For each active user, the query extracts the local-part of the email address (everything before the @ symbol). SQL SUBSTRING uses 1-based indexing while MongoDB $substrCP uses 0-based indexing, so the translation adjusts the start position. The extracted username is returned as the emailUsername alias. The original email is also included for reference.

## SQL Constructs Tested
- `SUBSTRING(field, start, length)` extraction
- 1-based to 0-based index translation
- Dynamic length derived from string search position
- `$indexOfCP` equivalent of `CHARINDEX`
- Column alias for extracted substring value
