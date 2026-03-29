# Query 038: DISTINCT

## Objective
Tests `SELECT DISTINCT` to deduplicate results. Validates that `DISTINCT` maps to a `$group` stage using all selected fields as the composite group key, followed by a `$project` to reconstruct the flat output shape.

## SQL Query
```sql
SELECT DISTINCT country, city FROM users LIMIT 100;
```

## Expected MongoDB Pipeline
```javascript
[
  {
    $group: {
      _id: {
        country: "$country",
        city: "$city"
      }
    }
  },
  {
    $project: {
      _id: 0,
      country: "$_id.country",
      city: "$_id.city"
    }
  }
]
```

## Expected Behavior
Returns one document per unique `(country, city)` combination found across the 100 users. Duplicate combinations are collapsed. The result set is unordered — if deterministic ordering is needed, an `ORDER BY` would need to be appended. The number of results is the number of distinct city+country pairs.

## SQL Constructs Tested
- `SELECT DISTINCT` → `$group` with composite `_id` key
- Deduplication via grouping (no accumulators needed)
- `$project` remapping `_id` sub-fields back to top-level output fields
- Multi-column DISTINCT
