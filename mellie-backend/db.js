// Database layer — works in BOTH environments with the same code:
//
//  • Local development : a plain SQLite file (bakery.db) via libsql
//  • Vercel deployment : a Turso cloud database (DATABASE_URL + DATABASE_AUTH_TOKEN)
//
// libsql is a drop-in replacement for better-sqlite3 (same synchronous API:
// .prepare().run()/.get()/.all()), so the rest of the app doesn't change.
//
// CRASH-PROOF BOOT: the app must never fail to start because of storage.
//   1. DATABASE_URL set  + token set  → Turso cloud DB (persistent, for hosting)
//   2. otherwise, writable project dir → local file (normal development)
//   3. otherwise, /tmp writable        → ephemeral file (Vercel with no DB set —
//                                        works, but data resets on cold starts!)
//   4. last resort                     → in-memory (still boots, never crashes)
// /api/health reports which mode is active, so deployment problems are visible.
// On Vercel the project folder is READ-ONLY — never write next to __dirname there.

const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch (_) { /* dotenv is optional */ }

const Database = require('libsql');

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const DATABASE_AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || '').trim();
const ON_VERCEL = process.env.VERCEL === '1';

// Boot diagnostics, surfaced by /api/health so deployment issues are obvious:
//  env: which variables the process actually received (booleans only — no secrets)
//  cloudError: why the Turso connection failed, if it did
const dbDiag = {
  env: { urlSet: DATABASE_URL.length > 0, tokenSet: DATABASE_AUTH_TOKEN.length > 0 },
  cloudError: null,
};

function dirIsWritable(dir) {
  try {
    const probe = path.join(dir, '.db-write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

let db;
let dbMode;

// ---- Attempt 1: Turso cloud.
// libsql 0.5.x API: constructor(path, opts) where opts = { authToken }.
// VERIFIED against node_modules/libsql/index.js lines 74–95: the token is read
// from opts.authToken ONLY. A bare string as the 2nd argument is silently
// ignored → the library sends an EMPTY token → Turso 401 "empty JWT token".
if (DATABASE_URL && !DATABASE_URL.startsWith('file:')) {
  if (!DATABASE_AUTH_TOKEN) {
    console.warn('[db] DATABASE_URL is set but DATABASE_AUTH_TOKEN is missing — ignoring the cloud DB. Add the token, then redeploy.');
  } else {
    try {
      const cloud = new Database(DATABASE_URL, { authToken: DATABASE_AUTH_TOKEN });
      // Force a real round-trip NOW: construction is lazy, so a bad URL/token
      // only surfaces on the first query. Better to know at boot.
      cloud.prepare('SELECT 1 AS ok').get();
      db = cloud;
      dbMode = 'turso';
      console.log('[db] Connected to the Turso cloud database.');
    } catch (err) {
      dbDiag.cloudError = String((err && err.message) || err).slice(0, 300);
      console.error('[db] CLOUD DATABASE CONNECTION FAILED:', dbDiag.cloudError);
      console.error('[db] Check DATABASE_URL (must start with libsql://) and DATABASE_AUTH_TOKEN in your host\'s environment variables, then redeploy.');
      // fall through to local fallbacks below — the site still works
    }
  }
}

// ---- Attempt 2/3/4: local file → /tmp → memory (never crash the app)
if (!db) {
  const repoDir = __dirname;
  if (dirIsWritable(repoDir)) {
    db = new Database('file:' + path.join(repoDir, 'bakery.db'));
    dbMode = 'local-file';
  } else if (dirIsWritable('/tmp')) {
    db = new Database('file:/tmp/mellie-bakery.db');
    dbMode = 'tmp-ephemeral';
    console.warn('[db] Project folder is read-only — using /tmp/mellie-bakery.db (EPHEMERAL: bookings are lost on cold starts). Set DATABASE_URL + DATABASE_AUTH_TOKEN on your host for real persistence.');
  } else {
    db = new Database(':memory:');
    dbMode = 'memory';
    console.warn('[db] No writable filesystem found — using an in-memory database (data resets on every restart).');
  }
}

try { db.pragma('journal_mode = WAL'); } catch (_) { /* not supported on remote databases */ }
try { db.pragma('foreign_keys = ON'); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price       INTEGER NOT NULL,           -- stored in whole rupees
    category    TEXT NOT NULL DEFAULT 'Cakes',
    tag         TEXT NOT NULL DEFAULT '',    -- e.g. BESTSELLER, NEW, SEASONAL
    stock       INTEGER NOT NULL DEFAULT 0,
    image_key   TEXT NOT NULL DEFAULT 'cake',
    image_url   TEXT NOT NULL DEFAULT '',    -- optional per-product photo (absolute URL on Vercel)
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_cake_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    phone        TEXT NOT NULL DEFAULT '',
    occasion     TEXT NOT NULL DEFAULT '',
    design       TEXT NOT NULL DEFAULT '',
    flavor       TEXT NOT NULL DEFAULT '',
    toppings     TEXT NOT NULL DEFAULT '',
    size         TEXT NOT NULL DEFAULT '',
    budget       TEXT NOT NULL DEFAULT '',
    needed_by    TEXT NOT NULL DEFAULT '',
    details      TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS image_slots (
    slot       TEXT PRIMARY KEY,             -- cake|croissant|cupcake|tart|cookie|pastry|hero|story
    url        TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Lightweight migrations for databases created before these columns existed.
const requestCols = db.prepare('PRAGMA table_info(custom_cake_requests)').all().map((c) => c.name);
if (!requestCols.includes('design')) {
  db.exec("ALTER TABLE custom_cake_requests ADD COLUMN design TEXT NOT NULL DEFAULT ''");
}
if (!requestCols.includes('toppings')) {
  db.exec("ALTER TABLE custom_cake_requests ADD COLUMN toppings TEXT NOT NULL DEFAULT ''");
}

const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (!productCols.includes('image_url')) {
  db.exec("ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
}

// Default catalog photos ship with the repo. The image_slots table remembers
// admin replacements (a local path in dev, a Vercel Blob URL when hosted).
const DEFAULT_SLOTS = {
  cake: '/images/strawberry_cloud_cake_v2.jpg',
  croissant: '/images/butter_croissant_v2.jpg',
  cupcake: '/images/berry_bliss_cupcake_v2.jpg',
  tart: '/images/chocolate_dream_tart_v2.jpg',
  cookie: '/images/chocolate_chip_cookies_v2.jpg',
  pastry: '/images/danish_pastry_v2.jpg',
  hero: '/images/hero_vintage_cake_v2.jpg',
  story: '/images/design_floral_cake_v2.jpg',
};

const insertSlot = db.prepare(
  'INSERT INTO image_slots (slot, url) VALUES (?, ?) ON CONFLICT(slot) DO NOTHING'
);
for (const [slot, url] of Object.entries(DEFAULT_SLOTS)) insertSlot.run(slot, url);

// ---------- First-boot data: admin account + starter catalog ----------
// Keeps a freshly deployed site fully usable with zero manual steps.
// `npm run seed` still works and never duplicates anything.
function ensureAdmin() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@melliebakehouse.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.ADMIN_NAME || 'Mellie Admin';
  const bcrypt = require('bcryptjs');
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    name, email, bcrypt.hashSync(password, 10), 'admin'
  );
  console.log(`[db] Created the first admin account: ${email}`);
}

function ensureStarterProducts() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM products').get();
  if (c > 0) return;
  const products = [
    { name: 'Strawberry Cloud Cake',  description: 'Light vanilla sponge, whipped cream & fresh strawberries.', price: 799, category: 'Cakes',    tag: 'BESTSELLER', stock: 12, image_key: 'cake' },
    { name: 'Classic Butter Croissant', description: 'Flaky, buttery layers baked fresh every morning.',        price: 149, category: 'Pastries', tag: 'NEW',        stock: 40, image_key: 'croissant' },
    { name: 'Berry Bliss Cupcake',    description: 'Moist cupcake topped with berry buttercream.',              price: 179, category: 'Cupcakes', tag: 'SEASONAL',   stock: 25, image_key: 'cupcake' },
    { name: 'Chocolate Dream Tart',   description: 'Silky dark chocolate ganache in a crisp shell.',            price: 499, category: 'Cakes',    tag: 'BESTSELLER', stock: 8,  image_key: 'tart' },
  ];
  const insert = db.prepare(
    `INSERT INTO products (name, description, price, category, tag, stock, image_key)
     VALUES (@name, @description, @price, @category, @tag, @stock, @image_key)`
  );
  const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
  insertMany(products);
  console.log('[db] Seeded the 4 starter products.');
}

try {
  ensureAdmin();
  ensureStarterProducts();
} catch (err) {
  console.warn('[db] First-boot data check failed:', err && err.message ? err.message : err);
}

module.exports = db;
module.exports.dbMode = dbMode;
module.exports.dbDiag = dbDiag;
