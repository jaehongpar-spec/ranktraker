const { open } = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')

let db

async function getDb() {
  if (db) return db
  db = await open({
    filename: path.join(__dirname, 'data.db'),
    driver: sqlite3.Database
  })
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      product_id TEXT NOT NULL,
      url TEXT,
      image_url TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      natural_rank INTEGER,
      ad_rank_min INTEGER,
      ad_rank_max INTEGER,
      total_scanned INTEGER,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(keyword_id, date),
      FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `)
  return db
}

module.exports = { getDb }
