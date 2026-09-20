/**
 * scripts/migrate-to-turso.js
 * Automated migration from local SQLite (data/expobest.sqlite) to Turso Cloud (libSQL).
 *
 * Usage:
 *   node scripts/migrate-to-turso.js
 *   or:
 *   node scripts/migrate-to-turso.js <TURSO_DATABASE_URL> <TURSO_AUTH_TOKEN>
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@libsql/client');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_DB_PATH = path.join(ROOT, 'data', 'expobest.sqlite');

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {}
}

// Read args or env
const tursoUrl = process.argv[2] || process.env.TURSO_DATABASE_URL;
const tursoToken = process.argv[3] || process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
  console.error('\n❌ ERROR: Turso credentials missing!');
  console.error('Please provide TURSO_DATABASE_URL and TURSO_AUTH_TOKEN as environment variables,');
  console.error('or pass them as arguments:');
  console.error('  node scripts/migrate-to-turso.js <TURSO_DATABASE_URL> <TURSO_AUTH_TOKEN>\n');
  process.exit(1);
}

if (!fs.existsSync(LOCAL_DB_PATH)) {
  console.error(`\n❌ ERROR: Local database not found at ${LOCAL_DB_PATH}\n`);
  process.exit(1);
}

const TABLES = [
  'app_state',
  'users',
  'cities',
  'categories',
  'companies',
  'products',
  'services',
  'students',
  'universities',
  'articles',
  'pages',
  'reviews',
  'subscribers',
  'media',
  'audit_log'
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, blocked INTEGER DEFAULT 0, data TEXT);
CREATE TABLE IF NOT EXISTS cities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, city TEXT, category TEXT, type TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, city TEXT, category TEXT, type TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, category TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, city TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS universities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, city TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE, category TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, rating INTEGER, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS subscribers (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY, filename TEXT NOT NULL, url TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, user_name TEXT NOT NULL, action TEXT NOT NULL);
`;

async function runMigration() {
  console.log('\n======================================================');
  console.log('🚀 EXPOBEST: MIGRATION TO TURSO CLOUD DATABASE');
  console.log('======================================================');
  console.log(`Source SQLite: ${LOCAL_DB_PATH}`);
  console.log(`Target Turso : ${tursoUrl}`);

  // 1. Open Local SQLite
  const localDb = new DatabaseSync(LOCAL_DB_PATH);
  console.log('✓ Local SQLite connected.');

  // 2. Open Turso
  const turso = createClient({
    url: tursoUrl,
    authToken: tursoToken
  });

  try {
    await turso.execute('SELECT 1');
    console.log('✓ Turso Cloud connected successfully.');
  } catch (err) {
    console.error('❌ Failed to connect to Turso:', err.message);
    process.exit(1);
  }

  // 3. Create Schema in Turso
  console.log('\n--- Creating schema on Turso ---');
  const stmts = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  for (const s of stmts) {
    await turso.execute(s);
  }
  console.log('✓ Tables verified on Turso.');

  // 4. Count Local Rows
  const localCounts = {};
  for (const table of TABLES) {
    try {
      const row = localDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
      localCounts[table] = row ? row.c : 0;
    } catch {
      localCounts[table] = 0;
    }
  }

  // 5. Migrate Each Table
  console.log('\n--- Migrating rows ---');
  for (const table of TABLES) {
    let rows = [];
    try {
      rows = localDb.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      console.log(`  Table ${table} not found in local db, skipping.`);
      continue;
    }

    if (rows.length === 0) {
      console.log(`  Table [${table}]: 0 rows (skipped)`);
      continue;
    }

    // Get column names
    const cols = Object.keys(rows[0]);
    const marks = cols.map(() => '?').join(',');
    const insertSql = `INSERT OR REPLACE INTO ${table}(${cols.join(',')}) VALUES(${marks})`;

    // Batch insert into Turso
    const batch = rows.map(r => ({
      sql: insertSql,
      args: cols.map(c => r[c] ?? null)
    }));

    await turso.batch(batch, 'write');
    console.log(`  Table [${table}]: ${rows.length} rows migrated ✓`);
  }

  // 6. Verify Turso Counts
  console.log('\n--- Verification: Local vs Turso ---');
  let allMatched = true;
  console.log('------------------------------------------------------');
  console.log('Table                 Local Count    Turso Count    Status');
  console.log('------------------------------------------------------');

  for (const table of TABLES) {
    let tursoCount = 0;
    try {
      const r = await turso.execute(`SELECT COUNT(*) as c FROM ${table}`);
      tursoCount = Number(r.rows[0]?.c || 0);
    } catch {
      tursoCount = 0;
    }

    const localCount = localCounts[table] || 0;
    const match = localCount === tursoCount;
    if (!match) allMatched = false;

    const status = match ? '✓ MATCH' : '❌ MISMATCH';
    console.log(
      `${table.padEnd(22)} ${String(localCount).padEnd(14)} ${String(tursoCount).padEnd(14)} ${status}`
    );
  }
  console.log('------------------------------------------------------');

  if (allMatched) {
    console.log('\n🎉 SUCCESS! All data migrated to Turso Cloud without any loss!');
    console.log('Your ExpoBest project is now ready for production on Vercel!\n');
  } else {
    console.warn('\n⚠️ WARNING: Some table counts did not match. Please review the table above.\n');
  }
}

runMigration().catch(err => {
  console.error('\n❌ Migration failed with error:', err);
  process.exit(1);
});
