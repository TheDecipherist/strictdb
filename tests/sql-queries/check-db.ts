import { config } from 'dotenv';
config();
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env['MONGODB_URI']!;
  console.log('Connecting to:', uri.replace(/:[^@]+@/, ':***@'));

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected!\n');

  // List all databases
  const dbs = await client.db().admin().listDatabases();
  console.log('All databases:');
  for (const db of dbs.databases) {
    console.log(`  ${db.name} (${(db.sizeOnDisk / 1024).toFixed(0)} KB)`);
  }

  // Check sql_test specifically
  const sqlTestDb = client.db('sql_test');
  const cols = await sqlTestDb.listCollections().toArray();
  console.log(`\nsql_test collections (${cols.length}):`);
  for (const col of cols) {
    const count = await sqlTestDb.collection(col.name).countDocuments();
    console.log(`  ${col.name}: ${count} docs`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
