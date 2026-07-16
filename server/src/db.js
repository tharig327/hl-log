const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../db');
const DB_PATH = path.join(DB_DIR, 'floorsync.db');
fs.mkdirSync(DB_DIR, { recursive: true });

function createDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      pin_hash  TEXT NOT NULL,
      role      TEXT DEFAULT 'tech',
      active    INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      email TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS customers (
      id     INTEGER PRIMARY KEY,
      name   TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS applicator_entries (
      id           INTEGER PRIMARY KEY,
      apn          TEXT,
      press        TEXT,
      terminal     TEXT,
      wire         TEXT,
      customer     TEXT,
      issue        TEXT,
      notes        TEXT,
      status       TEXT DEFAULT 'open',
      priority     TEXT DEFAULT 'normal',
      by_user      TEXT,
      ticket_num   TEXT,
      submitted_by TEXT,
      photos       TEXT DEFAULT '[]',
      date         INTEGER,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS machine_entries (
      id         INTEGER PRIMARY KEY,
      machine    TEXT,
      desc       TEXT,
      result     TEXT,
      customer   TEXT,
      status     TEXT DEFAULT 'open',
      by_user    TEXT,
      ticket_num TEXT,
      photos     TEXT DEFAULT '[]',
      date       INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS setup_entries (
      id         INTEGER PRIMARY KEY,
      terminal   TEXT,
      awg        TEXT,
      issue      TEXT,
      doc        TEXT,
      notes      TEXT,
      customer   TEXT,
      status     TEXT DEFAULT 'open',
      by_user    TEXT,
      ticket_num TEXT,
      photos     TEXT DEFAULT '[]',
      date       INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS queue_order (
      section    TEXT PRIMARY KEY,
      order_json TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO queue_order (section) VALUES ('applicator'), ('machine'), ('setup');
    CREATE TABLE IF NOT EXISTS notify_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      payload    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at    DATETIME,
      status     TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT OR IGNORE INTO meta (key, value) VALUES ('updated_at', CURRENT_TIMESTAMP);
  `);

  return db;
}

module.exports = createDb;
