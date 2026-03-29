# Query 015: WHERE LIKE — Contains

## Objective
Tests the `LIKE` pattern with wildcards on both sides (`%value%`). Validates that `LIKE '%substring%'` maps to an unanchored `$regex` that matches the substring anywhere within the field value.

## SQL Query
```sql
SELECT userId, name, email, bio
FROM users
WHERE bio LIKE '%developer%' LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $match: {
      bio: { $regex: "developer", $options: "i" }
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      email: 1,
      bio: 1
    }
  }
]
```

## Expected Behavior
Returns all users whose `bio` field contains the word "developer" anywhere in the text (case-insensitive). Users with a `null` or missing `bio` are automatically excluded because the regex does not match `null`. Returns a subset of the 100 users.

## SQL Constructs Tested
- `LIKE '%substring%'` → unanchored `$regex`
- Leading and trailing `%` wildcards
- Case-insensitive substring search
- Implicit null exclusion via regex non-match
