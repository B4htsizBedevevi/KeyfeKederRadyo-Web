import initSqlJs from "sql.js";

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync
} from "node:fs";

import {
  join,
  dirname
} from "node:path";

import {
  fileURLToPath
} from "node:url";

const __dirname =
  dirname(
    fileURLToPath(import.meta.url)
  );

/*
 * Database server klasöründe tutuluyor.
 */
const DB_PATH =
  join(
    __dirname,
    "users.db.bin"
  );

let db = null;

/* =========================================================
   INIT
========================================================= */

export async function initDb() {
  console.log("[DB] Başlatılıyor...");

  const SQL =
    await initSqlJs();

  /*
   * Klasörün mevcut olduğundan emin ol.
   */
  mkdirSync(
    dirname(DB_PATH),
    {
      recursive: true
    }
  );

  if (
    existsSync(DB_PATH)
  ) {
    console.log(
      "[DB] Mevcut veritabanı yükleniyor..."
    );

    const buffer =
      readFileSync(DB_PATH);

    db =
      new SQL.Database(buffer);
  } else {
    console.log(
      "[DB] Yeni veritabanı oluşturuluyor..."
    );

    db =
      new SQL.Database();
  }

  /* =======================================================
     USERS
  ======================================================= */

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      username TEXT
        NOT NULL
        UNIQUE
        COLLATE NOCASE,

      email TEXT
        NOT NULL
        UNIQUE
        COLLATE NOCASE,

      password TEXT
        NOT NULL,

      display_name TEXT,

      avatar_emoji TEXT
        DEFAULT '🎵',

      bio TEXT
        DEFAULT '',

      created_at TEXT
        NOT NULL
        DEFAULT (datetime('now')),

      last_login TEXT,

      is_active INTEGER
        NOT NULL
        DEFAULT 1
    )
  `);

  /* =======================================================
     FAVORITES
  ======================================================= */

  db.run(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      user_id INTEGER
        NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      station_id TEXT
        NOT NULL,

      added_at TEXT
        NOT NULL
        DEFAULT (datetime('now')),

      UNIQUE(user_id, station_id)
    )
  `);

  /* =======================================================
     SETTINGS
  ======================================================= */

  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER
        PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

      data TEXT
        NOT NULL
        DEFAULT '{}'
    )
  `);

  /* =======================================================
     HISTORY
  ======================================================= */

  db.run(`
    CREATE TABLE IF NOT EXISTS listen_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      user_id INTEGER
        NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      station_id TEXT
        NOT NULL,

      listened_at TEXT
        NOT NULL
        DEFAULT (datetime('now'))
    )
  `);

  /* =======================================================
     INDEXES
  ======================================================= */

  db.run(`
    CREATE INDEX IF NOT EXISTS
    idx_fav_user
    ON user_favorites(user_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS
    idx_hist_user
    ON listen_history(user_id)
  `);

  persist();

  console.log(
    "[DB] Veritabanı hazır:",
    DB_PATH
  );

  return db;
}

/* =========================================================
   PERSIST
========================================================= */

export function persist() {
  if (!db) {
    return;
  }

  try {
    const data =
      db.export();

    writeFileSync(
      DB_PATH,
      Buffer.from(data)
    );
  } catch (error) {
    console.error(
      "[DB] Persist hatası:",
      error?.message || error
    );
  }
}

/* =========================================================
   INTERNAL CHECK
========================================================= */

function ensureDb() {
  if (!db) {
    throw new Error(
      "Database henüz başlatılmadı."
    );
  }
}

/* =========================================================
   GET
========================================================= */

export function dbGet(
  sql,
  params = []
) {
  ensureDb();

  const stmt =
    db.prepare(sql);

  try {
    stmt.bind(params);

    return stmt.step()
      ? stmt.getAsObject()
      : null;
  } finally {
    stmt.free();
  }
}

/* =========================================================
   ALL
========================================================= */

export function dbAll(
  sql,
  params = []
) {
  ensureDb();

  const stmt =
    db.prepare(sql);

  const rows = [];

  try {
    stmt.bind(params);

    while (stmt.step()) {
      rows.push(
        stmt.getAsObject()
      );
    }

    return rows;
  } finally {
    stmt.free();
  }
}

/* =========================================================
   RUN
========================================================= */

export function dbRun(
  sql,
  params = []
) {
  ensureDb();

  db.run(
    sql,
    params
  );

  const modified =
    db.getRowsModified();

  persist();

  return modified;
}

/* =========================================================
   USERS
========================================================= */

export function createUser({
  username,
  email,
  password,
  display_name
}) {
  ensureDb();

  const cleanUsername =
    String(username || "")
      .trim();

  const cleanEmail =
    String(email || "")
      .trim()
      .toLowerCase();

  const displayName =
    String(
      display_name ||
      cleanUsername
    ).slice(0, 50);

  db.run(
    `
      INSERT INTO users
      (
        username,
        email,
        password,
        display_name
      )
      VALUES (?, ?, ?, ?)
    `,
    [
      cleanUsername,
      cleanEmail,
      password,
      displayName
    ]
  );

  persist();

  return getUserByEmail(
    cleanEmail
  );
}

export function getUserByEmail(
  email
) {
  return dbGet(
    `
      SELECT *
      FROM users
      WHERE email = ?
      AND is_active = 1
    `,
    [
      String(email || "")
        .trim()
        .toLowerCase()
    ]
  );
}

export function getUserByUsername(
  username
) {
  return dbGet(
    `
      SELECT *
      FROM users
      WHERE username = ?
      AND is_active = 1
    `,
    [
      String(username || "")
        .trim()
    ]
  );
}

export function getUserById(
  id
) {
  return dbGet(
    `
      SELECT *
      FROM users
      WHERE id = ?
      AND is_active = 1
    `,
    [
      Number(id)
    ]
  );
}

export function updateLastLogin(
  id
) {
  dbRun(
    `
      UPDATE users
      SET last_login = datetime('now')
      WHERE id = ?
    `,
    [
      Number(id)
    ]
  );
}

export function updateProfile(
  id,
  {
    display_name,
    avatar_emoji,
    bio
  }
) {
  dbRun(
    `
      UPDATE users
      SET
        display_name =
          COALESCE(?, display_name),

        avatar_emoji =
          COALESCE(?, avatar_emoji),

        bio =
          COALESCE(?, bio)

      WHERE id = ?
    `,
    [
      display_name ?? null,
      avatar_emoji ?? null,
      bio ?? null,
      Number(id)
    ]
  );

  return getUserById(id);
}

export function updatePassword(
  id,
  hashedPassword
) {
  dbRun(
    `
      UPDATE users
      SET password = ?
      WHERE id = ?
    `,
    [
      hashedPassword,
      Number(id)
    ]
  );
}

/* =========================================================
   FAVORITES
========================================================= */

export function getFavorites(
  userId
) {
  return dbAll(
    `
      SELECT station_id
      FROM user_favorites
      WHERE user_id = ?
      ORDER BY added_at DESC
    `,
    [
      Number(userId)
    ]
  ).map(
    row => row.station_id
  );
}

export function addFavorite(
  userId,
  stationId
) {
  try {
    dbRun(
      `
        INSERT OR IGNORE
        INTO user_favorites
        (
          user_id,
          station_id
        )
        VALUES (?, ?)
      `,
      [
        Number(userId),
        String(stationId)
      ]
    );

    return true;
  } catch (error) {
    console.error(
      "[DB] Favorite ekleme:",
      error
    );

    return false;
  }
}

export function removeFavorite(
  userId,
  stationId
) {
  dbRun(
    `
      DELETE FROM user_favorites
      WHERE user_id = ?
      AND station_id = ?
    `,
    [
      Number(userId),
      String(stationId)
    ]
  );
}

export function setFavorites(
  userId,
  stationIds
) {
  const id =
    Number(userId);

  dbRun(
    `
      DELETE FROM user_favorites
      WHERE user_id = ?
    `,
    [id]
  );

  const unique =
    [
      ...new Set(
        stationIds
          .map(String)
          .map(
            value =>
              value.trim()
          )
          .filter(Boolean)
      )
    ];

  for (const stationId of unique) {
    db.run(
      `
        INSERT OR IGNORE
        INTO user_favorites
        (
          user_id,
          station_id
        )
        VALUES (?, ?)
      `,
      [
        id,
        stationId
      ]
    );
  }

  persist();
}

/* =========================================================
   SETTINGS
========================================================= */

export function getSettings(
  userId
) {
  const row =
    dbGet(
      `
        SELECT data
        FROM user_settings
        WHERE user_id = ?
      `,
      [
        Number(userId)
      ]
    );

  if (!row) {
    return {};
  }

  try {
    return JSON.parse(
      row.data
    );
  } catch {
    return {};
  }
}

export function saveSettings(
  userId,
  data
) {
  let safeData = {};

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    safeData = data;
  }

  const json =
    JSON.stringify(
      safeData
    );

  dbRun(
    `
      INSERT INTO user_settings
      (
        user_id,
        data
      )
      VALUES (?, ?)

      ON CONFLICT(user_id)
      DO UPDATE SET
        data = excluded.data
    `,
    [
      Number(userId),
      json
    ]
  );
}

/* =========================================================
   HISTORY
========================================================= */

export function addHistory(
  userId,
  stationId
) {
  const id =
    Number(userId);

  db.run(
    `
      INSERT INTO listen_history
      (
        user_id,
        station_id
      )
      VALUES (?, ?)
    `,
    [
      id,
      String(stationId)
    ]
  );

  /*
   * Kullanıcının son 50 kaydı dışındakileri sil.
   */
  db.run(
    `
      DELETE FROM listen_history

      WHERE user_id = ?

      AND id NOT IN (
        SELECT id
        FROM listen_history
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50
      )
    `,
    [
      id,
      id
    ]
  );

  persist();
}

export function getHistory(
  userId,
  limit = 50
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number(limit) || 50
      )
    );

  return dbAll(
    `
      SELECT station_id
      FROM listen_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [
      Number(userId),
      safeLimit
    ]
  ).map(
    row => row.station_id
  );
}

/* =========================================================
   STATS
========================================================= */

export function getUserStats(
  userId
) {
  const favorites =
    dbGet(
      `
        SELECT COUNT(*) AS c
        FROM user_favorites
        WHERE user_id = ?
      `,
      [
        Number(userId)
      ]
    )?.c ?? 0;

  const listened =
    dbGet(
      `
        SELECT COUNT(*) AS c
        FROM listen_history
        WHERE user_id = ?
      `,
      [
        Number(userId)
      ]
    )?.c ?? 0;

  const totalUsers =
    dbGet(
      `
        SELECT COUNT(*) AS c
        FROM users
        WHERE is_active = 1
      `
    )?.c ?? 0;

  return {
    favorites,
    listened,
    totalUsers
  };
}