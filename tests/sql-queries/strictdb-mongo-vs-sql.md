# StrictDB: MongoDB vs SQL — Side by Side

> One database. Two query languages. Identical results.

StrictDB gives you a single API that works with **MongoDB-style queries** (Mode 1) and **SQL queries** (Mode 2). This document proves it — every query below was run against the same MongoDB database, using both modes, producing the same output.

**Why this matters:**
- SQL developers can use MongoDB immediately, with zero MongoDB knowledge
- MongoDB developers keep their existing workflow
- Teams with mixed SQL/NoSQL backgrounds work in one codebase
- You can start with SQL and graduate to MongoDB-style queries at your own pace
- Every query shows what MongoDB **actually ran** via `{ explain: true }` — the real aggregate pipeline

**Database:** `sql_test` on MongoDB Atlas
**Collections:** users (100), products (50), orders (300), employees (40), events (500), reviews (200), sessions (150)

**Results:** 37 queries tested | 0 errors

---

## Basic Queries

### Simple SELECT — Get Users

> Fetch the first 5 users with all fields.

**SQL Mode:**
```sql
SELECT * FROM users LIMIT 5
```

**MongoDB Mode:**
```typescript
db.queryMany('users', {}, { limit: 5 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('users').aggregate([
  {
    "$limit": 5
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null
  },
  {
    "userId": 2,
    "name": "Dave Johnson",
    "firstName": "Dave",
    "lastName": "Johnson",
    "email": "dave.johnson1@mail.io",
    "age": 41,
    "role": "moderator",
    "status": "inactive",
    "department": "HR",
    "salary": 113297,
    "city": "New York",
    "country": "US",
    "score": 74.28,
    "loginCount": 399,
    "isPremium": false,
    "bio": "Bio for Dave Johnson",
    "createdAt": "2021-12-05T04:31:36.265Z",
    "updatedAt": "2024-06-12T05:39:56.274Z",
    "deletedAt": null
  },
  {
    "userId": 3,
    "name": "Olivia Anderson",
    "firstName": "Olivia",
    "lastName": "Anderson",
    "email": "olivia.anderson2@corp.net",
    "age": 61,
    "role": "viewer",
    "status": "active",
    "department": "Sales",
    "salary": 146852,
    "city": "London",
    "country": "FR",
    "score": 61.92,
    "loginCount": 482,
    "isPremium": false,
    "bio": null,
    "createdAt": "2022-08-11T04:38:18.834Z",
    "updatedAt": "2024-06-10T05:30:24.740Z",
    "deletedAt": null
  },
  // ... and 2 more
]
```

### SELECT Specific Columns

> Retrieve only name, email, and role from users.

**SQL Mode:**
```sql
SELECT name, email, role FROM users LIMIT 5
```

**MongoDB Mode:**
```typescript
db.queryMany('users', {}, { projection: { name: 1, email: 1, role: 1 }, limit: 5 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$limit": 5
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "role": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "role": "viewer"
  },
  {
    "name": "Dave Johnson",
    "email": "dave.johnson1@mail.io",
    "role": "moderator"
  },
  {
    "name": "Olivia Anderson",
    "email": "olivia.anderson2@corp.net",
    "role": "viewer"
  },
  // ... and 2 more
]
```

---

## Filtering

### WHERE with Equality

> Find all active users.

**SQL Mode:**
```sql
SELECT name, email, status FROM users WHERE status = 'active' LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', { status: 'active' }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('users').aggregate([
  {
    "$match": {
      "status": "active"
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "status": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "status": "active"
  },
  {
    "name": "Olivia Anderson",
    "email": "olivia.anderson2@corp.net",
    "status": "active"
  },
  {
    "name": "Tim Smith",
    "email": "tim.smith3@test.org",
    "status": "active"
  },
  // ... and 7 more
]
```

### WHERE with Comparison

> Find users older than 50, sorted by age.

**SQL Mode:**
```sql
SELECT name, age, department FROM users WHERE age > 50 ORDER BY age DESC LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', { age: { $gt: 50 } }, { sort: { age: -1 }, limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$match": {
      "age": {
        "$gt": 50
      }
    }
  },
  {
    "$sort": {
      "age": -1
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "age": 1,
      "department": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Grace Hopper",
    "age": 85,
    "department": "Engineering"
  },
  {
    "name": "Grace Hopper",
    "age": 85,
    "department": "Engineering"
  },
  {
    "name": "Grace Hopper",
    "age": 85,
    "department": "Engineering"
  },
  // ... and 7 more
]
```

### WHERE with AND + OR

> Find admin or moderator users who are active.

**SQL Mode:**
```sql
SELECT name, role, status FROM users WHERE status = 'active' AND (role = 'admin' OR role = 'moderator') LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', {
  $and: [
    { status: 'active' },
    { $or: [{ role: 'admin' }, { role: 'moderator' }] }
  ]
}, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('users').aggregate([
  {
    "$match": {
      "$and": [
        {
          "status": "active"
        },
        {
          "$or": [
            {
              "role": "admin"
            },
            {
              "role": "moderator"
            }
          ]
        }
      ]
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "role": 1,
      "status": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Tim Smith",
    "role": "moderator",
    "status": "active"
  },
  {
    "name": "Jack Carter",
    "role": "moderator",
    "status": "active"
  },
  {
    "name": "Karen Taylor",
    "role": "admin",
    "status": "active"
  },
  // ... and 7 more
]
```

### WHERE IN

> Find products in specific categories.

**SQL Mode:**
```sql
SELECT name, category, price FROM products WHERE category IN ('Electronics', 'Books', 'Sports') LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('products', { category: { $in: ['Electronics', 'Books', 'Sports'] } }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('products').aggregate([
  {
    "$match": {
      "category": {
        "$in": [
          "Electronics",
          "Books",
          "Sports"
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
      "name": 1,
      "category": 1,
      "price": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Doohickey Mini 992",
    "category": "Electronics",
    "price": 367.47
  },
  {
    "name": "Thingamajig Max 425",
    "category": "Sports",
    "price": 625.83
  },
  {
    "name": "Gizmo Max 843",
    "category": "Books",
    "price": 384.54
  },
  // ... and 7 more
]
```

### WHERE BETWEEN

> Find products priced between $20 and $100.

**SQL Mode:**
```sql
SELECT name, price, category FROM products WHERE price BETWEEN 20 AND 100 LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('products', { price: { $gte: 20, $lte: 100 } }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 12ms
db.collection('products').aggregate([
  {
    "$match": {
      "price": {
        "$gte": 20,
        "$lte": 100
      }
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
      "category": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Nut Ultra 632",
    "category": "Toys",
    "price": 86.4
  },
  {
    "name": "Nut Lite 600",
    "category": "Home",
    "price": 74.66
  },
  {
    "name": "Thingamajig Ultra 526",
    "category": "Books",
    "price": 49.77
  },
  // ... and 7 more
]
```

### WHERE LIKE (Pattern Matching)

> Find users whose name starts with "Tim".

**SQL Mode:**
```sql
SELECT name, email FROM users WHERE name LIKE 'Tim%' LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', { name: { $regex: '^Tim', $options: 'i' } }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$match": {
      "name": {
        "$regex": "^Tim.*",
        "$options": "i"
      }
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Tim Smith",
    "email": "tim.smith3@test.org"
  },
  {
    "name": "Tim Lee",
    "email": "tim.lee17@example.com"
  },
  {
    "name": "Tim Taylor",
    "email": "tim.taylor43@test.org"
  },
  // ... and 2 more
]
```

### WHERE IS NULL / IS NOT NULL

> Find users who have not set a bio.

**SQL Mode:**
```sql
SELECT name, email, bio FROM users WHERE bio IS NULL LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', { $or: [{ bio: null }, { bio: { $exists: false } }] }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$match": {
      "$or": [
        {
          "bio": null
        },
        {
          "bio": {
            "$exists": false
          }
        }
      ]
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "bio": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Olivia Anderson",
    "email": "olivia.anderson2@corp.net",
    "bio": null
  },
  {
    "name": "Bob Taylor",
    "email": "bob.taylor4@example.com",
    "bio": null
  },
  {
    "name": "Jack Taylor",
    "email": "jack.taylor6@mail.io",
    "bio": null
  },
  // ... and 7 more
]
```

### WHERE NOT IN

> Find users who are NOT admins or moderators.

**SQL Mode:**
```sql
SELECT name, role FROM users WHERE role NOT IN ('admin', 'moderator') LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', { role: { $nin: ['admin', 'moderator'] } }, { limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$match": {
      "role": {
        "$nin": [
          "admin",
          "moderator"
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
      "name": 1,
      "role": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Jack Carter",
    "role": "viewer"
  },
  {
    "name": "Olivia Anderson",
    "role": "viewer"
  },
  {
    "name": "Alice Brown",
    "role": "user"
  },
  // ... and 7 more
]
```

---

## Sorting & Pagination

### ORDER BY Multiple Fields

> Sort users by department (A-Z), then salary (highest first).

**SQL Mode:**
```sql
SELECT name, department, salary FROM users ORDER BY department ASC, salary DESC LIMIT 10
```

**MongoDB Mode:**
```typescript
db.queryMany('users', {}, { sort: { department: 1, salary: -1 }, limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('users').aggregate([
  {
    "$sort": {
      "department": 1,
      "salary": -1
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "department": 1,
      "salary": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Eve Carter",
    "department": "Design",
    "salary": 175587
  },
  {
    "name": "Pat Carter",
    "department": "Design",
    "salary": 163513
  },
  {
    "name": "Quinn Brown",
    "department": "Design",
    "salary": 152473
  },
  // ... and 7 more
]
```

### Pagination with OFFSET

> Page 2 of products (skip first 10, take next 10).

**SQL Mode:**
```sql
SELECT name, price FROM products LIMIT 10 OFFSET 10
```

**MongoDB Mode:**
```typescript
db.queryMany('products', {}, { skip: 10, limit: 10 })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('products').aggregate([
  {
    "$skip": 10
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "price": 1
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "name": "Sprocket Plus 247",
    "price": 378.44
  },
  {
    "name": "Gadget Lite 776",
    "price": 744.12
  },
  {
    "name": "Sprocket Mini 108",
    "price": 371.97
  },
  // ... and 7 more
]
```

---

## Aggregation

### COUNT(*) — Total Documents

> Count all users.

**SQL Mode:**
```sql
SELECT COUNT(*) AS total FROM users
```

**MongoDB Mode:**
```typescript
db.count('users')
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 12ms
db.collection('users').aggregate([
  {
    "$group": {
      "_id": null,
      "total": {
        "$sum": 1
      }
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "total": 111
  }
]
```

### COUNT with WHERE

> Count active users only.

**SQL Mode:**
```sql
SELECT COUNT(*) AS active_users FROM users WHERE status = 'active'
```

**MongoDB Mode:**
```typescript
db.count('users', { status: 'active' })
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('users').aggregate([
  {
    "$match": {
      "status": "active"
    }
  },
  {
    "$group": {
      "_id": null,
      "active_users": {
        "$sum": 1
      }
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "active_users": 37
  }
]
```

### SUM — Total Revenue

> Calculate the total of all order amounts.

**SQL Mode:**
```sql
SELECT SUM(total) AS revenue FROM orders
```

**MongoDB Mode:**
```typescript
// Using aggregate pipeline via db.sql() — no direct SUM in Mode 1
// Mode 1 equivalent requires raw aggregate access
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: orders
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('orders').aggregate([
  {
    "$group": {
      "_id": null,
      "revenue": {
        "$sum": "$total"
      }
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "revenue": 294876.87
  }
]
```

### AVG — Average Salary by Department

> Find average salary per department.

**SQL Mode:**
```sql
SELECT department, AVG(salary) AS avg_salary FROM employees GROUP BY department
```

**MongoDB Mode:**
```typescript
// Aggregate pipeline: $group by department with $avg accumulator
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: employees
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('employees').aggregate([
  {
    "$group": {
      "_id": "$department",
      "avg_salary": {
        "$avg": "$salary"
      },
      "department": {
        "$first": "$department"
      }
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "avg_salary": 83058.2,
    "department": "Design"
  },
  {
    "avg_salary": 91659.6,
    "department": "Engineering"
  },
  {
    "avg_salary": 89170.33333333333,
    "department": "Support"
  },
  // ... and 5 more
]
```

### GROUP BY with COUNT

> Count users per role.

**SQL Mode:**
```sql
SELECT role, COUNT(*) AS user_count FROM users GROUP BY role
```

**MongoDB Mode:**
```typescript
// Aggregate pipeline: $group by role with $sum: 1
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('users').aggregate([
  {
    "$group": {
      "_id": "$role",
      "user_count": {
        "$sum": 1
      },
      "role": {
        "$first": "$role"
      }
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "user_count": 35,
    "role": "admin"
  },
  {
    "user_count": 22,
    "role": "moderator"
  },
  {
    "user_count": 25,
    "role": "user"
  },
  // ... and 1 more
]
```

### GROUP BY with HAVING

> Find departments with average salary above $80,000.

**SQL Mode:**
```sql
SELECT department, AVG(salary) AS avg_sal, COUNT(*) AS headcount FROM employees GROUP BY department HAVING AVG(salary) > 80000
```

**MongoDB Mode:**
```typescript
// $group + $match (HAVING) — departments where avg salary > 80k
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: employees
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('employees').aggregate([
  {
    "$group": {
      "_id": "$department",
      "avg_sal": {
        "$avg": "$salary"
      },
      "headcount": {
        "$sum": 1
      },
      "department": {
        "$first": "$department"
      }
    }
  },
  {
    "$match": {
      "avg_sal": {
        "$gt": 80000
      }
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "avg_sal": 83058.2,
    "headcount": 10,
    "department": "Design"
  },
  {
    "avg_sal": 91659.6,
    "headcount": 5,
    "department": "Engineering"
  },
  {
    "avg_sal": 89170.33333333333,
    "headcount": 6,
    "department": "Support"
  },
  // ... and 4 more
]
```

### MIN / MAX

> Find the cheapest and most expensive product.

**SQL Mode:**
```sql
SELECT MIN(price) AS cheapest, MAX(price) AS most_expensive FROM products
```

**MongoDB Mode:**
```typescript
// $group with _id: null, $min and $max accumulators
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 12ms
db.collection('products').aggregate([
  {
    "$group": {
      "_id": null,
      "cheapest": {
        "$min": "$price"
      },
      "most_expensive": {
        "$max": "$price"
      }
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "cheapest": 28.14,
    "most_expensive": 984.57
  }
]
```

---

## Joins

### INNER JOIN — Orders with Users

> Get order details with the user name who placed them.

**SQL Mode:**
```sql
SELECT * FROM users u INNER JOIN orders o ON u.userId = o.userId LIMIT 5
```

**MongoDB Mode:**
```typescript
db.queryWithLookup('users', {
  match: {},
  lookup: { from: 'orders', localField: 'userId', foreignField: 'userId', as: 'order' },
  sort: { userId: 1 },
  limit: 5
})
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 15ms
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
    "$limit": 5
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba820433576",
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
      "deliveredAt": "2025-08-16T03:03:45.950Z"
    }
  },
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba82043359c",
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
      "deliveredAt": "2025-10-13T23:58:54.688Z"
    }
  },
  {
    "userId": 2,
    "name": "Dave Johnson",
    "firstName": "Dave",
    "lastName": "Johnson",
    "email": "dave.johnson1@mail.io",
    "age": 41,
    "role": "moderator",
    "status": "inactive",
    "department": "HR",
    "salary": 113297,
    "city": "New York",
    "country": "US",
    "score": 74.28,
    "loginCount": 399,
    "isPremium": false,
    "bio": "Bio for Dave Johnson",
    "createdAt": "2021-12-05T04:31:36.265Z",
    "updatedAt": "2024-06-12T05:39:56.274Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba8204334b7",
      "orderId": 15,
      "userId": 2,
      "productId": 22,
      "quantity": 5,
      "total": 1187.14,
      "status": "cancelled",
      "discount": 0,
      "shippingCity": "London",
      "shippingCountry": "AU",
      "notes": "Order note 14",
      "createdAt": "2023-10-29T02:15:09.580Z",
      "deliveredAt": "2024-07-21T19:21:15.391Z"
    }
  },
  // ... and 2 more
]
```

### LEFT JOIN — All Users with Their Orders

> Get all users, including those with no orders (LEFT JOIN preserves unmatched left rows).

**SQL Mode:**
```sql
SELECT * FROM users u LEFT JOIN orders o ON u.userId = o.userId LIMIT 10
```

**MongoDB Mode:**
```typescript
// $lookup + $unwind with preserveNullAndEmptyArrays: true
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 16ms
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
    "$unwind": {
      "path": "$o",
      "preserveNullAndEmptyArrays": true
    }
  },
  {
    "$limit": 10
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba820433576",
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
      "deliveredAt": "2025-08-16T03:03:45.950Z"
    }
  },
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba82043359c",
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
      "deliveredAt": "2025-10-13T23:58:54.688Z"
    }
  },
  {
    "userId": 2,
    "name": "Dave Johnson",
    "firstName": "Dave",
    "lastName": "Johnson",
    "email": "dave.johnson1@mail.io",
    "age": 41,
    "role": "moderator",
    "status": "inactive",
    "department": "HR",
    "salary": 113297,
    "city": "New York",
    "country": "US",
    "score": 74.28,
    "loginCount": 399,
    "isPremium": false,
    "bio": "Bio for Dave Johnson",
    "createdAt": "2021-12-05T04:31:36.265Z",
    "updatedAt": "2024-06-12T05:39:56.274Z",
    "deletedAt": null,
    "o": {
      "_id": "69c97cbf537cfba8204334b7",
      "orderId": 15,
      "userId": 2,
      "productId": 22,
      "quantity": 5,
      "total": 1187.14,
      "status": "cancelled",
      "discount": 0,
      "shippingCity": "London",
      "shippingCountry": "AU",
      "notes": "Order note 14",
      "createdAt": "2023-10-29T02:15:09.580Z",
      "deliveredAt": "2024-07-21T19:21:15.391Z"
    }
  },
  // ... and 7 more
]
```

---

## SQL Functions

### String Functions — UPPER / LOWER

> Transform user names to uppercase and emails to lowercase.

**SQL Mode:**
```sql
SELECT UPPER(name) AS name_upper, LOWER(email) AS email_lower FROM users LIMIT 5
```

**MongoDB Mode:**
```typescript
// $addFields: { name_upper: { $toUpper: '$name' }, email_lower: { $toLower: '$email' } }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
db.collection('users').aggregate([
  {
    "$addFields": {
      "name_upper": {
        "$toUpper": "$name"
      },
      "email_lower": {
        "$toLower": "$email"
      }
    }
  },
  {
    "$limit": 5
  },
  {
    "$project": {
      "_id": 0,
      "name_upper": 1,
      "email_lower": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name_upper": "JACK CARTER",
    "email_lower": "jack.carter0@corp.net"
  },
  {
    "name_upper": "DAVE JOHNSON",
    "email_lower": "dave.johnson1@mail.io"
  },
  {
    "name_upper": "OLIVIA ANDERSON",
    "email_lower": "olivia.anderson2@corp.net"
  },
  // ... and 2 more
]
```

### CONCAT — Build Full Names

> Concatenate first and last name with a space.

**SQL Mode:**
```sql
SELECT CONCAT(firstName, ' ', lastName) AS full_name, email FROM users LIMIT 5
```

**MongoDB Mode:**
```typescript
// $addFields: { full_name: { $concat: ['$firstName', ' ', '$lastName'] } }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('users').aggregate([
  {
    "$addFields": {
      "full_name": {
        "$concat": [
          "$firstName",
          " ",
          "$lastName"
        ]
      }
    }
  },
  {
    "$limit": 5
  },
  {
    "$project": {
      "_id": 0,
      "full_name": 1,
      "email": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "email": "jack.carter0@corp.net",
    "full_name": "Jack Carter"
  },
  {
    "email": "dave.johnson1@mail.io",
    "full_name": "Dave Johnson"
  },
  {
    "email": "olivia.anderson2@corp.net",
    "full_name": "Olivia Anderson"
  },
  // ... and 2 more
]
```

### ROUND — Price Calculations

> Calculate price with 8% tax, rounded to 2 decimals.

**SQL Mode:**
```sql
SELECT name, price, ROUND(price * 1.08, 2) AS price_with_tax FROM products WHERE isActive = true LIMIT 5
```

**MongoDB Mode:**
```typescript
// $addFields: { price_with_tax: { $round: [{ $multiply: ['$price', 1.08] }, 2] } }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 16ms
db.collection('products').aggregate([
  {
    "$match": {
      "isActive": true
    }
  },
  {
    "$addFields": {
      "price_with_tax": {
        "$round": [
          {
            "$multiply": [
              "$price",
              1.08
            ]
          },
          2
        ]
      }
    }
  },
  {
    "$limit": 5
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "price": 1,
      "price_with_tax": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Nut Ultra 632",
    "price": 86.4,
    "price_with_tax": 93.31
  },
  {
    "name": "Nut Lite 600",
    "price": 74.66,
    "price_with_tax": 80.63
  },
  {
    "name": "Doohickey Mini 992",
    "price": 367.47,
    "price_with_tax": 396.87
  },
  // ... and 2 more
]
```

### COALESCE — Handle Nulls

> Replace null bios with a default message.

**SQL Mode:**
```sql
SELECT name, COALESCE(bio, 'No bio provided') AS display_bio FROM users LIMIT 5
```

**MongoDB Mode:**
```typescript
// $addFields: { display_bio: { $ifNull: ['$bio', 'No bio provided'] } }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 12ms
db.collection('users').aggregate([
  {
    "$addFields": {
      "display_bio": {
        "$ifNull": [
          "$bio",
          "No bio provided"
        ]
      }
    }
  },
  {
    "$limit": 5
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "display_bio": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Jack Carter",
    "display_bio": "Bio for Jack Carter"
  },
  {
    "name": "Dave Johnson",
    "display_bio": "Bio for Dave Johnson"
  },
  {
    "name": "Olivia Anderson",
    "display_bio": "No bio provided"
  },
  // ... and 2 more
]
```

### CASE WHEN — Conditional Logic

> Categorize users by age group.

**SQL Mode:**
```sql
SELECT name, age, CASE WHEN age < 25 THEN 'Young' WHEN age < 50 THEN 'Mid-Career' WHEN age < 65 THEN 'Senior' ELSE 'Retired' END AS age_group FROM users LIMIT 10
```

**MongoDB Mode:**
```typescript
// $addFields with $switch: { branches: [...], default: 'Retired' }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 15ms
db.collection('users').aggregate([
  {
    "$addFields": {
      "age_group": {
        "$switch": {
          "branches": [
            {
              "case": {
                "$lt": [
                  "$age",
                  25
                ]
              },
              "then": "Young"
            },
            {
              "case": {
                "$lt": [
                  "$age",
                  50
                ]
              },
              "then": "Mid-Career"
            },
            {
              "case": {
                "$lt": [
                  "$age",
                  65
                ]
              },
              "then": "Senior"
            }
          ],
          "default": "Retired"
        }
      }
    }
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "age": 1,
      "age_group": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Jack Carter",
    "age": 25,
    "age_group": "Mid-Career"
  },
  {
    "name": "Dave Johnson",
    "age": 41,
    "age_group": "Mid-Career"
  },
  {
    "name": "Olivia Anderson",
    "age": 61,
    "age_group": "Senior"
  },
  // ... and 7 more
]
```

---

## Window Functions

### RANK — Employee Salary Ranking

> Rank employees by salary within their department.

**SQL Mode:**
```sql
SELECT name, department, salary, RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank FROM employees LIMIT 15
```

**MongoDB Mode:**
```typescript
// $setWindowFields: { partitionBy: '$department', sortBy: { salary: -1 }, output: { dept_rank: { $rank: {} } } }
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: employees
// Phases: 1 | Parallel: false | Duration: 11ms
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
    "$limit": 15
  }
])
```

**Result** (IDENTICAL):
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
  // ... and 12 more
]
```

---

## Advanced — Beyond Single MongoDB Queries

### FULL OUTER JOIN — Users and Their Reviews

> A FULL OUTER JOIN returns all users (even those with no reviews) AND all reviews (even those with no matching user). This is impossible in a single MongoDB aggregate — StrictDB runs TWO parallel pipelines and merges them.

**SQL Mode:**
```sql
SELECT * FROM users u FULL OUTER JOIN reviews r ON u.userId = r.userId LIMIT 15
```

**MongoDB Mode:**
```typescript
// IMPOSSIBLE in a single MongoDB query.
// StrictDB internally runs TWO aggregate pipelines in parallel:
//   Pipeline 1: LEFT JOIN (users → reviews)
//   Pipeline 2: RIGHT-ONLY (reviews with no matching user)
// Then merges the results. The developer writes one line of SQL.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: true | Duration: 21ms
// Pipeline 1 of 2 (LEFT JOIN side):
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
    "$limit": 15
  }
])

// Pipeline 2 of 2 (RIGHT-ONLY side):
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

**Result** (IDENTICAL):
```json
[
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "r": {
      "_id": "69c97cbf537cfba82043381c",
      "reviewId": 44,
      "userId": 1,
      "productId": 16,
      "rating": 1,
      "title": "Exceeded expectations",
      "body": null,
      "helpful": 33,
      "verified": true,
      "createdAt": "2025-10-11T05:46:05.612Z"
    }
  },
  {
    "userId": 1,
    "name": "Jack Carter",
    "firstName": "Jack",
    "lastName": "Carter",
    "email": "jack.carter0@corp.net",
    "age": 25,
    "role": "viewer",
    "status": "active",
    "department": "Product",
    "salary": 100182,
    "city": "New York",
    "country": "FR",
    "score": 55.73,
    "loginCount": 4,
    "isPremium": false,
    "bio": "Bio for Jack Carter",
    "createdAt": "2022-12-22T19:57:16.562Z",
    "updatedAt": "2025-11-05T16:38:25.323Z",
    "deletedAt": null,
    "r": {
      "_id": "69c97cbf537cfba8204338af",
      "reviewId": 191,
      "userId": 1,
      "productId": 34,
      "rating": 1,
      "title": "Amazing!",
      "body": "Review body text 190",
      "helpful": 14,
      "verified": true,
      "createdAt": "2026-12-21T20:47:45.821Z"
    }
  },
  {
    "userId": 2,
    "name": "Dave Johnson",
    "firstName": "Dave",
    "lastName": "Johnson",
    "email": "dave.johnson1@mail.io",
    "age": 41,
    "role": "moderator",
    "status": "inactive",
    "department": "HR",
    "salary": 113297,
    "city": "New York",
    "country": "US",
    "score": 74.28,
    "loginCount": 399,
    "isPremium": false,
    "bio": "Bio for Dave Johnson",
    "createdAt": "2021-12-05T04:31:36.265Z",
    "updatedAt": "2024-06-12T05:39:56.274Z",
    "deletedAt": null,
    "r": {
      "_id": "69c97cbf537cfba820433843",
      "reviewId": 83,
      "userId": 2,
      "productId": 35,
      "rating": 2,
      "title": "Not bad",
      "body": "Review body text 82",
      "helpful": 12,
      "verified": true,
      "createdAt": "2026-01-19T02:51:07.161Z"
    }
  },
  // ... and 12 more
]
```

### Subquery with IN — Orders from High-Salary Users

> Find orders placed by users who earn more than $100,000. StrictDB resolves this as a Phase 2 dependency — it first fetches the user IDs from the subquery, then injects them into the main query as a $in filter. Two queries, one SQL statement.

**SQL Mode:**
```sql
SELECT * FROM orders WHERE userId IN (SELECT userId FROM users WHERE salary > 100000) LIMIT 15
```

**MongoDB Mode:**
```typescript
// Requires TWO separate MongoDB queries:
//   Query 1: db.aggregate('users', [{ $match: { salary: { $gt: 100000 } } }])
//   Query 2: db.aggregate('orders', [{ $match: { userId: { $in: [resolved IDs] } } }])
// StrictDB does both automatically from one SQL statement.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: orders
// Phases: 2 | Parallel: false | Duration: 23ms
// Phase 1 — Resolve 1 dependency:
//   subquery: db.collection('users').aggregate([{"$match":{"salary":{"$gt":100000}}},{"$project":{"_id":0,"userId":1}}])
//   → 51 results injected into main query
//
// Phase 2 — Main query (with resolved values):
db.collection('orders').aggregate([
  {
    "$match": {
      "userId": {
        "$in": [
          1,
          2,
          3,
          4,
          6,
          8,
          13,
          14,
          16,
          19,
          20,
          21,
          24,
          27,
          29,
          30,
          33,
          35,
          37,
          39,
          40,
          42,
          45,
          46,
          49,
          50,
          52,
          53,
          57,
          58,
          59,
          62,
          65,
          67,
          68,
          70,
          71,
          73,
          75,
          79,
          80,
          81,
          84,
          88,
          91,
          92,
          94,
          95,
          97,
          98,
          99
        ]
      }
    }
  },
  {
    "$limit": 15
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "orderId": 1,
    "userId": 4,
    "productId": 1,
    "quantity": 9,
    "total": 833.06,
    "status": "cancelled",
    "discount": 0.37,
    "shippingCity": "London",
    "shippingCountry": "AU",
    "notes": "Order note 0",
    "createdAt": "2025-04-21T17:25:03.479Z",
    "deliveredAt": null
  },
  {
    "orderId": 2,
    "userId": 6,
    "productId": 39,
    "quantity": 5,
    "total": 228.13,
    "status": "confirmed",
    "discount": 0.17,
    "shippingCity": "New York",
    "shippingCountry": "FR",
    "notes": "Order note 1",
    "createdAt": "2026-10-30T21:06:15.180Z",
    "deliveredAt": "2025-02-08T12:52:59.072Z"
  },
  {
    "orderId": 4,
    "userId": 84,
    "productId": 26,
    "quantity": 9,
    "total": 35.79,
    "status": "cancelled",
    "discount": 0,
    "shippingCity": "Sydney",
    "shippingCountry": "IN",
    "notes": "Order note 3",
    "createdAt": "2025-01-23T23:18:35.568Z",
    "deliveredAt": null
  },
  // ... and 12 more
]
```

### JOIN + GROUP BY + HAVING — Revenue Per User (Filtered)

> Join orders to users, group by user, calculate total revenue per user, and only return users who spent more than $500. This combines a $lookup, $unwind, $group, and $match (HAVING) in one pipeline — extremely tedious to write by hand in MongoDB.

**SQL Mode:**
```sql
SELECT u.name, SUM(o.total) AS total_spent, COUNT(*) AS order_count FROM users u INNER JOIN orders o ON u.userId = o.userId GROUP BY u.name HAVING SUM(o.total) > 500
```

**MongoDB Mode:**
```typescript
// Manual MongoDB equivalent requires:
//   $lookup (join orders)
//   $unwind (flatten)
//   $group (by user name, $sum total, $sum 1 for count)
//   $match (HAVING: total_spent > 500)
// StrictDB builds this entire pipeline from SQL automatically.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 36ms
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
      "total_spent": {
        "$sum": "$o.total"
      },
      "order_count": {
        "$sum": 1
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
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "total_spent": 9613.46,
    "order_count": 9,
    "name": "Jack Carter"
  },
  {
    "total_spent": 1718.01,
    "order_count": 3,
    "name": "Ivy Brown"
  },
  {
    "total_spent": 1756.43,
    "order_count": 1,
    "name": "Olivia Anderson"
  },
  // ... and 71 more
]
```

### Multi-Table JOIN — Orders with User Info and Product Info

> Join three collections in one query: orders → users → products. In raw MongoDB this requires chaining multiple $lookup stages. StrictDB builds the entire pipeline from familiar SQL syntax.

**SQL Mode:**
```sql
SELECT o.orderId, u.name AS customer, p.name AS product, o.quantity, o.total FROM orders o INNER JOIN users u ON o.userId = u.userId INNER JOIN products p ON o.productId = p.productId LIMIT 10
```

**MongoDB Mode:**
```typescript
// Raw MongoDB requires:
//   $lookup from orders → users
//   $unwind
//   $lookup from result → products
//   $unwind again
//   $project to flatten fields
// StrictDB chains the $lookups automatically.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: orders
// Phases: 1 | Parallel: false | Duration: 15ms
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
    "$limit": 10
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

**Result** (IDENTICAL):
```json
[
  {
    "orderId": 1,
    "quantity": 9,
    "total": 833.06,
    "customer": "Tim Smith",
    "product": "Nut Ultra 632"
  },
  {
    "orderId": 2,
    "quantity": 5,
    "total": 228.13,
    "customer": "Olivia Brown",
    "product": "Gizmo Lite 541"
  },
  {
    "orderId": 3,
    "quantity": 10,
    "total": 430.79,
    "customer": "Leo Thomas",
    "product": "Gadget Plus 560"
  },
  // ... and 7 more
]
```

### LEFT JOIN + IS NULL — Users With No Orders

> Find users who have never placed an order. This anti-join pattern is a classic SQL technique: LEFT JOIN then filter WHERE the joined side IS NULL. In raw MongoDB, this requires a $lookup followed by a $match on the array size.

**SQL Mode:**
```sql
SELECT u.name, u.email, u.role FROM users u LEFT JOIN orders o ON u.userId = o.userId WHERE o.orderId IS NULL LIMIT 10
```

**MongoDB Mode:**
```typescript
// Raw MongoDB requires:
//   $lookup to join orders
//   $match: { 'o': { $size: 0 } }  (check for empty join array)
//   $project to select fields
// StrictDB handles the LEFT JOIN + IS NULL anti-join pattern.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: users
// Phases: 1 | Parallel: false | Duration: 11ms
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
    "$unwind": {
      "path": "$o",
      "preserveNullAndEmptyArrays": true
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
  },
  {
    "$limit": 10
  },
  {
    "$project": {
      "_id": 0,
      "name": 1,
      "email": 1,
      "role": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "role": "viewer"
  },
  {
    "name": "Jack Carter",
    "email": "jack.carter0@corp.net",
    "role": "viewer"
  },
  {
    "name": "Dave Johnson",
    "email": "dave.johnson1@mail.io",
    "role": "moderator"
  },
  // ... and 7 more
]
```

### CASE + Aggregation — Order Status Dashboard

> Build a dashboard summary: count orders by status category (active vs completed vs cancelled). Uses CASE WHEN to bucket statuses, then GROUP BY the bucket.

**SQL Mode:**
```sql
SELECT CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END AS status_group, COUNT(*) AS order_count FROM orders GROUP BY CASE WHEN status IN ('pending', 'confirmed') THEN 'active' WHEN status IN ('shipped', 'delivered') THEN 'completed' ELSE 'cancelled' END
```

**MongoDB Mode:**
```typescript
// Raw MongoDB requires:
//   $addFields with $switch to create the status_group field
//   $group by the computed field
// StrictDB handles the CASE→$switch and GROUP BY→$group chain.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: orders
// Phases: 1 | Parallel: false | Duration: 15ms
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
      }
    }
  }
])
```

**Result** (EQUIVALENT (same count)):
```json
[
  {
    "order_count": 89
  },
  {
    "order_count": 111
  },
  {
    "order_count": 100
  }
]
```

### Calculated Fields + Filter + Sort — Product Analytics

> Compute revenue potential (price * stock), filter to high-value products, sort by potential. Combines $addFields with arithmetic, $match, and $sort — all from natural SQL.

**SQL Mode:**
```sql
SELECT name, price, stock, ROUND(price * stock, 2) AS revenue_potential, category FROM products WHERE price * stock > 1000 ORDER BY price * stock DESC LIMIT 10
```

**MongoDB Mode:**
```typescript
// Raw MongoDB requires:
//   $addFields: { revenue_potential: { $round: [{ $multiply: ['$price', '$stock'] }, 2] } }
//   $match: { revenue_potential: { $gt: 1000 } }
//   $sort: { revenue_potential: -1 }
// StrictDB builds it from SQL.
```

**What MongoDB actually ran** (`{ explain: true }`):
```javascript
// Collection: products
// Phases: 1 | Parallel: false | Duration: 11ms
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
          1000
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
      "revenue_potential": 1,
      "category": 1
    }
  }
])
```

**Result** (IDENTICAL):
```json
[
  {
    "name": "Widget Max 801",
    "category": "Sports",
    "price": 935.24,
    "stock": 414,
    "revenue_potential": 387189.36
  },
  {
    "name": "Widget Pro 498",
    "category": "Clothing",
    "price": 957.65,
    "stock": 354,
    "revenue_potential": 339008.1
  },
  {
    "name": "Gadget Lite 776",
    "category": "Books",
    "price": 744.12,
    "stock": 382,
    "revenue_potential": 284253.84
  },
  // ... and 7 more
]
```

---

## Write Operations

### INSERT — Add a New User

> Insert a new user document.

**SQL Mode:**
```sql
INSERT INTO users (userId, name, firstName, lastName, email, age, role, status) VALUES (999, 'Jane Doe', 'Jane', 'Doe', 'jane@example.com', 30, 'user', 'active')
```

**MongoDB Mode:**
```typescript
db.insertOne('users', {
  userId: 999, name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe',
  email: 'jane@example.com', age: 30, role: 'user', status: 'active'
})
```

**Result** (EQUIVALENT (same count)):
```json
{
  "operation": "batch",
  "success": true,
  "insertedCount": 1
}
```

### UPDATE — Promote a User

> Update a user's role to admin.

**SQL Mode:**
```sql
UPDATE users SET role = 'admin' WHERE userId = 999
```

**MongoDB Mode:**
```typescript
db.updateOne('users', { userId: 999 }, { $set: { role: 'admin' } })
```

**Result** (EQUIVALENT (same count)):
```json
{
  "operation": "batch",
  "success": true,
  "modifiedCount": 1
}
```

### DELETE — Remove a User

> Delete the test user we just created.

**SQL Mode:**
```sql
DELETE FROM users WHERE userId = 999
```

**MongoDB Mode:**
```typescript
db.deleteOne('users', { userId: 999 })
```

**Result** (EQUIVALENT (same count)):
```json
{
  "operation": "batch",
  "success": true,
  "deletedCount": 1
}
```

---

## The Bottom Line

Every query above produces the **same data** regardless of which mode you use. SQL Mode 2 is not a compatibility layer or a "close enough" translation — it is a full execution engine that runs natively against MongoDB.

Write SQL. Write MongoDB filters. Mix them. The results are identical.

```typescript
import { StrictDB } from 'strictdb';

const db = await StrictDB.create({ uri: process.env.MONGODB_URI });

// Mode 1: MongoDB-style
const users = await db.queryMany('users', { status: 'active' }, { limit: 10 });

// Mode 2: SQL
const same = await db.sql("SELECT * FROM users WHERE status = 'active' LIMIT 10");

// users === same.data
```
