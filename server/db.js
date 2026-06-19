// SQLite database — sql.js (pure JS, zero native deps)
// Safe wrapper that emulates the basic prepared-statement patterns used by google.js

const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');

let SQL;
let db;

// --- Init ---
async function init() {
  if (db) return db;

  SQL = await initSqlJs();

  const datadir = path.join(__dirname, '..', 'data');
  const file = path.join(datadir, 'tokens.db');

  if (!fs.existsSync(datadir)) fs.mkdirSync(datadir, { recursive: true });

  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      picture_url TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      token_resp TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
  `);

  save();
  return db;
}

function save() {
  if (!db) return;
  const datadir = path.join(__dirname, '..', 'data');
  const file = path.join(datadir, 'tokens.db');
  const data = db.export();
  fs.writeFileSync(file, Buffer.from(data));
}

// --- Minimal safe query helpers (emulate what google.js / index.js need) ---

/** Escape a string for safe SQL interpolation */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** SELECT * FROM users WHERE email = ? */
function findUser(email) {
  const res = db.exec("SELECT email, display_name, picture_url, access_token, refresh_token, expires_at, token_resp, updated_at FROM users WHERE email = " + esc(email));
  if (res.length === 0 || !res[0].values || res[0].values.length === 0) return null;
  const row = res[0].values[0];
  const cols = res[0].columns;
  const obj = {};
  for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
  return obj;
}

/** SELECT email, display_name, picture_url FROM users WHERE email = ? */
function findUserInfo(email) {
  const res = db.exec("SELECT email, display_name, picture_url FROM users WHERE email = " + esc(email));
  if (res.length === 0 || !res[0].values || res[0].values.length === 0) return null;
  const row = res[0].values[0];
  const cols = res[0].columns;
  const obj = {};
  for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
  return obj;
}

/** INSERT OR REPLACE INTO users (...) VALUES (...) */
function upsertUser(u) {
  db.run(`INSERT OR REPLACE INTO users (email, display_name, picture_url, access_token, refresh_token, expires_at, token_resp, updated_at) VALUES (${esc(u.email)}, ${esc(u.display_name)}, ${esc(u.picture_url || '')}, ${esc(u.access_token)}, ${esc(u.refresh_token || '')}, ${esc(u.expires_at)}, ${esc(u.token_resp || '')}, ${Date.now()})`);
  save();
}

/** DELETE FROM users WHERE email = ? */
function deleteUser(email) {
  db.run(`DELETE FROM users WHERE email = ${esc(email)}`);
  save();
}

/** SELECT * FROM users ORDER BY email */
function listAllUsers() {
  const res = db.exec("SELECT email, display_name, picture_url, access_token, refresh_token, expires_at, token_resp, updated_at FROM users ORDER BY email");
  if (res.length === 0 || !res[0].values) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
    return obj;
  });
}

module.exports = { init, save, esc, findUser, findUserInfo, upsertUser, deleteUser, listAllUsers };
