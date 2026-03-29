# Query 069: CASE WHEN with Multiple Branches

## Objective
Test that a CASE WHEN expression with multiple WHEN/THEN branches and an ELSE clause translates into a MongoDB $switch expression with a branches array and a default value.

## SQL Query
```sql
SELECT
  userId,
  name,
  score,
  CASE
    WHEN score >= 90 THEN 'A'
    WHEN score >= 80 THEN 'B'
    WHEN score >= 70 THEN 'C'
    WHEN score >= 60 THEN 'D'
    ELSE 'F'
  END AS grade
FROM users
WHERE status = 'active'
ORDER BY score DESC LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  { $match: { status: "active" } },
  {
    $project: {
      userId: 1,
      name: 1,
      score: 1,
      grade: {
        $switch: {
          branches: [
            { case: { $gte: ["$score", 90] }, then: "A" },
            { case: { $gte: ["$score", 80] }, then: "B" },
            { case: { $gte: ["$score", 70] }, then: "C" },
            { case: { $gte: ["$score", 60] }, then: "D" }
          ],
          default: "F"
        }
      },
      _id: 0
    }
  },
  { $sort: { score: -1 } }
]
```

## Expected Behavior
Each active user is assigned a letter grade based on their score. Branches are evaluated in order — the first matching condition wins. A score of exactly 90 maps to A, not B (strict ordering). Users with a score below 60 receive the default grade F. Results are ordered by score descending. The CASE expression is purely computed and does not modify stored documents.

## SQL Constructs Tested
- `CASE WHEN ... THEN ... ELSE ... END` with four branches
- Ordered branch evaluation (first match wins)
- Numeric comparison operators in WHEN conditions
- `ELSE` clause mapped to $switch `default`
- Column alias for CASE result
