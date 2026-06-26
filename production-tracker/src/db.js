const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../db/production.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    target_rate REAL,
    UNIQUE(customer_id, part_number),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    employee_id TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scrap_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reason TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS production_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    shift TEXT DEFAULT 'Day',
    employee_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    qty_produced INTEGER NOT NULL DEFAULT 0,
    qty_scrap INTEGER NOT NULL DEFAULT 0,
    hours_run REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
  );

  CREATE TABLE IF NOT EXISTS scrap_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_log_id INTEGER NOT NULL,
    scrap_reason_id INTEGER NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (production_log_id) REFERENCES production_logs(id),
    FOREIGN KEY (scrap_reason_id) REFERENCES scrap_reasons(id)
  );
`);

const reasons = ['Dimensional', 'Surface Finish', 'Wrong Material', 'Operator Error', 'Tooling Issue', 'Machine Issue', 'Burr/Sharp Edge', 'Other'];
const insertReason = db.prepare('INSERT OR IGNORE INTO scrap_reasons (reason) VALUES (?)');
reasons.forEach(r => insertReason.run(r));

module.exports = db;
