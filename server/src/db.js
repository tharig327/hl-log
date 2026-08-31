const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '../db');
const DB_PATH = path.join(DB_DIR, 'floorsync.db');
fs.mkdirSync(DB_DIR, { recursive: true });

function createDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

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

    -- ── Maintenance / MRO ────────────────────────────────────────────────────

    -- IQMS read-cache (refreshed via sync, never written by the app)
    CREATE TABLE IF NOT EXISTS equipment (
      iqms_id        TEXT PRIMARY KEY,
      eqno           TEXT,
      class          TEXT,
      descrip        TEXT,
      model          TEXT,
      serialno       TEXT,
      inst_date      TEXT,
      total_units    REAL,
      uom            TEXT,
      location       TEXT,
      loc_desc       TEXT,
      critical       INTEGER DEFAULT 0,
      out_of_service INTEGER DEFAULT 0,
      service_date_out TEXT,
      service_date_in  TEXT,
      last_prod_date   TEXT,
      owner          TEXT,
      vendor_id      TEXT,
      mfgcell_id     TEXT,
      eplant_id      TEXT,
      eplant_name    TEXT,
      synced_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pm_schedule (
      iqms_id            TEXT PRIMARY KEY,
      pmeqmt_id          TEXT,
      pmtasks_id         TEXT,
      taskno             TEXT,
      descrip            TEXT,
      perform_every      REAL,
      uom                TEXT,
      total_units        REAL,
      scheduled_since    TEXT,
      wo_create_threshold REAL,
      hours4tsk          REAL,
      numpeople          REAL,
      last_closed_wo     TEXT,
      act_every          REAL,
      wo_open            INTEGER DEFAULT 0,
      incomplete         INTEGER DEFAULT 0,
      archived           INTEGER DEFAULT 0,
      synced_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pm_template (
      iqms_id   TEXT PRIMARY KEY,
      descrip   TEXT,
      notes     TEXT,
      eplant    TEXT,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pm_template_job (
      iqms_id        TEXT PRIMARY KEY,
      pmtemplate_id  TEXT,
      pmtasks_id     TEXT,
      taskno         TEXT,
      descrip        TEXT,
      perform_every  REAL,
      uom            TEXT,
      total_units    REAL,
      hours4tsk      REAL,
      synced_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pm_template_checklist (
      iqms_id           TEXT PRIMARY KEY,
      pmtemplate_job_id TEXT,
      pmtasks_id        TEXT,
      seq               INTEGER,
      check_text        TEXT,
      critical          INTEGER DEFAULT 0,
      synced_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wo_history (
      pmwo_id          TEXT PRIMARY KEY,
      wo_date          TEXT,
      status           TEXT,
      priority         TEXT,
      wo_type          TEXT,
      department       TEXT,
      requested_by     TEXT,
      start_date       TEXT,
      end_date         TEXT,
      task_number      TEXT,
      task_description TEXT,
      pmeqmt_id        TEXT,
      eqno             TEXT,
      wo_open          INTEGER DEFAULT 0,
      incomplete       INTEGER DEFAULT 0,
      arcusto_company  TEXT,
      vendor_company   TEXT,
      source           TEXT DEFAULT 'iqms',
      synced_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Floor Sync-owned tables (writable)
    CREATE TABLE IF NOT EXISTS spare_supplier (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS critical_spare (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      bin          TEXT UNIQUE,
      category     TEXT,
      description  TEXT,
      part_no      TEXT,
      do_not_order INTEGER DEFAULT 0,
      supplier_raw TEXT,
      supplier_id  INTEGER REFERENCES spare_supplier(id),
      uom          TEXT,
      on_hand      REAL DEFAULT 0,
      min_qty      REAL DEFAULT 0,
      unit_cost    REAL,
      reorder_url  TEXT,
      active       INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS equipment_spare_link (
      equipment_id TEXT,
      spare_id     INTEGER,
      qty_required REAL DEFAULT 1,
      PRIMARY KEY (equipment_id, spare_id)
    );
    CREATE TABLE IF NOT EXISTS work_order (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_number              TEXT UNIQUE,
      equipment_id           TEXT,
      pm_schedule_id         TEXT,
      wo_type                TEXT DEFAULT 'repair',
      status                 TEXT DEFAULT 'open',
      priority               TEXT DEFAULT 'med',
      department             TEXT,
      requested_by           TEXT,
      assigned_to            TEXT,
      description            TEXT,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at             DATETIME,
      completed_at           DATETIME,
      closed_at              DATETIME,
      plant_id               TEXT,
      source                 TEXT DEFAULT 'generated',
      close_incomplete_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS wo_checklist_item (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      seq          INTEGER DEFAULT 0,
      text         TEXT,
      critical     INTEGER DEFAULT 0,
      status       TEXT DEFAULT 'open',
      is_done      INTEGER DEFAULT 0,
      done_by      TEXT,
      done_at      DATETIME,
      note         TEXT
    );
    CREATE TABLE IF NOT EXISTS wo_spare_usage (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      spare_id     INTEGER NOT NULL,
      qty_used     REAL DEFAULT 0,
      used_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_by      TEXT
    );
    CREATE TABLE IF NOT EXISTS eng_request (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet         TEXT NOT NULL,          -- 'tech' | 'fab' | 'proto'
      row_num       INTEGER,
      request       TEXT,
      customer_part TEXT,
      notes         TEXT,
      assigned_to   TEXT,
      program_manager TEXT,
      date_open     TEXT,
      target_date   TEXT,
      date_closed   TEXT,
      status        TEXT,                   -- g / y / r / p
      pct_complete  REAL,
      comments      TEXT,
      addl_comments TEXT,
      team_comments TEXT,                   -- "Tech Comments" / "Fab Comments" column
      priority      TEXT,                   -- "Priority" column
      synced_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS notifier_seen (
      id TEXT PRIMARY KEY                   -- ticket entry ids already emailed
    );
    CREATE TABLE IF NOT EXISTS eng_seen (
      key        TEXT PRIMARY KEY,          -- sheet|request|date_open|customer_part
      first_seen TEXT
    );
  `);

  // Migrations for DBs created before these columns existed
  try { db.exec('ALTER TABLE eng_request ADD COLUMN team_comments TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE eng_request ADD COLUMN priority TEXT'); } catch (e) {}

  return db;
}

module.exports = createDb;
