const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../db/production.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

class SqlJsWrapper {
  constructor(sqlJs) {
    this._inTransaction = false;
    if (fs.existsSync(DB_PATH)) {
      this._db = new sqlJs.Database(fs.readFileSync(DB_PATH));
    } else {
      this._db = new sqlJs.Database();
    }
  }

  _save() {
    fs.writeFileSync(DB_PATH, Buffer.from(this._db.export()));
  }

  exec(sql) {
    this._db.run(sql);
    if (!this._inTransaction) this._save();
    return this;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...args) {
        const stmt = self._db.prepare(sql);
        stmt.run(args);
        stmt.free();
        const rowidResult = self._db.exec('SELECT last_insert_rowid()');
        const rowid = rowidResult.length ? rowidResult[0].values[0][0] : null;
        if (!self._inTransaction) self._save();
        return { lastInsertRowid: rowid, changes: 1 };
      },
      get(...args) {
        const stmt = self._db.prepare(sql);
        stmt.bind(args);
        const row = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      all(...args) {
        const stmt = self._db.prepare(sql);
        stmt.bind(args);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      }
    };
  }

  transaction(fn) {
    const self = this;
    return function(...args) {
      self._inTransaction = true;
      self._db.run('BEGIN');
      try {
        const result = fn(...args);
        self._db.run('COMMIT');
        self._inTransaction = false;
        self._save();
        return result;
      } catch (e) {
        self._db.run('ROLLBACK');
        self._inTransaction = false;
        throw e;
      }
    };
  }
}

async function createDb() {
  const sqlJs = await initSqlJs();
  const db = new SqlJsWrapper(sqlJs);

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

  const reasons = ['Dimensional','Surface Finish','Wrong Material','Operator Error','Tooling Issue','Machine Issue','Burr/Sharp Edge','Other'];
  const insertReason = db.prepare('INSERT OR IGNORE INTO scrap_reasons (reason) VALUES (?)');
  reasons.forEach(r => insertReason.run(r));

  return db;
}

module.exports = createDb;
