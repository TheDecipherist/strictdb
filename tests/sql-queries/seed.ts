/**
 * SQL Mode 2 — Integration Test Seed Script
 *
 * Seeds the sql_test database with realistic test data across multiple collections.
 * Uses StrictDB to connect and insert data.
 *
 * Run: npx tsx tests/sql-queries/seed.ts
 */

import { config } from 'dotenv';
config();

import { StrictDB } from '../../src/index.js';

const MONGODB_URI = process.env['MONGODB_URI'];
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

// ─── Data Generators ────────────────────────────────────────────────────────

const firstNames = ['Tim', 'Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack', 'Karen', 'Leo', 'Mona', 'Nick', 'Olivia', 'Pat', 'Quinn', 'Rosa', 'Sam'];
const lastNames = ['Carter', 'Smith', 'Johnson', 'Lee', 'Garcia', 'Wilson', 'Brown', 'Taylor', 'Anderson', 'Thomas'];
const departments = ['Engineering', 'Sales', 'Marketing', 'Support', 'HR', 'Finance', 'Product', 'Design'];
const roles = ['admin', 'user', 'moderator', 'viewer'];
const statuses = ['active', 'inactive', 'pending', 'suspended'];
const categories = ['Electronics', 'Books', 'Clothing', 'Food', 'Sports', 'Home', 'Toys', 'Health'];
const cities = ['New York', 'London', 'Tokyo', 'Berlin', 'Paris', 'Sydney', 'Toronto', 'Mumbai'];
const countries = ['US', 'UK', 'JP', 'DE', 'FR', 'AU', 'CA', 'IN'];
const orderStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'];
const tags = ['premium', 'sale', 'new', 'bestseller', 'limited', 'clearance', 'organic', 'eco'];
const eventTypes = ['login', 'logout', 'purchase', 'view', 'click', 'signup', 'error', 'timeout'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randDate(startYear: number, endYear: number): Date {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start));
}

function randEmail(first: string, last: string): string {
  const domains = ['example.com', 'test.org', 'mail.io', 'corp.net'];
  return `${first.toLowerCase()}.${last.toLowerCase()}@${pick(domains)}`;
}

// ─── Collection Data Factories ──────────────────────────────────────────────

function generateUsers(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const first = pick(firstNames);
    const last = pick(lastNames);
    return {
      userId: i + 1,
      name: `${first} ${last}`,
      firstName: first,
      lastName: last,
      email: randEmail(first, `${last}${i}`),
      age: randInt(18, 72),
      role: pick(roles),
      status: pick(statuses),
      department: pick(departments),
      salary: randInt(35000, 180000),
      city: pick(cities),
      country: pick(countries),
      score: randFloat(0, 100),
      loginCount: randInt(0, 500),
      isPremium: Math.random() > 0.7,
      bio: Math.random() > 0.3 ? `Bio for ${first} ${last}` : null,
      createdAt: randDate(2020, 2025),
      updatedAt: randDate(2024, 2026),
      deletedAt: Math.random() > 0.9 ? randDate(2025, 2026) : null,
    };
  });
}

function generateProducts(count: number) {
  const productNames = ['Widget', 'Gadget', 'Doohickey', 'Thingamajig', 'Gizmo', 'Sprocket', 'Cog', 'Bolt', 'Nut', 'Washer'];
  return Array.from({ length: count }, (_, i) => ({
    productId: i + 1,
    name: `${pick(productNames)} ${pick(['Pro', 'Plus', 'Max', 'Mini', 'Ultra', 'Lite'])} ${randInt(100, 999)}`,
    category: pick(categories),
    price: randFloat(1.99, 999.99),
    stock: randInt(0, 500),
    rating: randFloat(1, 5, 1),
    reviewCount: randInt(0, 200),
    tags: pickN(tags, randInt(1, 3)),
    isActive: Math.random() > 0.1,
    weight: randFloat(0.1, 50),
    createdAt: randDate(2021, 2025),
  }));
}

function generateOrders(count: number, maxUserId: number, maxProductId: number) {
  return Array.from({ length: count }, (_, i) => ({
    orderId: i + 1,
    userId: randInt(1, maxUserId),
    productId: randInt(1, maxProductId),
    quantity: randInt(1, 10),
    total: randFloat(5, 2000),
    status: pick(orderStatuses),
    discount: Math.random() > 0.6 ? randFloat(0.05, 0.5) : 0,
    shippingCity: pick(cities),
    shippingCountry: pick(countries),
    notes: Math.random() > 0.5 ? `Order note ${i}` : null,
    createdAt: randDate(2023, 2026),
    deliveredAt: Math.random() > 0.4 ? randDate(2024, 2026) : null,
  }));
}

function generateEmployees(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const first = pick(firstNames);
    const last = pick(lastNames);
    // Create a hierarchy: first 5 are managers (managerId null), rest report to random manager
    const managerId = i < 5 ? null : randInt(1, 5);
    return {
      employeeId: i + 1,
      name: `${first} ${last}`,
      department: pick(departments),
      title: i < 5 ? 'Manager' : pick(['Engineer', 'Analyst', 'Designer', 'Specialist', 'Coordinator']),
      salary: i < 5 ? randInt(100000, 180000) : randInt(45000, 120000),
      managerId,
      hireDate: randDate(2018, 2025),
      performanceScore: randFloat(1, 10, 1),
      isRemote: Math.random() > 0.5,
    };
  });
}

function generateEvents(count: number, maxUserId: number) {
  return Array.from({ length: count }, (_, i) => ({
    eventId: i + 1,
    userId: randInt(1, maxUserId),
    type: pick(eventTypes),
    page: pick(['/home', '/dashboard', '/settings', '/profile', '/products', '/cart', '/checkout']),
    duration: randInt(100, 30000),
    metadata: { browser: pick(['Chrome', 'Firefox', 'Safari', 'Edge']), os: pick(['Windows', 'macOS', 'Linux', 'iOS', 'Android']) },
    timestamp: randDate(2025, 2026),
  }));
}

function generateReviews(count: number, maxUserId: number, maxProductId: number) {
  return Array.from({ length: count }, (_, i) => ({
    reviewId: i + 1,
    userId: randInt(1, maxUserId),
    productId: randInt(1, maxProductId),
    rating: randInt(1, 5),
    title: pick(['Great product', 'Not bad', 'Terrible', 'Amazing!', 'Decent', 'Would buy again', 'Waste of money', 'Exceeded expectations']),
    body: Math.random() > 0.2 ? `Review body text ${i}` : null,
    helpful: randInt(0, 50),
    verified: Math.random() > 0.3,
    createdAt: randDate(2023, 2026),
  }));
}

function generateSessions(count: number, maxUserId: number) {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: `sess_${String(i).padStart(6, '0')}`,
    userId: randInt(1, maxUserId),
    ip: `${randInt(1, 255)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(0, 255)}`,
    userAgent: pick(['Mozilla/5.0', 'Chrome/120', 'Safari/17', 'Edge/120', 'Firefox/121']),
    startedAt: randDate(2025, 2026),
    endedAt: Math.random() > 0.2 ? randDate(2025, 2026) : null,
    pageViews: randInt(1, 50),
    isActive: Math.random() > 0.5,
  }));
}

// ─── Seed ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Connecting to MongoDB Atlas (sql_test)...');
  const db = await StrictDB.create({
    uri: MONGODB_URI!,
    dbName: 'sql_test',
    guardrails: false,
    logging: false,
  });

  console.log('Connected. Seeding data...');

  const USER_COUNT = 100;
  const PRODUCT_COUNT = 50;
  const ORDER_COUNT = 300;
  const EMPLOYEE_COUNT = 40;
  const EVENT_COUNT = 500;
  const REVIEW_COUNT = 200;
  const SESSION_COUNT = 150;

  const users = generateUsers(USER_COUNT);
  const products = generateProducts(PRODUCT_COUNT);
  const orders = generateOrders(ORDER_COUNT, USER_COUNT, PRODUCT_COUNT);
  const employees = generateEmployees(EMPLOYEE_COUNT);
  const events = generateEvents(EVENT_COUNT, USER_COUNT);
  const reviews = generateReviews(REVIEW_COUNT, USER_COUNT, PRODUCT_COUNT);
  const sessions = generateSessions(SESSION_COUNT, USER_COUNT);

  // Drop existing data first
  const raw = db.raw() as { getDb(opts?: unknown): Promise<import('mongodb').Db> };
  const mdb = await raw.getDb();
  const existingCols = await mdb.listCollections().toArray();
  for (const col of existingCols) {
    await mdb.dropCollection(col.name);
  }
  console.log(`Dropped ${existingCols.length} existing collections`);

  // Insert all data
  const collections = [
    { name: 'users', data: users },
    { name: 'products', data: products },
    { name: 'orders', data: orders },
    { name: 'employees', data: employees },
    { name: 'events', data: events },
    { name: 'reviews', data: reviews },
    { name: 'sessions', data: sessions },
  ];

  for (const { name, data } of collections) {
    const receipt = await db.insertMany(name, data);
    console.log(`  ${name}: ${receipt.insertedCount} documents`);
  }

  console.log('\nSeed complete!');
  console.log(`  Collections: ${collections.length}`);
  console.log(`  Total docs: ${collections.reduce((sum, c) => sum + c.data.length, 0)}`);

  await db.close();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
