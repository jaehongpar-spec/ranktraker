const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, 'data.db'))

db.exec(`
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

module.exports = db
