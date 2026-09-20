const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IS_VERCEL = !!process.env.VERCEL;
const ROOT = __dirname;
const LEGACY_DB_FILE = path.join(ROOT, 'data', 'db.json');

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {}
}

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

let tursoClient = null;
let localSql = null;
let mode = 'local'; // 'turso' or 'local'
let initialized = false;

const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return hash.length === candidate.length && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
};

async function initDb() {
  if (initialized) return mode;

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    try {
      const { createClient } = require('@libsql/client');
      tursoClient = createClient({
        url: tursoUrl,
        authToken: tursoToken
      });
      await tursoClient.execute('SELECT 1');
      mode = 'turso';
      console.log('Database mode: TURSO CLOUD (libSQL)');

      // Ensure tables exist on Turso
      const stmts = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        await tursoClient.execute(stmt);
      }

      // Check if app_state is seeded
      const res = await tursoClient.execute('SELECT id FROM app_state WHERE id = 1');
      if (res.rows.length === 0 && fs.existsSync(LEGACY_DB_FILE)) {
        console.log('Turso app_state is empty. Seeding initial data from db.json...');
        const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'));
        await writeDb(legacy);
      }

      initialized = true;
      return mode;
    } catch (err) {
      console.warn('Failed to connect to Turso, falling back to local SQLite:', err.message);
      tursoClient = null;
    }
  }

  // Local SQLite fallback
  mode = 'local';
  const { DatabaseSync } = require('node:sqlite');
  let dbFile = path.join(ROOT, 'data', 'expobest.sqlite');
  if (IS_VERCEL) {
    const tmp = process.env.TMPDIR || os.tmpdir();
    dbFile = path.join(tmp, 'expobest.sqlite');
    try {
      if (!fs.existsSync(dbFile) && fs.existsSync(path.join(ROOT, 'data', 'expobest.sqlite'))) {
        fs.copyFileSync(path.join(ROOT, 'data', 'expobest.sqlite'), dbFile);
      }
    } catch {}
  }

  localSql = new DatabaseSync(dbFile);
  try {
    localSql.function('unicode_lower', s => String(s || '').toLowerCase());
  } catch {}

  localSql.exec(SCHEMA_SQL);

  // Migration for older schemas
  for (const table of ['users', 'cities', 'categories']) {
    const columns = localSql.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
    if (!columns.includes('data')) localSql.exec(`ALTER TABLE ${table} ADD COLUMN data TEXT`);
  }

  // Seed if empty
  if (!localSql.prepare('SELECT id FROM app_state WHERE id=1').get() && fs.existsSync(LEGACY_DB_FILE)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'));
    localSql.prepare('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,?)').run(JSON.stringify(legacy), new Date().toISOString());
    await writeDb(legacy);
  }

  console.log(`Database mode: LOCAL SQLITE (${dbFile})`);
  initialized = true;
  return mode;
}

async function readDb() {
  if (!initialized) await initDb();

  if (mode === 'turso' && tursoClient) {
    const rs = await tursoClient.execute({
      sql: 'SELECT payload FROM app_state WHERE id = 1',
      args: []
    });
    if (rs.rows.length > 0) {
      const payload = rs.rows[0].payload;
      return JSON.parse(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    return {};
  } else {
    const row = localSql.prepare('SELECT payload FROM app_state WHERE id = 1').get();
    return row && row.payload ? JSON.parse(row.payload) : {};
  }
}

async function writeDb(state) {
  if (!initialized) await initDb();
  const now = new Date().toISOString();
  const payloadStr = JSON.stringify(state);

  if (mode === 'turso' && tursoClient) {
    // 1. Update app_state
    await tursoClient.execute({
      sql: 'INSERT INTO app_state(id, payload, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      args: [payloadStr, now]
    });

    // 2. Sync relational tables in batch
    const syncTable = async (name, fields) => {
      if (!Array.isArray(state[name])) return;
      const batch = [
        { sql: `DELETE FROM ${name}`, args: [] }
      ];
      const cols = ['id', ...fields, 'data'];
      const marks = cols.map(() => '?').join(',');
      const insertSql = `INSERT OR REPLACE INTO ${name}(${cols.join(',')}) VALUES(${marks})`;

      for (const x of state[name]) {
        const args = [
          x.id,
          ...fields.map(f => {
            const v = x[f];
            return typeof v === 'boolean' ? Number(v) : v ?? null;
          }),
          JSON.stringify(x)
        ];
        batch.push({ sql: insertSql, args });
      }

      if (batch.length > 0) {
        await tursoClient.batch(batch, 'write');
      }
    };

    await syncTable('users', ['name', 'email', 'role', 'blocked']);
    await syncTable('cities', ['name', 'status']);
    await syncTable('categories', ['name', 'status']);
    await syncTable('companies', ['name', 'slug', 'city', 'category', 'type', 'status']);
    await syncTable('products', ['name', 'slug', 'city', 'category', 'type', 'status']);
    await syncTable('services', ['name', 'city', 'category', 'status']);
    await syncTable('students', ['name', 'slug', 'city', 'status']);
    await syncTable('universities', ['name', 'slug', 'city']);
    await syncTable('articles', ['title', 'slug', 'category', 'status']);
    await syncTable('pages', ['title', 'slug', 'status']);
    await syncTable('reviews', ['name', 'email', 'rating', 'status']);
    await syncTable('subscribers', ['email', 'status']);
    await syncTable('media', ['filename', 'url']);
  } else {
    // Local SQLite
    localSql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=1').run(payloadStr, now);
    const sync = (name, fields) => {
      if (!Array.isArray(state[name])) return;
      localSql.exec(`DELETE FROM ${name}`);
      const cols = ['id', ...fields, 'data'];
      const marks = cols.map(() => '?').join(',');
      const stmt = localSql.prepare(`INSERT OR REPLACE INTO ${name}(${cols.join(',')}) VALUES(${marks})`);
      for (const x of state[name]) {
        stmt.run(
          x.id,
          ...fields.map(f => {
            const v = x[f];
            return typeof v === 'boolean' ? Number(v) : v ?? null;
          }),
          JSON.stringify(x)
        );
      }
    };
    sync('users', ['name', 'email', 'role', 'blocked']);
    sync('cities', ['name', 'status']);
    sync('categories', ['name', 'status']);
    sync('companies', ['name', 'slug', 'city', 'category', 'type', 'status']);
    sync('products', ['name', 'slug', 'city', 'category', 'type', 'status']);
    sync('services', ['name', 'city', 'category', 'status']);
    sync('students', ['name', 'slug', 'city', 'status']);
    sync('universities', ['name', 'slug', 'city']);
    sync('articles', ['title', 'slug', 'category', 'status']);
    sync('pages', ['title', 'slug', 'status']);
    sync('reviews', ['name', 'email', 'rating', 'status']);
    sync('subscribers', ['email', 'status']);
    sync('media', ['filename', 'url']);
  }
}

async function queryStudents({ query, params, countQuery, limit, page }) {
  if (!initialized) await initDb();

  // Normalize query to use LOWER() for Turso and SQLite compatibility
  const normalizedQuery = query.replace(/unicode_lower\(/g, 'LOWER(');
  const normalizedCountQuery = countQuery.replace(/unicode_lower\(/g, 'LOWER(');

  if (mode === 'turso' && tursoClient) {
    const countRes = await tursoClient.execute({
      sql: normalizedCountQuery,
      args: params
    });
    const total = Number(countRes.rows[0]?.c || 0);

    const dataRes = await tursoClient.execute({
      sql: normalizedQuery,
      args: [...params, limit, (page - 1) * limit]
    });
    const rows = dataRes.rows.map(r => ({ data: r.data }));
    return { rows, total };
  } else {
    // Local SQLite supports unicode_lower or LOWER
    const total = localSql.prepare(normalizedCountQuery).get(...params).c;
    const rows = localSql.prepare(normalizedQuery).all(...params, limit, (page - 1) * limit);
    return { rows, total };
  }
}

async function migratePasswords() {
  const state = await readDb();
  let changed = false;
  for (const user of state.users || []) {
    if (user.password && !user.passwordHash) {
      user.passwordHash = hashPassword(user.password);
      delete user.password;
      delete user.token;
      changed = true;
    }
  }
  if (changed) {
    await writeDb(state);
  }
}

function getMode() {
  return mode;
}

module.exports = {
  initDb,
  readDb,
  writeDb,
  queryStudents,
  migratePasswords,
  hashPassword,
  verifyPassword,
  getMode
};
