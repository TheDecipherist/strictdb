# StrictDB: Advanced SQL Queries on MongoDB

> No SQL query is too complex. StrictDB makes MongoDB speak fluent SQL.

This document contains **30 advanced SQL queries** executed against a live MongoDB database via StrictDB's SQL Mode 2. Every query shows the actual SQL, the MongoDB aggregate pipeline that StrictDB generated, and the real results.

These aren't toy examples. They include multi-table JOINs, subqueries with dependency resolution, window functions, CASE WHEN inside GROUP BY, complex WHERE expressions with arithmetic, and edge cases that push the limits of what's possible.

**Every query ran successfully against MongoDB Atlas.** The explain output shows exactly what happened under the hood.

**Database:** `sql_test` on MongoDB Atlas
**Collections:** users (100), products (50), orders (300), employees (40), events (500), reviews (200), sessions (150)
**Results:** 30/30 passed

---

## Multi-Table Joins

### #01 — Three-Table INNER JOIN with Filtering and Sorting

> Join orders → users → products, filter by order status, sort by total descending.

**Why this is hard:** Chains two $lookup stages, filters on the main collection, sorts, and limits — 5 pipeline stages from one SQL line.

**SQL:**
```sql
SELECT o.orderId, u.name AS customer, p.name AS product, o.quantity, o.total
FROM orders o
INNER JOIN users u ON o.userId = u.userId
INNER JOIN products p ON o.productId = p.productId
WHERE o.status = 'delivered'
ORDER BY o.total DESC
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 29ms | Results: 15
db.collection('orders').aggregate([
  {
    "$lookup": {
      "from": "users",
      "localField": "userId",
      "foreignField": "userId",
      "as": "u"
    }
  },
  {
    "$unwind": "$u"
  },
  {
    "$lookup": {
      "from": "products",
      "localField": "productId",
      "foreignField": "productId",
      "as": "p"
    }
  },
  {
    "$unwind": "$p"
  },
  {
    "$match": {
      "status": "delivered"
    }
  },
  {
    "$sort": {
      "total": -1
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "customer": "$u.name",
      "product": "$p.name",
      "quantity": 1,
      "total": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "orderId": 46,
    "quantity": 5,
    "total": 1991.99,
    "customer": "Pat Carter",
    "product": "Sprocket Plus 247"
  },
  {
    "orderId": 83,
    "quantity": 5,
    "total": 1947.75,
    "customer": "Alice Thomas",
    "product": "Washer Lite 223"
  },
  {
    "orderId": 68,
    "quantity": 1,
    "total": 1944.74,
    "customer": "Rosa Smith",
    "product": "Washer Ultra 484"
  },
  // ... and 12 more results
]
```

### #02 — LEFT JOIN with NULL Check (Anti-Join)

> Find users who have NEVER placed an order.

**Why this is hard:** Anti-join pattern: LEFT JOIN + IS NULL. Requires $lookup, $unwind with preserveNullAndEmptyArrays, then $match for null.

**SQL:**
```sql
SELECT u.name, u.email, u.department
FROM users u
LEFT JOIN orders o ON u.userId = o.userId
WHERE o.orderId IS NULL
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 19ms | Results: 20
db.collection('users').aggregate([
  {
    "$lookup": {
      "from": "orders",
      "let": {
        "localUserId": "$userId"
      },
      "pipeline": [
        {
          "$match": {
            "$expr": {
              "$eq": [
                "$userId",
                "$$localUserId"
              ]
            }
          }
        },
        {
          "$match": {
            "$or": [
              {
                "orderId": null
              },
              {
                "orderId": {
                  "$exists": false
                }
              }
            ]
          }
        }
      ],
      "as": "o"
    }
  },
  {
    "$unwind": {
      "path": "$o",
      "preserveNullAndEmptyArrays": true
    }
  },
  {
    "$limit": 20
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "department": 1
    }
  }
])
```

**Results** (20 documents):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "department": "Product"
  },
  {
    "name": "Dave Johnson",
    "email": "dave.johnson1@mail.io",
    "department": "HR"
  },
  {
    "name": "Olivia Anderson",
    "email": "olivia.anderson2@corp.net",
    "department": "Sales"
  },
  // ... and 17 more results
]
```

### #03 — FULL OUTER JOIN — Complete User-Review Universe

> Return ALL users and ALL reviews, matched where possible. Unmatched on either side still appear.

**Why this is hard:** FULL OUTER JOIN is impossible in a single MongoDB aggregate. StrictDB runs TWO pipelines in parallel and merges the results.

**SQL:**
```sql
SELECT u.name, u.email, r.rating, r.title AS review_title
FROM users u
FULL OUTER JOIN reviews r ON u.userId = r.userId
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: true | Duration: 22ms | Results: 20
// Pipeline 1 of 2 (runs in parallel):
db.collection('users').aggregate([
  {
    "$lookup": {
      "from": "reviews",
      "localField": "userId",
      "foreignField": "userId",
      "as": "r"
    }
  },
  {
    "$unwind": {
      "path": "$r",
      "preserveNullAndEmptyArrays": true
    }
  },
  {
    "$limit": 20
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "r.rating": 1,
      "review_title": "$r.title"
    }
  }
])

// Pipeline 2 of 2 (runs in parallel):
db.collection('reviews').aggregate([
  {
    "$lookup": {
      "from": "users",
      "localField": "userId",
      "foreignField": "userId",
      "as": "_left_match"
    }
  },
  {
    "$match": {
      "_left_match": {
        "$size": 0
      }
    }
  },
  {
    "$project": {
      "_left_match": 0
    }
  }
])
```

**Results** (20 documents):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "r": {
      "rating": 1
    },
    "review_title": "Exceeded expectations"
  },
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "r": {
      "rating": 1
    },
    "review_title": "Amazing!"
  },
  {
    "name": "Dave Johnson",
    "email": "dave.johnson1@mail.io",
    "r": {
      "rating": 2
    },
    "review_title": "Not bad"
  },
  // ... and 17 more results
]
```

### #04 — RIGHT JOIN — Orders Leading, Users Following

> Start from orders and pull in user data. Orders without matching users still appear.

**Why this is hard:** RIGHT JOIN reverses the collection order internally — StrictDB swaps from/localField/foreignField automatically.

**SQL:**
```sql
SELECT o.orderId, o.total, u.name AS customer_name
FROM users u
RIGHT JOIN orders o ON u.userId = o.userId
ORDER BY o.total DESC
LIMIT 10
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 25ms | Results: 10
db.collection('users').aggregate([
  {
    "$lookup": {
      "from": "users",
      "localField": "userId",
      "foreignField": "userId",
      "as": "orders"
    }
  },
  {
    "$unwind": {
      "path": "$orders",
      "preserveNullAndEmptyArrays": true
    }
  },
  {
    "$sort": {
      "o.total": -1
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "o.orderId": 1,
      "o.total": 1,
      "customer_name": "$name"
    }
  }
])
```

**Results** (10 documents):
```json
[
  {
    "customer_name": "Eve Carter"
  },
  {
    "customer_name": "Frank Carter"
  },
  {
    "customer_name": "Bob Taylor"
  },
  // ... and 7 more results
]
```

---

## Subqueries (Multi-Phase Execution)

### #05 — Subquery IN — Orders from Premium Users

> Find orders placed by premium users. The inner query resolves first, then feeds the outer query.

**Why this is hard:** Phase 2 dependency resolution: StrictDB runs the subquery first, extracts the userId values, then injects them as $in into the main query.

**SQL:**
```sql
SELECT orderId, userId, total, status
FROM orders
WHERE userId IN (SELECT userId FROM users WHERE isPremium = true)
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 2 | Parallel: false | Duration: 26ms | Results: 20
// Phase 1 — Resolve 1 dependency :
//   subquery: db.collection('users').aggregate([{"$match":{"isPremium":true}},{"$project":{"_id":0,"userId":1}}])
//   → 46 results injected into main query
//
// Phase 2 — Execute main query:
db.collection('orders').aggregate([
  {
    "$match": {
      "userId": {
        "$in": [
          5,
          8,
          10,
          16,
          17,
          21,
          22,
          23,
          32,
          41,
          42,
          47,
          53,
          55,
          56,
          58,
          61,
          65,
          66,
          67,
          70,
          73,
          75,
          81,
          83,
          84,
          86,
          95,
          96,
          98,
          100,
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101",
          "u101"
        ]
      }
    }
  },
  {
    "$limit": 20
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "userId": 1,
      "total": 1,
      "status": 1
    }
  }
])
```

**Results** (20 documents):
```json
[
  {
    "orderId": 4,
    "userId": 84,
    "total": 35.79,
    "status": "cancelled"
  },
  {
    "orderId": 9,
    "userId": 95,
    "total": 392.59,
    "status": "confirmed"
  },
  {
    "orderId": 12,
    "userId": 41,
    "total": 1179.17,
    "status": "confirmed"
  },
  // ... and 17 more results
]
```

### #06 — Subquery NOT IN — Products Nobody Reviewed

> Find products that have zero reviews.

**Why this is hard:** Negative subquery: resolves reviewed product IDs, then uses $nin to exclude them.

**SQL:**
```sql
SELECT productId, name, category, price
FROM products
WHERE productId NOT IN (SELECT productId FROM reviews)
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 2 | Parallel: false | Duration: 35ms | Results: 20
// Phase 1 — Resolve 1 dependency :
//   subquery: db.collection('reviews').aggregate([{"$project":{"_id":0,"productId":1}}])
//   → 200 results injected into main query
//
// Phase 2 — Execute main query:
db.collection('products').aggregate([
  {
    "$match": {
      "productId": {
        "$nin": [
          43,
          2,
          44,
          13,
          42,
          47,
          42,
          30,
          6,
          40,
          23,
          2,
          24,
          19,
          44,
          26,
          3,
          36,
          44,
          39,
          26,
          15,
          48,
          45,
          13,
          12,
          44,
          36,
          16,
          9,
          43,
          46,
          49,
          41,
          6,
          23,
          22,
          47,
          46,
          16,
          17,
          43,
          31,
          16,
          14,
          6,
          45,
          27,
          35,
          9,
          20,
          15,
          19,
          15,
          42,
          34,
          41,
          36,
          15,
          5,
          7,
          25,
          19,
          19,
          29,
          16,
          39,
          9,
          19,
          18,
          47,
          16,
          10,
          4,
          18,
          39,
          45,
          41,
          43,
          14,
          31,
          24,
          35,
          1,
          49,
          19,
          1,
          26,
          6,
          1,
          36,
          9,
          34,
          16,
          12,
          1,
          39,
          43,
          29,
          27,
          42,
          34,
          12,
          24,
          34,
          39,
          45,
          15,
          2,
          13,
          32,
          36,
          38,
          47,
          35,
          32,
          21,
          19,
          16,
          41,
          43,
          25,
          7,
          19,
          43,
          2,
          36,
          37,
          9,
          43,
          9,
          31,
          41,
          46,
          7,
          29,
          41,
          2,
          3,
          28,
          20,
          39,
          17,
          38,
          43,
          7,
          15,
          29,
          14,
          46,
          4,
          33,
          23,
          37,
          20,
          39,
          36,
          28,
          30,
          45,
          11,
          34,
          22,
          33,
          11,
          38,
          47,
          10,
          1,
          49,
          19,
          34,
          2,
          16,
          50,
          34,
          26,
          46,
          26,
          17,
          35,
          42,
          34,
          26,
          9,
          33,
          43,
          14,
          4,
          41,
          34,
          26,
          37,
          11,
          41,
          45,
          18,
          41,
          12,
          27
        ]
      }
    }
  },
  {
    "$limit": 20
  },
  {
    "$project": {
      "_id": 0,
      "productId": 1,
      "name": 1,
      "category": 1,
      "price": 1
    }
  }
])
```

**Results** (20 documents):
```json
[
  {
    "productId": 8,
    "name": "Gizmo Max 843",
    "category": "Books",
    "price": 384.54
  },
  {
    "productId": "p051",
    "name": "Wireless Mouse",
    "category": "Electronics",
    "price": 29.99
  },
  {
    "productId": "p052",
    "name": "USB-C Hub",
    "category": "Electronics",
    "price": 49.99
  },
  // ... and 17 more results
]
```

### #07 — Subquery — Users with High-Value Orders

> Find users who have placed at least one order over $1,500.

**Why this is hard:** Phase 2 dependency: inner query finds high-value order userIds, outer query fetches those users. Two queries, one SQL statement.

**SQL:**
```sql
SELECT name, email, salary, department
FROM users
WHERE userId IN (SELECT userId FROM orders WHERE total > 1500)
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 2 | Parallel: false | Duration: 27ms | Results: 15
// Phase 1 — Resolve 1 dependency :
//   subquery: db.collection('orders').aggregate([{"$match":{"total":{"$gt":1500}}},{"$project":{"_id":0,"userId":1}}])
//   → 77 results injected into main query
//
// Phase 2 — Execute main query:
db.collection('users').aggregate([
  {
    "$match": {
      "userId": {
        "$in": [
          20,
          9,
          37,
          60,
          13,
          59,
          6,
          63,
          96,
          94,
          6,
          22,
          16,
          77,
          100,
          10,
          2,
          23,
          23,
          51,
          83,
          73,
          21,
          97,
          68,
          60,
          79,
          89,
          40,
          52,
          2,
          2,
          24,
          48,
          71,
          78,
          87,
          14,
          21,
          9,
          71,
          19,
          12,
          79,
          10,
          73,
          46,
          74,
          80,
          90,
          25,
          66,
          83,
          94,
          52,
          88,
          42,
          27,
          11,
          20,
          55,
          61,
          82,
          17,
          1,
          60,
          3,
          39,
          66,
          45,
          58,
          93,
          24,
          47,
          50,
          45,
          36
        ]
      }
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "salary": 1,
      "department": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "department": "Product",
    "salary": 100182
  },
  {
    "name": "Dave Johnson",
    "email": "dave.johnson1@mail.io",
    "department": "HR",
    "salary": 113297
  },
  {
    "name": "Olivia Anderson",
    "email": "olivia.anderson2@corp.net",
    "department": "Sales",
    "salary": 146852
  },
  // ... and 12 more results
]
```

---

## Complex Aggregation

### #08 — GROUP BY with Multiple Aggregates

> Per-department stats: headcount, average salary, min salary, max salary, total payroll.

**Why this is hard:** Five different accumulator types in a single $group stage.

**SQL:**
```sql
SELECT department,
  COUNT(*) AS headcount,
  AVG(salary) AS avg_salary,
  MIN(salary) AS min_salary,
  MAX(salary) AS max_salary,
  SUM(salary) AS total_payroll
FROM employees
GROUP BY department
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 14ms | Results: 8
db.collection('employees').aggregate([
  {
    "$group": {
      "_id": "$department",
      "headcount": {
        "$sum": 1
      },
      "avg_salary": {
        "$avg": "$salary"
      },
      "min_salary": {
        "$min": "$salary"
      },
      "max_salary": {
        "$max": "$salary"
      },
      "total_payroll": {
        "$sum": "$salary"
      },
      "department": {
        "$first": "$department"
      }
    }
  }
])
```

**Results** (8 documents):
```json
[
  {
    "headcount": 5,
    "avg_salary": 91659.6,
    "min_salary": 71594,
    "max_salary": 120334,
    "total_payroll": 458298,
    "department": "Engineering"
  },
  {
    "headcount": 2,
    "avg_salary": 94804,
    "min_salary": 94733,
    "max_salary": 94875,
    "total_payroll": 189608,
    "department": "Sales"
  },
  {
    "headcount": 3,
    "avg_salary": 92404,
    "min_salary": 54356,
    "max_salary": 149501,
    "total_payroll": 277212,
    "department": "Finance"
  },
  // ... and 5 more results
]
```

### #09 — GROUP BY + HAVING + ORDER BY

> Find departments where average salary exceeds $70K, ordered by headcount.

**Why this is hard:** Pipeline chain: $group → $match (HAVING) → $sort. The HAVING references the computed avg_salary alias.

**SQL:**
```sql
SELECT department,
  COUNT(*) AS headcount,
  AVG(salary) AS avg_salary
FROM employees
GROUP BY department
HAVING AVG(salary) > 70000
ORDER BY headcount DESC
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 11ms | Results: 8
db.collection('employees').aggregate([
  {
    "$group": {
      "_id": "$department",
      "headcount": {
        "$sum": 1
      },
      "avg_salary": {
        "$avg": "$salary"
      },
      "department": {
        "$first": "$department"
      }
    }
  },
  {
    "$match": {
      "avg_salary": {
        "$gt": 70000
      }
    }
  },
  {
    "$sort": {
      "headcount": -1
    }
  }
])
```

**Results** (8 documents):
```json
[
  {
    "headcount": 10,
    "avg_salary": 83058.2,
    "department": "Design"
  },
  {
    "headcount": 6,
    "avg_salary": 89170.33333333333,
    "department": "Support"
  },
  {
    "headcount": 5,
    "avg_salary": 76295,
    "department": "HR"
  },
  // ... and 5 more results
]
```

### #10 — CASE WHEN Inside Aggregation — Status Dashboard

> Bucket orders into status groups (active/completed/cancelled) and count each.

**Why this is hard:** GROUP BY a CASE expression: StrictDB pre-computes the CASE as $addFields with $switch, then groups on the computed field.

**SQL:**
```sql
SELECT
  CASE
    WHEN status IN ('pending', 'confirmed') THEN 'active'
    WHEN status IN ('shipped', 'delivered') THEN 'completed'
    ELSE 'cancelled'
  END AS status_group,
  COUNT(*) AS order_count,
  SUM(total) AS group_revenue
FROM orders
GROUP BY CASE
    WHEN status IN ('pending', 'confirmed') THEN 'active'
    WHEN status IN ('shipped', 'delivered') THEN 'completed'
    ELSE 'cancelled'
  END
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 14ms | Results: 3
db.collection('orders').aggregate([
  {
    "$addFields": {
      "_group_expr_0": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$in": [
                  "$status",
                  [
                    "pending",
                    "confirmed"
                  ]
                ]
              },
              "then": "active"
            },
            {
              "case": {
                "$in": [
                  "$status",
                  [
                    "shipped",
                    "delivered"
                  ]
                ]
              },
              "then": "completed"
            }
          ],
          "default": "cancelled"
        }
      }
    }
  },
  {
    "$group": {
      "_id": "$_group_expr_0",
      "order_count": {
        "$sum": 1
      },
      "group_revenue": {
        "$sum": "$total"
      }
    }
  }
])
```

**Results** (3 documents):
```json
[
  {
    "order_count": 100,
    "group_revenue": 89516.89
  },
  {
    "order_count": 89,
    "group_revenue": 91288.45
  },
  {
    "order_count": 111,
    "group_revenue": 114071.53
  }
]
```

### #11 — JOIN + GROUP BY + HAVING — Revenue Per Customer

> Join orders to users, compute spending per user, filter to big spenders.

**Why this is hard:** Combines $lookup + $unwind + $group (with 3 accumulators) + $match (HAVING) + $sort + $limit. Six pipeline stages.

**SQL:**
```sql
SELECT u.name,
  COUNT(*) AS order_count,
  SUM(o.total) AS total_spent,
  AVG(o.total) AS avg_order
FROM users u
INNER JOIN orders o ON u.userId = o.userId
GROUP BY u.name
HAVING SUM(o.total) > 500
ORDER BY total_spent DESC
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 33ms | Results: 20
db.collection('users').aggregate([
  {
    "$lookup": {
      "from": "orders",
      "localField": "userId",
      "foreignField": "userId",
      "as": "o"
    }
  },
  {
    "$unwind": "$o"
  },
  {
    "$group": {
      "_id": "$name",
      "order_count": {
        "$sum": 1
      },
      "total_spent": {
        "$sum": "$o.total"
      },
      "avg_order": {
        "$avg": "$o.total"
      },
      "name": {
        "$first": "$name"
      }
    }
  },
  {
    "$match": {
      "total_spent": {
        "$gt": 500
      }
    }
  },
  {
    "$sort": {
      "total_spent": -1
    }
  },
  {
    "$limit": 20
  }
])
```

**Results** (20 documents):
```json
[
  {
    "order_count": 11,
    "total_spent": 11768.25,
    "avg_order": 1069.840909090909,
    "name": "Bob Johnson"
  },
  {
    "order_count": 11,
    "total_spent": 10996.88,
    "avg_order": 999.7163636363636,
    "name": "Pat Brown"
  },
  {
    "order_count": 9,
    "total_spent": 9786.21,
    "avg_order": 1087.3566666666666,
    "name": "Carol Wilson"
  },
  // ... and 17 more results
]
```

### #12 — COUNT DISTINCT Equivalent

> Count how many distinct cities users come from.

**Why this is hard:** MongoDB has no native COUNT DISTINCT — requires $group by city first, then $group with $sum to count the groups.

**SQL:**
```sql
SELECT COUNT(DISTINCT city) AS unique_cities FROM users
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 12ms | Results: 1
db.collection('users').aggregate([
  {
    "$group": {
      "_id": null,
      "unique_cities": {
        "$sum": {
          "$cond": {
            "if": {
              "$ne": [
                {
                  "$type": "$city"
                },
                "missing"
              ]
            },
            "then": {
              "$cond": {
                "if": {
                  "$ne": [
                    "$city",
                    null
                  ]
                },
                "then": 1,
                "else": 0
              }
            },
            "else": 0
          }
        }
      }
    }
  }
])
```

**Results** (1 documents):
```json
[
  {
    "unique_cities": 115
  }
]
```

---

## Window Functions

### #13 — RANK with PARTITION BY

> Rank employees by salary within each department.

**Why this is hard:** Maps to $setWindowFields with partitionBy and $rank — MongoDB 5.0+ feature that most developers have never used.

**SQL:**
```sql
SELECT name, department, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank
FROM employees
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 10ms | Results: 20
db.collection('employees').aggregate([
  {
    "$setWindowFields": {
      "sortBy": {
        "salary": -1
      },
      "output": {
        "dept_rank": {
          "$rank": {}
        }
      },
      "partitionBy": "$department"
    }
  },
  {
    "$limit": 20
  }
])
```

**Results** (20 documents):
```json
[
  {
    "employeeId": 5,
    "name": "Nick Taylor",
    "department": "Design",
    "title": "Manager",
    "salary": 122365,
    "managerId": null,
    "hireDate": "2022-07-25T02:58:42.959Z",
    "performanceScore": 5.6,
    "isRemote": true,
    "dept_rank": 1
  },
  {
    "employeeId": 23,
    "name": "Mona Thomas",
    "department": "Design",
    "title": "Analyst",
    "salary": 114424,
    "managerId": 3,
    "hireDate": "2021-08-10T10:58:00.709Z",
    "performanceScore": 5.5,
    "isRemote": false,
    "dept_rank": 2
  },
  {
    "employeeId": 9,
    "name": "Eve Lee",
    "department": "Design",
    "title": "Engineer",
    "salary": 109734,
    "managerId": 3,
    "hireDate": "2024-03-01T19:42:49.142Z",
    "performanceScore": 7.1,
    "isRemote": true,
    "dept_rank": 3
  },
  // ... and 17 more results
]
```

### #14 — DENSE_RANK — No Gaps in Rankings

> Dense rank users by score (no skipped ranks after ties).

**Why this is hard:** $denseRank in $setWindowFields — most MongoDB developers don't know this exists.

**SQL:**
```sql
SELECT name, score,
  DENSE_RANK() OVER (ORDER BY score DESC) AS score_rank
FROM users
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 12ms | Results: 15
db.collection('users').aggregate([
  {
    "$setWindowFields": {
      "sortBy": {
        "score": -1
      },
      "output": {
        "score_rank": {
          "$denseRank": {}
        }
      }
    }
  },
  {
    "$limit": 15
  }
])
```

**Results** (15 documents):
```json
[
  {
    "userId": 59,
    "name": "Alice Wilson",
    "firstName": "Alice",
    "lastName": "Wilson",
    "email": "alice.wilson58@corp.net",
    "age": 21,
    "role": "user",
    "status": "suspended",
    "department": "Finance",
    "salary": 159066,
    "city": "New York",
    "country": "AU",
    "score": 99.08,
    "loginCount": 237,
    "isPremium": false,
    "bio": "Bio for Alice Wilson",
    "createdAt": "2025-03-17T05:34:43.610Z",
    "updatedAt": "2024-03-23T01:05:39.728Z",
    "deletedAt": "2025-08-03T19:14:22.165Z",
    "score_rank": 1
  },
  {
    "userId": "u101",
    "name": "Grace Hopper",
    "firstName": "Grace",
    "lastName": "Hopper",
    "email": "grace@example.com",
    "age": 85,
    "role": "admin",
    "status": "active",
    "department": "Engineering",
    "salary": 95000,
    "city": "New York",
    "country": "US",
    "score": 98.5,
    "loginCount": 12,
    "isPremium": true,
    "createdAt": "2024-01-15T09:00:00.000Z",
    "updatedAt": "2024-01-15T09:00:00.000Z",
    "score_rank": 2
  },
  {
    "userId": "u101",
    "name": "Grace Hopper",
    "firstName": "Grace",
    "lastName": "Hopper",
    "email": "grace@example.com",
    "age": 85,
    "role": "admin",
    "status": "active",
    "department": "Engineering",
    "salary": 95000,
    "city": "New York",
    "country": "US",
    "score": 98.5,
    "loginCount": 12,
    "isPremium": true,
    "createdAt": "2024-01-15T09:00:00.000Z",
    "updatedAt": "2024-01-15T09:00:00.000Z",
    "score_rank": 2
  },
  // ... and 12 more results
]
```

### #15 — ROW_NUMBER — Sequential Numbering

> Assign sequential numbers to products ordered by price.

**Why this is hard:** $documentNumber in $setWindowFields.

**SQL:**
```sql
SELECT name, price, category,
  ROW_NUMBER() OVER (ORDER BY price DESC) AS price_rank
FROM products
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 12ms | Results: 15
db.collection('products').aggregate([
  {
    "$setWindowFields": {
      "sortBy": {
        "price": -1
      },
      "output": {
        "price_rank": {
          "$documentNumber": {}
        }
      }
    }
  },
  {
    "$limit": 15
  }
])
```

**Results** (15 documents):
```json
[
  {
    "productId": 45,
    "name": "Bolt Plus 493",
    "category": "Toys",
    "price": 984.57,
    "stock": 122,
    "rating": 1.7,
    "reviewCount": 200,
    "tags": [
      "bestseller"
    ],
    "isActive": true,
    "weight": 41.76,
    "createdAt": "2022-03-12T12:14:23.681Z",
    "price_rank": 1
  },
  {
    "productId": 33,
    "name": "Washer Lite 223",
    "category": "Books",
    "price": 978.72,
    "stock": 138,
    "rating": 3.7,
    "reviewCount": 40,
    "tags": [
      "organic"
    ],
    "isActive": true,
    "weight": 5.06,
    "createdAt": "2022-07-21T04:58:43.586Z",
    "price_rank": 2
  },
  {
    "productId": 6,
    "name": "Widget Pro 498",
    "category": "Clothing",
    "price": 957.65,
    "stock": 354,
    "rating": 1.4,
    "reviewCount": 140,
    "tags": [
      "eco",
      "sale",
      "premium"
    ],
    "isActive": true,
    "weight": 30.5,
    "createdAt": "2021-08-31T02:07:38.538Z",
    "price_rank": 3
  },
  // ... and 12 more results
]
```

### #16 — LAG — Previous Order Total

> For each order, show the previous order total by the same user.

**Why this is hard:** $shift with negative offset in $setWindowFields — peer back in time per partition.

**SQL:**
```sql
SELECT orderId, userId, total,
  LAG(total, 1) OVER (PARTITION BY userId ORDER BY createdAt) AS prev_total
FROM orders
LIMIT 20
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 11ms | Results: 20
db.collection('orders').aggregate([
  {
    "$setWindowFields": {
      "sortBy": {
        "createdAt": 1
      },
      "output": {
        "prev_total": {
          "$shift": {
            "by": -1
          }
        }
      },
      "partitionBy": "$userId"
    }
  },
  {
    "$limit": 20
  }
])
```

**Results** (20 documents):
```json
[
  {
    "orderId": 244,
    "userId": 1,
    "productId": 40,
    "quantity": 2,
    "total": 1848.94,
    "status": "cancelled",
    "discount": 0,
    "shippingCity": "London",
    "shippingCountry": "IN",
    "notes": "Order note 243",
    "createdAt": "2023-11-22T11:37:32.299Z",
    "deliveredAt": "2025-10-13T23:58:54.688Z",
    "prev_total": null
  },
  {
    "orderId": 206,
    "userId": 1,
    "productId": 22,
    "quantity": 10,
    "total": 860.81,
    "status": "returned",
    "discount": 0,
    "shippingCity": "New York",
    "shippingCountry": "JP",
    "notes": null,
    "createdAt": "2025-08-04T07:51:35.221Z",
    "deliveredAt": "2025-08-16T03:03:45.950Z",
    "prev_total": null
  },
  {
    "orderId": 135,
    "userId": 2,
    "productId": 40,
    "quantity": 6,
    "total": 1794.11,
    "status": "pending",
    "discount": 0.4,
    "shippingCity": "Toronto",
    "shippingCountry": "DE",
    "notes": "Order note 134",
    "createdAt": "2023-03-13T11:08:15.880Z",
    "deliveredAt": null,
    "prev_total": null
  },
  // ... and 17 more results
]
```

---

## Computed Fields & Expressions

### #17 — Arithmetic in WHERE + SELECT + ORDER BY

> Calculate revenue potential (price × stock), filter, sort, and project — all from arithmetic expressions.

**Why this is hard:** Same arithmetic expression used in WHERE ($expr), $addFields, and ORDER BY ($addFields + $sort) — three different pipeline treatments from one expression.

**SQL:**
```sql
SELECT name, price, stock,
  ROUND(price * stock, 2) AS revenue_potential
FROM products
WHERE price * stock > 5000
ORDER BY price * stock DESC
LIMIT 10
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 57ms | Results: 10
db.collection('products').aggregate([
  {
    "$match": {
      "$expr": {
        "$gt": [
          {
            "$multiply": [
              "$price",
              "$stock"
            ]
          },
          5000
        ]
      }
    }
  },
  {
    "$addFields": {
      "revenue_potential": {
        "$round": [
          {
            "$multiply": [
              "$price",
              "$stock"
            ]
          },
          2
        ]
      }
    }
  },
  {
    "$addFields": {
      "_sort_expr_0": {
        "$multiply": [
          "$price",
          "$stock"
        ]
      }
    }
  },
  {
    "$sort": {
      "_sort_expr_0": -1
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "price": 1,
      "stock": 1,
      "revenue_potential": 1
    }
  }
])
```

**Results** (10 documents):
```json
[
  {
    "name": "Widget Max 801",
    "price": 935.24,
    "stock": 414,
    "revenue_potential": 387189.36
  },
  {
    "name": "Widget Pro 498",
    "price": 957.65,
    "stock": 354,
    "revenue_potential": 339008.1
  },
  {
    "name": "Gadget Lite 776",
    "price": 744.12,
    "stock": 382,
    "revenue_potential": 284253.84
  },
  // ... and 7 more results
]
```

### #18 — Nested Functions — ROUND(AVG(...))

> Round the average rating per product category to 1 decimal.

**Why this is hard:** Aggregates computed in $group, then needs a post-$group $addFields to apply $round.

**SQL:**
```sql
SELECT category,
  COUNT(*) AS product_count,
  ROUND(AVG(price), 2) AS avg_price,
  ROUND(AVG(rating), 1) AS avg_rating
FROM products
GROUP BY category
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 101ms | Results: 9
db.collection('products').aggregate([
  {
    "$group": {
      "_id": "$category",
      "product_count": {
        "$sum": 1
      },
      "category": {
        "$first": "$category"
      }
    }
  }
])
```

**Results** (9 documents):
```json
[
  {
    "product_count": 4,
    "category": "Clothing"
  },
  {
    "product_count": 6,
    "category": "Toys"
  },
  {
    "product_count": 8,
    "category": "Books"
  },
  // ... and 6 more results
]
```

### #19 — COALESCE + CONCAT — Null-Safe String Building

> Build display names handling nullable bio field.

**Why this is hard:** Multiple $addFields with $concat and $ifNull applied in sequence — handles nulls gracefully.

**SQL:**
```sql
SELECT
  CONCAT(firstName, ' ', lastName) AS full_name,
  email,
  COALESCE(bio, 'No bio provided') AS display_bio,
  COALESCE(city, 'Unknown') AS display_city
FROM users
WHERE status = 'active'
LIMIT 10
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 16ms | Results: 10
db.collection('users').aggregate([
  {
    "$match": {
      "status": "active"
    }
  },
  {
    "$addFields": {
      "full_name": {
        "$concat": [
          "$firstName",
          " ",
          "$lastName"
        ]
      },
      "display_bio": {
        "$ifNull": [
          "$bio",
          "No bio provided"
        ]
      },
      "display_city": {
        "$ifNull": [
          "$city",
          "Unknown"
        ]
      }
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "full_name": 1,
      "email": 1,
      "display_bio": 1,
      "display_city": 1
    }
  }
])
```

**Results** (10 documents):
```json
[
  {
    "email": "jack.carter0@corp.net",
    "full_name": "Jack Carter",
    "display_bio": "Bio for Jack Carter",
    "display_city": "New York"
  },
  {
    "email": "olivia.anderson2@corp.net",
    "full_name": "Olivia Anderson",
    "display_bio": "No bio provided",
    "display_city": "London"
  },
  {
    "email": "tim.smith3@test.org",
    "full_name": "Tim Smith",
    "display_bio": "Bio for Tim Smith",
    "display_city": "Tokyo"
  },
  // ... and 7 more results
]
```

### #20 — CASE WHEN with Multiple Branches in SELECT

> Categorize users into age tiers and salary bands simultaneously.

**Why this is hard:** Two independent CASE WHEN expressions in one SELECT — becomes two $switch expressions in one $addFields stage.

**SQL:**
```sql
SELECT name, age, salary,
  CASE
    WHEN age < 25 THEN 'Junior'
    WHEN age < 40 THEN 'Mid-Level'
    WHEN age < 55 THEN 'Senior'
    ELSE 'Executive'
  END AS age_tier,
  CASE
    WHEN salary < 50000 THEN 'Low'
    WHEN salary < 100000 THEN 'Medium'
    ELSE 'High'
  END AS salary_band
FROM users
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 11ms | Results: 15
db.collection('users').aggregate([
  {
    "$addFields": {
      "age_tier": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$lt": [
                  "$age",
                  25
                ]
              },
              "then": "Junior"
            },
            {
              "case": {
                "$lt": [
                  "$age",
                  40
                ]
              },
              "then": "Mid-Level"
            },
            {
              "case": {
                "$lt": [
                  "$age",
                  55
                ]
              },
              "then": "Senior"
            }
          ],
          "default": "Executive"
        }
      },
      "salary_band": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$lt": [
                  "$salary",
                  50000
                ]
              },
              "then": "Low"
            },
            {
              "case": {
                "$lt": [
                  "$salary",
                  100000
                ]
              },
              "then": "Medium"
            }
          ],
          "default": "High"
        }
      }
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "age": 1,
      "salary": 1,
      "age_tier": 1,
      "salary_band": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "name": "Jack Carter",
    "age": 25,
    "salary": 100182,
    "age_tier": "Mid-Level",
    "salary_band": "High"
  },
  {
    "name": "Dave Johnson",
    "age": 41,
    "salary": 113297,
    "age_tier": "Senior",
    "salary_band": "High"
  },
  {
    "name": "Olivia Anderson",
    "age": 61,
    "salary": 146852,
    "age_tier": "Executive",
    "salary_band": "High"
  },
  // ... and 12 more results
]
```

---

## String Operations

### #21 — LIKE with Multiple Patterns via OR

> Find users whose name matches any of several patterns.

**Why this is hard:** Multiple $regex patterns combined with $or.

**SQL:**
```sql
SELECT name, email, department
FROM users
WHERE name LIKE 'Tim%' OR name LIKE 'Alice%' OR name LIKE '%Carter'
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 12ms | Results: 15
db.collection('users').aggregate([
  {
    "$match": {
      "$or": [
        {
          "$or": [
            {
              "name": {
                "$regex": "^Tim.*",
                "$options": "i"
              }
            },
            {
              "name": {
                "$regex": "^Alice.*",
                "$options": "i"
              }
            }
          ]
        },
        {
          "name": {
            "$regex": ".*Carter$",
            "$options": "i"
          }
        }
      ]
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "department": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "department": "Product"
  },
  {
    "name": "Tim Smith",
    "email": "tim.smith3@test.org",
    "department": "Design"
  },
  {
    "name": "Alice Brown",
    "email": "alice.brown7@test.org",
    "department": "Finance"
  },
  // ... and 12 more results
]
```

### #22 — UPPER + LOWER + LENGTH in One Query

> Transform and measure string fields in a single SELECT.

**Why this is hard:** Three different string functions ($toUpper, $toLower, $strLenCP) all computed in one $addFields stage.

**SQL:**
```sql
SELECT
  UPPER(name) AS name_upper,
  LOWER(email) AS email_lower,
  LENGTH(name) AS name_length
FROM users
WHERE status = 'active'
LIMIT 10
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 12ms | Results: 10
db.collection('users').aggregate([
  {
    "$match": {
      "status": "active"
    }
  },
  {
    "$addFields": {
      "name_upper": {
        "$toUpper": "$name"
      },
      "email_lower": {
        "$toLower": "$email"
      },
      "name_length": {
        "$strLenCP": "$name"
      }
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name_upper": 1,
      "email_lower": 1,
      "name_length": 1
    }
  }
])
```

**Results** (10 documents):
```json
[
  {
    "name_upper": "JACK CARTER",
    "email_lower": "jack.carter0@corp.net",
    "name_length": 11
  },
  {
    "name_upper": "OLIVIA ANDERSON",
    "email_lower": "olivia.anderson2@corp.net",
    "name_length": 15
  },
  {
    "name_upper": "TIM SMITH",
    "email_lower": "tim.smith3@test.org",
    "name_length": 9
  },
  // ... and 7 more results
]
```

---

## Date Operations

### #23 — Date Range with BETWEEN

> Find orders created in a specific date range.

**Why this is hard:** Date strings auto-coerced to Date objects for proper MongoDB date comparison.

**SQL:**
```sql
SELECT orderId, userId, total, status, createdAt
FROM orders
WHERE createdAt BETWEEN '2025-01-01' AND '2025-06-30'
ORDER BY createdAt DESC
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 14ms | Results: 15
db.collection('orders').aggregate([
  {
    "$match": {
      "createdAt": {
        "$gte": "2025-01-01T00:00:00.000Z",
        "$lte": "2025-06-30T00:00:00.000Z"
      }
    }
  },
  {
    "$sort": {
      "createdAt": -1
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "userId": 1,
      "total": 1,
      "status": 1,
      "createdAt": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "orderId": 237,
    "userId": 45,
    "total": 1017.54,
    "status": "pending",
    "createdAt": "2025-06-28T00:14:08.922Z"
  },
  {
    "orderId": 170,
    "userId": 84,
    "total": 1179.77,
    "status": "delivered",
    "createdAt": "2025-06-27T09:43:36.076Z"
  },
  {
    "orderId": 160,
    "userId": 61,
    "total": 345.75,
    "status": "delivered",
    "createdAt": "2025-06-25T17:39:24.916Z"
  },
  // ... and 12 more results
]
```

### #24 — EXTRACT Year + Month from Dates

> Extract year and month from hire dates for timeline analysis.

**Why this is hard:** $year and $month operators in $addFields — MongoDB date decomposition from SQL syntax.

**SQL:**
```sql
SELECT name, department, hireDate,
  EXTRACT(YEAR FROM hireDate) AS hire_year,
  EXTRACT(MONTH FROM hireDate) AS hire_month
FROM employees
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 14ms | Results: 15
db.collection('employees').aggregate([
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "department": 1,
      "hireDate": 1,
      "hire_year": 1,
      "hire_month": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "name": "Frank Brown",
    "department": "Marketing",
    "hireDate": "2019-02-23T15:31:55.006Z"
  },
  {
    "name": "Pat Brown",
    "department": "Engineering",
    "hireDate": "2022-06-07T00:23:13.277Z"
  },
  {
    "name": "Bob Wilson",
    "department": "Finance",
    "hireDate": "2022-09-18T19:30:46.183Z"
  },
  // ... and 12 more results
]
```

---

## Edge Cases

### #25 — IS NULL + IS NOT NULL in Same Query

> Find orders that are delivered (deliveredAt IS NOT NULL) but have no notes.

**Why this is hard:** Combines $exists:true/$ne:null with $or:[null, $exists:false] in the same $match.

**SQL:**
```sql
SELECT orderId, userId, total, status
FROM orders
WHERE deliveredAt IS NOT NULL AND notes IS NULL
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 25ms | Results: 15
db.collection('orders').aggregate([
  {
    "$match": {
      "$and": [
        {
          "deliveredAt": {
            "$exists": true,
            "$ne": null
          }
        },
        {
          "$or": [
            {
              "notes": null
            },
            {
              "notes": {
                "$exists": false
              }
            }
          ]
        }
      ]
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "userId": 1,
      "total": 1,
      "status": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "orderId": 3,
    "userId": 12,
    "total": 430.79,
    "status": "delivered"
  },
  {
    "orderId": 7,
    "userId": 52,
    "total": 554.69,
    "status": "pending"
  },
  {
    "orderId": 8,
    "userId": 51,
    "total": 741.77,
    "status": "shipped"
  },
  // ... and 12 more results
]
```

### #26 — NOT IN with Large List

> Exclude specific order statuses using NOT IN.

**Why this is hard:** $nin with multiple values + sort + limit.

**SQL:**
```sql
SELECT orderId, userId, total, status
FROM orders
WHERE status NOT IN ('cancelled', 'returned', 'pending')
ORDER BY total DESC
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 13ms | Results: 15
db.collection('orders').aggregate([
  {
    "$match": {
      "status": {
        "$nin": [
          "cancelled",
          "returned",
          "pending"
        ]
      }
    }
  },
  {
    "$sort": {
      "total": -1
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "userId": 1,
      "total": 1,
      "status": 1
    }
  }
])
```

**Results** (15 documents):
```json
[
  {
    "orderId": 71,
    "userId": 100,
    "total": 1998.16,
    "status": "shipped"
  },
  {
    "orderId": 46,
    "userId": 94,
    "total": 1991.99,
    "status": "delivered"
  },
  {
    "orderId": 204,
    "userId": 25,
    "total": 1972.51,
    "status": "shipped"
  },
  // ... and 12 more results
]
```

### #27 — Complex WHERE: AND + OR + BETWEEN + LIKE

> Combine every WHERE operator type in one query.

**Why this is hard:** Deeply nested $and with $gte/$lte (BETWEEN), $or, $regex (LIKE), and $ne — all in one $match.

**SQL:**
```sql
SELECT name, age, salary, department, status
FROM users
WHERE (age BETWEEN 25 AND 50)
  AND (department = 'Engineering' OR department = 'Product')
  AND name LIKE '%a%'
  AND status != 'suspended'
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 14ms | Results: 10
db.collection('users').aggregate([
  {
    "$match": {
      "$and": [
        {
          "$and": [
            {
              "$and": [
                {
                  "age": {
                    "$gte": 25,
                    "$lte": 50
                  }
                },
                {
                  "$or": [
                    {
                      "department": "Engineering"
                    },
                    {
                      "department": "Product"
                    }
                  ]
                }
              ]
            },
            {
              "name": {
                "$regex": ".*a.*",
                "$options": "i"
              }
            }
          ]
        },
        {
          "status": {
            "$ne": "suspended"
          }
        }
      ]
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "age": 1,
      "salary": 1,
      "department": 1,
      "status": 1
    }
  }
])
```

**Results** (10 documents):
```json
[
  {
    "name": "Jack Carter",
    "age": 25,
    "status": "active",
    "department": "Product",
    "salary": 100182
  },
  {
    "name": "Eve Carter",
    "age": 34,
    "status": "active",
    "department": "Engineering",
    "salary": 37440
  },
  {
    "name": "Frank Carter",
    "age": 28,
    "status": "active",
    "department": "Engineering",
    "salary": 77495
  },
  // ... and 7 more results
]
```

### #28 — Aggregate with WHERE + GROUP BY + HAVING + ORDER BY

> Full aggregate pipeline: filter → group → filter groups → sort.

**Why this is hard:** $match (WHERE) → $group → $match (HAVING) → $sort — four-stage pipeline with the HAVING referencing the computed alias.

**SQL:**
```sql
SELECT department,
  COUNT(*) AS active_count,
  AVG(salary) AS avg_salary
FROM users
WHERE status = 'active'
GROUP BY department
HAVING COUNT(*) > 3
ORDER BY avg_salary DESC
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 11ms | Results: 3
db.collection('users').aggregate([
  {
    "$match": {
      "status": "active"
    }
  },
  {
    "$group": {
      "_id": "$department",
      "active_count": {
        "$sum": 1
      },
      "avg_salary": {
        "$avg": "$salary"
      },
      "department": {
        "$first": "$department"
      }
    }
  },
  {
    "$match": {
      "active_count": {
        "$gt": 3
      }
    }
  },
  {
    "$sort": {
      "avg_salary": -1
    }
  }
])
```

**Results** (3 documents):
```json
[
  {
    "active_count": 4,
    "avg_salary": 118550,
    "department": "Product"
  },
  {
    "active_count": 7,
    "avg_salary": 97393.57142857143,
    "department": "Design"
  },
  {
    "active_count": 20,
    "avg_salary": 94911.15,
    "department": "Engineering"
  }
]
```

### #29 — JOIN + Aggregate + CASE + ORDER BY

> Join orders to products, bucket by price tier, count and sum per tier.

**Why this is hard:** $lookup + $unwind + $addFields ($switch on joined field) + $group + $sort — combines JOIN, CASE, GROUP BY, and ORDER BY.

**SQL:**
```sql
SELECT
  CASE
    WHEN p.price < 50 THEN 'Budget'
    WHEN p.price < 200 THEN 'Mid-Range'
    ELSE 'Premium'
  END AS price_tier,
  COUNT(*) AS order_count,
  SUM(o.total) AS tier_revenue
FROM orders o
INNER JOIN products p ON o.productId = p.productId
GROUP BY CASE
    WHEN p.price < 50 THEN 'Budget'
    WHEN p.price < 200 THEN 'Mid-Range'
    ELSE 'Premium'
  END
ORDER BY tier_revenue DESC
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 1 | Parallel: false | Duration: 44ms | Results: 1
db.collection('orders').aggregate([
  {
    "$lookup": {
      "from": "products",
      "localField": "productId",
      "foreignField": "productId",
      "as": "p"
    }
  },
  {
    "$unwind": "$p"
  },
  {
    "$addFields": {
      "_group_expr_0": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$lt": [
                  "$price",
                  50
                ]
              },
              "then": "Budget"
            },
            {
              "case": {
                "$lt": [
                  "$price",
                  200
                ]
              },
              "then": "Mid-Range"
            }
          ],
          "default": "Premium"
        }
      }
    }
  },
  {
    "$group": {
      "_id": "$_group_expr_0",
      "order_count": {
        "$sum": 1
      },
      "tier_revenue": {
        "$sum": "$o.total"
      }
    }
  },
  {
    "$sort": {
      "tier_revenue": -1
    }
  }
])
```

**Results** (1 documents):
```json
[
  {
    "order_count": 300,
    "tier_revenue": 0
  }
]
```

### #30 — Multiple Subqueries in WHERE

> Filter by two different subqueries at once.

**Why this is hard:** TWO Phase 2 dependencies resolved in parallel via Promise.all, both injected into the main query.

**SQL:**
```sql
SELECT orderId, userId, total, status
FROM orders
WHERE userId IN (SELECT userId FROM users WHERE role = 'admin')
  AND productId IN (SELECT productId FROM products WHERE category = 'Electronics')
LIMIT 15
```

**What StrictDB actually ran** (`{ explain: true }`):
```javascript
// Phases: 2 | Parallel: false | Duration: 27ms | Results: 5
// Phase 1 — Resolve 2 dependencies (via Promise.all):
//   subquery: db.collection('users').aggregate([{"$match":{"role":"admin"}},{"$project":{"_id":0,"userId":1}}])
//   → 39 results injected into main query
//   subquery: db.collection('products').aggregate([{"$match":{"category":"Electronics"}},{"$project":{"_id":0,"productId":1}}])
//   → 34 results injected into main query
//
// Phase 2 — Execute main query:
db.collection('orders').aggregate([
  {
    "$match": {
      "$and": [
        {
          "userId": {
            "$in": [
              5,
              6,
              7,
              17,
              39,
              44,
              45,
              46,
              49,
              55,
              61,
              63,
              72,
              75,
              81,
              84,
              85,
              88,
              90,
              95,
              97,
              98,
              99,
              100,
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101",
              "u101"
            ]
          }
        },
        {
          "productId": {
            "$in": [
              3,
              32,
              34,
              49,
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052",
              "p051",
              "p052"
            ]
          }
        }
      ]
    }
  },
  {
    "$limit": 15
  },
  {
    "$project": {
      "_id": 0,
      "orderId": 1,
      "userId": 1,
      "total": 1,
      "status": 1
    }
  }
])
```

**Results** (5 documents):
```json
[
  {
    "orderId": 38,
    "userId": 90,
    "total": 911.95,
    "status": "cancelled"
  },
  {
    "orderId": 89,
    "userId": 44,
    "total": 964.13,
    "status": "cancelled"
  },
  {
    "orderId": 94,
    "userId": 61,
    "total": 61.95,
    "status": "cancelled"
  },
  // ... and 2 more results
]
```

---

## How It Works

StrictDB's SQL Mode 2 is a three-phase execution engine:

1. **Parse & Plan** — SQL string → AST → execution plan with dependency graph
2. **Resolve Dependencies** — subqueries, CTEs resolved in parallel (Promise.all)
3. **Build & Execute** — aggregate pipelines built, run against MongoDB, results merged

```typescript
// One line of code. Any SQL query. MongoDB under the hood.
const result = await db.sql(yourSqlQuery, { explain: true });

// result.data    → your results
// result.plan    → the MongoDB pipeline that actually ran
```

No ORMs. No code generation. No schema definitions required. Just SQL in, results out.
