# StrictDB SQL Mode — Advanced Stress Test Results

**Date:** 2026-03-30
**Queries tested:** 45
**Passed:** 45
**Failed:** 0

## Results

| # | Category | Query | Status | Results | Time |
|---|----------|-------|--------|---------|------|
| 1 | Self-Joins | Employee-manager hierarchy | PASS | 20 | 325ms |
| 2 | Window Functions | Top-N per group (top 3 products per category) | PASS | 50 | 18ms |
| 3 | Window Functions | RANK within department | PASS | 30 | 15ms |
| 4 | Window Functions | DENSE_RANK salaries | PASS | 30 | 16ms |
| 5 | Window Functions | LAG — previous order total per user | PASS | 30 | 17ms |
| 6 | Window Functions | LEAD — next session start per user | PASS | 30 | 16ms |
| 7 | Conditional Aggregation | Salary bands by department (CASE in aggregate) | PASS | 8 | 15ms |
| 8 | Conditional Aggregation | Order status pivot per user | PASS | 20 | 16ms |
| 9 | Conditional Aggregation | Event type pivot per user | PASS | 20 | 18ms |
| 10 | Anti-Joins | Users with no orders (LEFT JOIN + IS NULL) | PASS | 20 | 22ms |
| 11 | Anti-Joins | Products never ordered (NOT IN) | PASS | 20 | 37ms |
| 12 | Anti-Joins | Products never reviewed (NOT IN) | PASS | 20 | 40ms |
| 13 | Subqueries | Orders from premium users (IN subquery) | PASS | 20 | 28ms |
| 14 | Subqueries | Users above average age | PASS | 20 | 27ms |
| 15 | Subqueries | High-value orders (above average total) | PASS | 20 | 28ms |
| 16 | Subqueries | Multiple subqueries in WHERE (admin users + electronics products) | PASS | 5 | 33ms |
| 17 | Multi-Table Joins | Three-table: orders → users → products | PASS | 20 | 21ms |
| 18 | Multi-Table Joins | LEFT JOIN with aggregation (user order count) | PASS | 20 | 43ms |
| 19 | Multi-Table Joins | Products with review data (LEFT JOIN + aggregate) | PASS | 20 | 27ms |
| 20 | Full Outer Join | FULL OUTER JOIN users + reviews | PASS | 20 | 23ms |
| 21 | Complex Aggregation | Revenue per customer > $500 (JOIN + GROUP BY + HAVING) | PASS | 20 | 37ms |
| 22 | Complex Aggregation | Multi-aggregate per department | PASS | 8 | 13ms |
| 23 | Complex Aggregation | CASE in GROUP BY (status buckets) | PASS | 3 | 16ms |
| 24 | Functions | COALESCE + CONCAT (null-safe name building) | PASS | 15 | 16ms |
| 25 | Functions | Multi-CASE classification | PASS | 20 | 16ms |
| 26 | Functions | ROUND + arithmetic (tax calculation) | PASS | 15 | 16ms |
| 27 | Functions | UPPER + LOWER + LENGTH | PASS | 10 | 12ms |
| 28 | Functions | SUBSTRING extraction | PASS | 10 | 12ms |
| 29 | Date Operations | EXTRACT year + month from dates | PASS | 15 | 12ms |
| 30 | Date Operations | Date range BETWEEN | PASS | 20 | 12ms |
| 31 | NULL Handling | IS NULL + IS NOT NULL combined | PASS | 20 | 12ms |
| 32 | NULL Handling | COALESCE chain (multi-fallback) | PASS | 15 | 12ms |
| 33 | Complex WHERE | AND + OR + BETWEEN + LIKE + NOT IN combined | PASS | 10 | 16ms |
| 34 | Complex WHERE | Multiple LIKE patterns via OR | PASS | 20 | 12ms |
| 35 | Complex WHERE | NOT IN with large exclusion list | PASS | 15 | 16ms |
| 36 | Arithmetic Expressions | Computed filter + sort (revenue potential) | PASS | 10 | 12ms |
| 37 | Complex Combinations | JOIN + CASE + GROUP BY (price tier analysis) | PASS | 1 | 46ms |
| 38 | Complex Combinations | Multi-join + aggregate + having + sort | PASS | 15 | 38ms |
| 39 | Distinct | SELECT DISTINCT department | PASS | 20 | 13ms |
| 40 | Distinct | DISTINCT with multiple columns | PASS | 50 | 17ms |
| 41 | Pagination | Page 3 of products (OFFSET 20, LIMIT 10) | PASS | 10 | 14ms |
| 42 | Write Operations | INSERT single row | PASS | 1 | 18ms |
| 43 | Write Operations | UPDATE with SET | PASS | 1 | 32ms |
| 44 | Write Operations | DELETE with WHERE | PASS | 1 | 16ms |
| 45 | Functions | IF function (MySQL style) | PASS | 15 | 18ms |

## No failures! Every query passed.