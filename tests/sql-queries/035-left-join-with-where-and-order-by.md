# Query 035: LEFT JOIN with WHERE and ORDER BY

## Objective
Tests a LEFT JOIN combined with both a WHERE filter and an ORDER BY clause. Validates the correct pipeline stage ordering: `$lookup` → `$unwind` → `$match` → `$sort` → `$project`.

## SQL Query
```sql
SELECT u.userId, u.name, r.rating, r.title
FROM users u
LEFT JOIN reviews r ON u.userId = r.userId
WHERE u.isPremium = true
ORDER BY r.rating DESC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $lookup: {
      from: "reviews",
      localField: "userId",
      foreignField: "userId",
      as: "review"
    }
  },
  {
    $unwind: {
      path: "$review",
      preserveNullAndEmpty: true
    }
  },
  {
    $match: {
      isPremium: { $eq: true }
    }
  },
  {
    $sort: {
      "review.rating": -1
    }
  },
  {
    $project: {
      _id: 0,
      userId: 1,
      name: 1,
      "review.rating": 1,
      "review.title": 1
    }
  }
]
```

## Expected Behavior
Returns all premium users with their reviews (one row per review), sorted highest rating first. Premium users who have written no reviews still appear with null review fields due to LEFT JOIN semantics. Results are ordered by review rating descending.

## SQL Constructs Tested
- LEFT JOIN + WHERE + ORDER BY together
- `$match` on left-side field (`isPremium`) after join
- `$sort` on joined document field using dot notation
- Pipeline stage order: `$lookup` → `$unwind` → `$match` → `$sort` → `$project`
