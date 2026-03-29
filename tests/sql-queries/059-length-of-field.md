# Query 059: LENGTH of Field

## Objective
Test that LENGTH() (or LEN() in some dialects) applied to a string field translates into a MongoDB $strLenCP expression, returning the number of UTF-8 code points in the string value.

## SQL Query
```sql
SELECT
  userId,
  name,
  LENGTH(bio) AS bioLength
FROM users
WHERE bio IS NOT NULL
ORDER BY bioLength DESC
LIMIT 10;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { bio: { $ne: null, $exists: true } } },
  {
    $project: {
      userId: 1,
      name: 1,
      bioLength: { $strLenCP: "$bio" },
      _id: 0
    }
  },
  { $sort: { bioLength: -1 } },
  { $limit: 10 }
]
```

## Expected Behavior
Only users with a non-null bio are included. Each returned document includes the computed character length of the bio field. Results are ordered longest to shortest bio, and only the top 10 are returned. The bio field itself is not included in the output projection, only its length. Multi-byte characters (e.g. emoji, accented letters) are counted by code point.

## SQL Constructs Tested
- `LENGTH(field)` string length function
- `IS NOT NULL` filter translated to $ne null + $exists
- Column alias for computed length value
- `ORDER BY` on computed alias descending
- `LIMIT` applied after sort
