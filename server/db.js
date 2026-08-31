/**
 * db.js — sql.js tabanlı kalıcı SQLite veritabanı
 *
 * sql.js in-memory çalışır; kalıcılık için her yazma
 * sonrası db dosyasını diske export ediyoruz.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, "..", "users.db.bin");

let db = null;

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
export async function initDb() {
  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const buf = readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Tablolar
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password    TEXT    NOT NULL,
      display_name TEXT,
      avatar_emoji TEXT   DEFAULT '🎵',
      bio         TEXT    DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login  TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id TEXT    NOT NULL,
      added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, station_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data     TEXT NOT NULL DEFAULT '{}'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS listen_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id TEXT    NOT NULL,
      listened_at TEXT   NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_fav_user   ON user_favorites(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hist_user  ON listen_history(user_id)`);

  persist();
  console.log("[DB] Veritabanı hazır →", DB_PATH);
  return db;
}

/* ─────────────────────────────────────────────
   PERSIST  (diske yaz)
───────────────────────────────────────────── */
export function persist() {
  try {
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error("[DB] Persist hatası:", e.message);
  }
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

/** Tek satır döner veya null */
export function dbGet(sql, params = []) {
  const stmt  = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

/** Çok satır döner */
export function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** INSERT / UPDATE / DELETE — etkilenen satır sayısını döner */
export function dbRun(sql, params = []) {
  db.run(sql, params);
  persist();
  return db.getRowsModified();
}

/* ─────────────────────────────────────────────
   USER CRUD
───────────────────────────────────────────── */

export function createUser({ username, email, password, display_name }) {
  db.run(
    `INSERT INTO users (username, email, password, display_name)
     VALUES (?, ?, ?, ?)`,
    [username.trim(), email.trim().toLowerCase(), password, display_name || username]
  );
  persist();
  return dbGet("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
}

export function getUserByEmail(email) {
  return dbGet("SELECT * FROM users WHERE email = ? AND is_active = 1", [email.toLowerCase()]);
}

export function getUserById(id) {
  return dbGet("SELECT * FROM users WHERE id = ? AND is_active = 1", [id]);
}

export function getUserByUsername(username) {
  return dbGet("SELECT * FROM users WHERE username = ? AND is_active = 1", [username]);
}

export function updateLastLogin(id) {
  db.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [id]);
  persist();
}

export function updateProfile(id, { display_name, avatar_emoji, bio }) {
  db.run(
    `UPDATE users SET
       display_name  = COALESCE(?, display_name),
       avatar_emoji  = COALESCE(?, avatar_emoji),
       bio           = COALESCE(?, bio)
     WHERE id = ?`,
    [display_name ?? null, avatar_emoji ?? null, bio ?? null, id]
  );
  persist();
  return getUserById(id);
}

export function updatePassword(id, hashedPassword) {
  db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, id]);
  persist();
}

/* ─────────────────────────────────────────────
   FAVORITES
───────────────────────────────────────────── */

export function getFavorites(userId) {
  return dbAll(
    "SELECT station_id, added_at FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC",
    [userId]
  ).map(r => r.station_id);
}

export function addFavorite(userId, stationId) {
  try {
    db.run(
      "INSERT OR IGNORE INTO user_favorites (user_id, station_id) VALUES (?, ?)",
      [userId, stationId]
    );
    persist();
    return true;
  } catch { return false; }
}

export function removeFavorite(userId, stationId) {
  db.run(
    "DELETE FROM user_favorites WHERE user_id = ? AND station_id = ?",
    [userId, stationId]
  );
  persist();
}

export function setFavorites(userId, stationIds) {
  db.run("DELETE FROM user_favorites WHERE user_id = ?", [userId]);
  for (const sid of stationIds) {
    db.run(
      "INSERT OR IGNORE INTO user_favorites (user_id, station_id) VALUES (?, ?)",
      [userId, sid]
    );
  }
  persist();
}

/* ─────────────────────────────────────────────
   SETTINGS
───────────────────────────────────────────── */

export function getSettings(userId) {
  const row = dbGet("SELECT data FROM user_settings WHERE user_id = ?", [userId]);
  if (!row) return {};
  try { return JSON.parse(row.data); } catch { return {}; }
}

export function saveSettings(userId, data) {
  const json = JSON.stringify(data);
  db.run(
    `INSERT INTO user_settings (user_id, data) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
    [userId, json]
  );
  persist();
}

/* ─────────────────────────────────────────────
   HISTORY
───────────────────────────────────────────── */

export function addHistory(userId, stationId) {
  db.run(
    "INSERT INTO listen_history (user_id, station_id) VALUES (?, ?)",
    [userId, stationId]
  );
  // 50 kayıttan fazlasını sil
  db.run(
    `DELETE FROM listen_history WHERE id NOT IN (
       SELECT id FROM listen_history
       WHERE user_id = ?
       ORDER BY listened_at DESC LIMIT 50
     ) AND user_id = ?`,
    [userId, userId]
  );
  persist();
}

export function getHistory(userId, limit = 20) {
  return dbAll(
    `SELECT station_id, listened_at FROM listen_history
     WHERE user_id = ?
     ORDER BY listened_at DESC LIMIT ?`,
    [userId, limit]
  ).map(r => r.station_id);
}

/* ─────────────────────────────────────────────
   STATS
───────────────────────────────────────────── */

export function getUserStats(userId) {
  const favCount  = dbGet("SELECT COUNT(*) as c FROM user_favorites WHERE user_id = ?", [userId])?.c ?? 0;
  const histCount = dbGet("SELECT COUNT(*) as c FROM listen_history  WHERE user_id = ?", [userId])?.c ?? 0;
  const totalUsers = dbGet("SELECT COUNT(*) as c FROM users WHERE is_active = 1")?.c ?? 0;
  return { favorites: favCount, listened: histCount, totalUsers };
}
