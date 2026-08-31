'use strict';
const express = require('express');
const session = require('express-session');
const path = require('path');
const createDb = require('./db');
const multer = require('multer');
const ExcelJS = require('exceljs');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20*1024*1024 } });

const db = createDb();
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'hl-floorsync-secret-change-me';

app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, '../..');
app.use('/updates', express.static(path.join(STATIC_ROOT, 'updates')));
app.use(express.static(STATIC_ROOT));

function touch() {
  db.prepare("UPDATE meta SET value = CURRENT_TIMESTAMP WHERE key = 'updated_at'").run();
}

function txn(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function parsePhotos(val) {
  try { return JSON.parse(val || '[]'); } catch { return []; }
}

function rowToApplicator(r) {
  return { id: r.id, apn: r.apn, press: r.press, terminal: r.terminal, wire: r.wire,
    customer: r.customer, issue: r.issue, notes: r.notes, status: r.status,
    priority: r.priority, by: r.by_user, ticketNum: r.ticket_num,
    submittedBy: r.submitted_by, photos: parsePhotos(r.photos),
    date: r.date, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToMachine(r) {
  return { id: r.id, machine: r.machine, desc: r.desc, result: r.result,
    customer: r.customer, status: r.status, by: r.by_user,
    ticketNum: r.ticket_num, photos: parsePhotos(r.photos),
    date: r.date, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToSetup(r) {
  return { id: r.id, terminal: r.terminal, awg: r.awg, issue: r.issue, doc: r.doc,
    notes: r.notes, customer: r.customer, status: r.status, by: r.by_user,
    ticketNum: r.ticket_num, photos: parsePhotos(r.photos),
    date: r.date, createdAt: r.created_at, updatedAt: r.updated_at };
}

const SECTION_TABLE = { applicator: 'applicator_entries', machine: 'machine_entries', setup: 'setup_entries' };

const UPSERT_SQL = {
  applicator: `INSERT INTO applicator_entries
    (id,apn,press,terminal,wire,customer,issue,notes,status,priority,by_user,ticket_num,submitted_by,photos,date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET apn=excluded.apn,press=excluded.press,terminal=excluded.terminal,
    wire=excluded.wire,customer=excluded.customer,issue=excluded.issue,notes=excluded.notes,
    status=excluded.status,priority=excluded.priority,by_user=excluded.by_user,
    ticket_num=excluded.ticket_num,submitted_by=excluded.submitted_by,photos=excluded.photos,
    date=excluded.date,updated_at=CURRENT_TIMESTAMP`,
  machine: `INSERT INTO machine_entries
    (id,machine,desc,result,customer,status,by_user,ticket_num,photos,date)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET machine=excluded.machine,desc=excluded.desc,result=excluded.result,
    customer=excluded.customer,status=excluded.status,by_user=excluded.by_user,
    ticket_num=excluded.ticket_num,photos=excluded.photos,date=excluded.date,updated_at=CURRENT_TIMESTAMP`,
  setup: `INSERT INTO setup_entries
    (id,terminal,awg,issue,doc,notes,customer,status,by_user,ticket_num,photos,date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET terminal=excluded.terminal,awg=excluded.awg,issue=excluded.issue,
    doc=excluded.doc,notes=excluded.notes,customer=excluded.customer,status=excluded.status,
    by_user=excluded.by_user,ticket_num=excluded.ticket_num,photos=excluded.photos,
    date=excluded.date,updated_at=CURRENT_TIMESTAMP`
};

function upsertRow(section, stmt, e) {
  if (section === 'applicator') {
    stmt.run(e.id,e.apn||null,e.press||null,e.terminal||null,e.wire||null,e.customer||null,
      e.issue||null,e.notes||null,e.status||'open',e.priority||'normal',e.by||null,
      e.ticketNum||null,e.submittedBy||null,JSON.stringify(e.photos||[]),e.date||null);
  } else if (section === 'machine') {
    stmt.run(e.id,e.machine||null,e.desc||null,e.result||null,e.customer||null,
      e.status||'open',e.by||null,e.ticketNum||null,JSON.stringify(e.photos||[]),e.date||null);
  } else {
    stmt.run(e.id,e.terminal||null,e.awg||null,e.issue||null,e.doc||null,e.notes||null,
      e.customer||null,e.status||'open',e.by||null,e.ticketNum||null,
      JSON.stringify(e.photos||[]),e.date||null);
  }
}

// Auth
app.post('/api/auth/login', (req, res) => {
  const { pin_hash } = req.body;
  if (!pin_hash) return res.status(400).json({ error: 'pin_hash required' });
  const user = db.prepare('SELECT * FROM users WHERE pin_hash = ? AND active = 1').get(pin_hash);
  if (!user) return res.status(401).json({ error: 'Invalid PIN' });
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userRole = user.role;
  res.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.userId, name: req.session.userName, role: req.session.userRole });
});

app.get('/api/auth/users', (req, res) => {
  res.json(db.prepare('SELECT id,name,role,active FROM users ORDER BY name').all());
});

app.put('/api/auth/users', requireAuth, (req, res) => {
  const users = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'Array expected' });
  const stmt = db.prepare(`INSERT INTO users (name,pin_hash,role,active) VALUES (?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET pin_hash=excluded.pin_hash,role=excluded.role,active=excluded.active`);
  db.transaction(() => users.forEach(u => stmt.run(u.name,u.pin_hash||u.pinHash,u.role||'tech',u.active==null?1:u.active)))();
  touch();
  res.json({ ok: true });
});

app.post('/api/auth/setup', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0) return res.status(403).json({ error: 'Already set up' });
  const { name, pin_hash, role } = req.body;
  if (!name || !pin_hash) return res.status(400).json({ error: 'name and pin_hash required' });
  db.prepare('INSERT INTO users (name,pin_hash,role) VALUES (?,?,?)').run(name,pin_hash,role||'supervisor');
  res.json({ ok: true });
});

// All data snapshot
app.get('/api/data', requireAuth, (req, res) => {
  const applicator = db.prepare('SELECT * FROM applicator_entries ORDER BY date DESC').all().map(rowToApplicator);
  const machine    = db.prepare('SELECT * FROM machine_entries ORDER BY date DESC').all().map(rowToMachine);
  const setup      = db.prepare('SELECT * FROM setup_entries ORDER BY date DESC').all().map(rowToSetup);
  const qRows      = db.prepare('SELECT * FROM queue_order').all();
  const queue      = {};
  qRows.forEach(r => { try { queue[r.section] = JSON.parse(r.order_json); } catch { queue[r.section] = []; } });
  const contacts   = db.prepare('SELECT * FROM contacts WHERE active = 1 ORDER BY name').all();
  const customers  = db.prepare('SELECT * FROM customers WHERE active = 1 ORDER BY name').all();
  res.json({ applicator, machine, setup, queue, contacts, customers });
});

// Entries bulk-replace
app.put('/api/entries/:section', requireAuth, (req, res) => {
  const { section } = req.params;
  if (!SECTION_TABLE[section]) return res.status(404).json({ error: 'Unknown section' });
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Array expected' });
  const table = SECTION_TABLE[section];
  const stmt = db.prepare(UPSERT_SQL[section]);
  const ids = entries.map(e => e.id).filter(Boolean);
  txn(() => {
    if (ids.length > 0) {
      db.prepare(`DELETE FROM ${table} WHERE id NOT IN (${ids.map(()=>'?').join(',')})`).run(...ids);
    } else {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    entries.forEach(e => upsertRow(section, stmt, e));
  });
  touch();
  res.json({ ok: true });
});

app.delete('/api/entries/:section/:id', requireAuth, (req, res) => {
  const { section, id } = req.params;
  if (!SECTION_TABLE[section]) return res.status(404).json({ error: 'Unknown section' });
  db.prepare(`DELETE FROM ${SECTION_TABLE[section]} WHERE id = ?`).run(id);
  touch();
  res.json({ ok: true });
});

// Queue order
app.put('/api/queue/:section', requireAuth, (req, res) => {
  const { section } = req.params;
  if (!SECTION_TABLE[section]) return res.status(404).json({ error: 'Unknown section' });
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Array expected' });
  db.prepare('UPDATE queue_order SET order_json=?,updated_at=CURRENT_TIMESTAMP WHERE section=?')
    .run(JSON.stringify(req.body), section);
  touch();
  res.json({ ok: true });
});

// Contacts / customers
app.put('/api/contacts', requireAuth, (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Array expected' });
  const stmt = db.prepare(`INSERT INTO contacts (id,name,email,active) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,active=excluded.active`);
  const ids = rows.map(c=>c.id).filter(Boolean);
  txn(() => {
    if (ids.length) db.prepare(`DELETE FROM contacts WHERE id NOT IN (${ids.map(()=>'?').join(',')})`).run(...ids);
    else db.prepare('DELETE FROM contacts').run();
    rows.forEach(c => stmt.run(c.id,c.name,c.email||null,c.active==null?1:c.active));
  });
  touch();
  res.json({ ok: true });
});

app.put('/api/customers', requireAuth, (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Array expected' });
  const stmt = db.prepare(`INSERT INTO customers (id,name,active) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active`);
  const ids = rows.map(c=>c.id).filter(Boolean);
  txn(() => {
    if (ids.length) db.prepare(`DELETE FROM customers WHERE id NOT IN (${ids.map(()=>'?').join(',')})`).run(...ids);
    else db.prepare('DELETE FROM customers').run();
    rows.forEach(c => stmt.run(c.id,c.name,c.active==null?1:c.active));
  });
  touch();
  res.json({ ok: true });
});

// Public ticket endpoints (no auth)
app.post('/api/tickets', (req, res) => {
  const { apn, press, terminal, wire, customer, issue, notes, submittedBy } = req.body;
  const id = Date.now();
  const ticketNum = 'TKT-' + String(id).slice(-6);
  db.prepare(`INSERT INTO applicator_entries
    (id,apn,press,terminal,wire,customer,issue,notes,status,priority,ticket_num,submitted_by,date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,apn||null,press||null,terminal||null,wire||null,customer||null,
      issue||null,notes||null,'open','normal',ticketNum,submittedBy||null,id);
  const qRow = db.prepare("SELECT order_json FROM queue_order WHERE section='applicator'").get();
  let q = []; try { q = JSON.parse(qRow.order_json||'[]'); } catch {}
  q.push(id);
  db.prepare("UPDATE queue_order SET order_json=? WHERE section='applicator'").run(JSON.stringify(q));
  touch();
  res.json({ ok: true, ticketNum, id });
});

app.get('/api/tickets/:num', (req, res) => {
  const num = req.params.num;
  const full = num.startsWith('TKT-') ? num : 'TKT-' + num;
  const row = db.prepare('SELECT * FROM applicator_entries WHERE ticket_num=? OR ticket_num=?').get(full, num);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(rowToApplicator(row));
});

// Public read-only endpoints for ticket portal (no auth required)
app.get('/api/public/entries/:section', (req, res) => {
  const sec = req.params.section;
  const tables = { applicator: 'applicator_entries', machine: 'machine_entries', setup: 'setup_entries' };
  if (!tables[sec]) return res.status(400).json({ error: 'Invalid section' });
  const rows = db.prepare(`SELECT * FROM ${tables[sec]} WHERE status != 'done' ORDER BY date ASC`).all();
  const fn = { applicator: rowToApplicator, machine: rowToMachine, setup: rowToSetup }[sec];
  res.json(rows.map(fn));
});

app.get('/api/public/queue/:section', (req, res) => {
  const sec = req.params.section;
  const row = db.prepare('SELECT order_json FROM queue_order WHERE section=?').get(sec);
  res.json(row ? JSON.parse(row.order_json) : []);
});

// Notify queue
app.post('/api/notify', requireAuth, (req, res) => {
  db.prepare('INSERT INTO notify_queue (payload) VALUES (?)').run(JSON.stringify(req.body));
  res.json({ ok: true });
});

// Sync ping
app.get('/api/sync/ping', requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM meta WHERE key='updated_at'").get();
  res.json({ updatedAt: row ? row.value : null });
});

// ── Maintenance / MRO ────────────────────────────────────────────────────────

const IQMS_PROXY = process.env.IQMS_PROXY_URL || 'http://TYLER.hl.local:3001/query';

async function iqmsQuery(sql) {
  const r = await fetch(IQMS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql })
  });
  if (!r.ok) throw new Error(`IQMS proxy error ${r.status}`);
  return r.json(); // { columns: [...], rows: [[...]] }
}

function rowsToObjects({ columns, rows }) {
  return rows.map(row => {
    const obj = {};
    columns.forEach((c, i) => { obj[c.toLowerCase()] = row[i]; });
    return obj;
  });
}

// IQMS sync — equipment
async function syncEquipment(db) {
  const sql = `SELECT e.id iqms_id, e.eqno, e.class, e.descrip, e.model, e.serialno,
    TO_CHAR(e.inst_date,'YYYY-MM-DD') inst_date,
    e.total_units, e.uom, e.location,
    e.locations_id, e.critical, e.out_of_service,
    TO_CHAR(e.service_date_out,'YYYY-MM-DD') service_date_out,
    TO_CHAR(e.service_date_in,'YYYY-MM-DD') service_date_in,
    TO_CHAR(e.last_prod_date,'YYYY-MM-DD') last_prod_date,
    e.eplant_id, e.vendor_id, e.mfgcell_id,
    e.glacct_id, e.labor_glacct_id,
    a.company owner
    FROM pmeqmt e
    LEFT JOIN arcusto a ON a.id = e.arcusto_id
    WHERE NVL(e.pk_hide, 0) = 0`;
  const data = await iqmsQuery(sql);
  const rows = rowsToObjects(data);
  const ins = db.prepare(`INSERT OR REPLACE INTO equipment
    (iqms_id,eqno,class,descrip,model,serialno,inst_date,total_units,uom,location,
     critical,out_of_service,service_date_out,service_date_in,last_prod_date,
     eplant_id,vendor_id,mfgcell_id,owner,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
  function yn(v) { return (v==='Y'||v===1||v==='1') ? 1 : 0; }
  db.transaction(() => {
    db.prepare('DELETE FROM equipment').run();
    rows.forEach(r => ins.run(
      r.iqms_id, r.eqno, r.class, r.descrip, r.model, r.serialno,
      r.inst_date, r.total_units, r.uom, r.location,
      yn(r.critical), yn(r.out_of_service),
      r.service_date_out, r.service_date_in, r.last_prod_date,
      r.eplant_id, r.vendor_id, r.mfgcell_id, r.owner
    ));
  })();
  return rows.length;
}

// IQMS sync — PM schedules
async function syncPmSchedules(db) {
  // v_pmjob_list confirmed columns (31 total, Y/N booleans for wo_open/incomplete/archived)
  const sql = `SELECT id iqms_id, pmeqmt_id, pmtasks_id, taskno, descrip,
    perform_every, uom, act_every, total_units, wo_create_threshold,
    hours4tsk, numpeople,
    TO_CHAR(scheduled_since,'YYYY-MM-DD') scheduled_since,
    TO_CHAR(last_closed_wo,'YYYY-MM-DD') last_closed_wo,
    wo_open, incomplete, archived
    FROM v_pmjob_list`;
  const data = await iqmsQuery(sql);
  const rows = rowsToObjects(data);
  const ins = db.prepare(`INSERT OR REPLACE INTO pm_schedule
    (iqms_id,pmeqmt_id,pmtasks_id,taskno,descrip,perform_every,uom,act_every,
     total_units,wo_create_threshold,hours4tsk,numpeople,
     scheduled_since,last_closed_wo,wo_open,incomplete,archived,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
  function yn(v) { return (v==='Y'||v===1) ? 1 : 0; }
  db.transaction(() => {
    db.prepare('DELETE FROM pm_schedule').run();
    rows.forEach(r => ins.run(
      r.iqms_id, r.pmeqmt_id, r.pmtasks_id, r.taskno, r.descrip,
      r.perform_every, r.uom, r.act_every,
      r.total_units, r.wo_create_threshold, r.hours4tsk, r.numpeople,
      r.scheduled_since, r.last_closed_wo,
      yn(r.wo_open), yn(r.incomplete), yn(r.archived)
    ));
  })();
  return rows.length;
}

// IQMS sync — PM templates
async function syncPmTemplates(db) {
  // Template headers
  const th = rowsToObjects(await iqmsQuery(
    `SELECT id iqms_id, descrip, notes, eplant_id eplant FROM pmtemplate`));
  const insT = db.prepare(`INSERT OR REPLACE INTO pm_template (iqms_id,descrip,notes,eplant,synced_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)`);

  // Template jobs (tasks)
  const tj = rowsToObjects(await iqmsQuery(
    `SELECT tj.id iqms_id, tj.pmtemplate_id, tj.pmtasks_id, t.taskno, t.descrip,
     t.perform_every, t.uom, t.total_units, t.hours4tsk
     FROM pmtemplate_job tj JOIN pmtasks t ON t.id = tj.pmtasks_id`));
  const insJ = db.prepare(`INSERT OR REPLACE INTO pm_template_job
    (iqms_id,pmtemplate_id,pmtasks_id,taskno,descrip,perform_every,uom,total_units,hours4tsk,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);

  // Template checklist items — columns assumed: id, pmtemplate_job_id, pmtasks_id, seq, check_text, critical
  // CONFIRM: run SELECT * FROM pmtemplate_checklist_dtl WHERE ROWNUM<=3 via sql.html to verify columns
  const tc = rowsToObjects(await iqmsQuery(
    `SELECT id iqms_id, pmtemplate_job_id, pmtasks_id, seq, check_text, critical
     FROM pmtemplate_checklist_dtl`));
  const insC = db.prepare(`INSERT OR REPLACE INTO pm_template_checklist
    (iqms_id,pmtemplate_job_id,pmtasks_id,seq,check_text,critical,synced_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`);

  db.transaction(() => {
    db.prepare('DELETE FROM pm_template_checklist').run();
    db.prepare('DELETE FROM pm_template_job').run();
    db.prepare('DELETE FROM pm_template').run();
    th.forEach(r => insT.run(r.iqms_id,r.descrip,r.notes,r.eplant));
    tj.forEach(r => insJ.run(r.iqms_id,r.pmtemplate_id,r.pmtasks_id,r.taskno,
      r.descrip,r.perform_every,r.uom,r.total_units,r.hours4tsk));
    tc.forEach(r => insC.run(r.iqms_id,r.pmtemplate_job_id,r.pmtasks_id,
      r.seq,r.check_text,r.critical?1:0));
  })();
  return { templates: th.length, jobs: tj.length, checklist: tc.length };
}

// IQMS sync — WO history
async function syncWoHistory(db) {
  const sql = `SELECT w.id pmwo_id,
    TO_CHAR(w.wo_date,'YYYY-MM-DD') wo_date,
    w.status, w.priority, w.wo_type, w.department, w.requested_by,
    TO_CHAR(w.start_date,'YYYY-MM-DD') start_date,
    TO_CHAR(w.end_date,'YYYY-MM-DD') end_date,
    d.taskno task_number, d.descrip task_description,
    w.pmeqmt_id, e.eqno,
    w.wo_open, w.incomplete,
    a.company arcusto_company, v.name vendor_company
    FROM pmwo w
    LEFT JOIN pmwo_dtl d ON d.pmwo_id = w.id AND ROWNUM = 1
    LEFT JOIN pmeqmt e ON e.id = w.pmeqmt_id
    LEFT JOIN arcusto a ON a.id = w.arcusto_id
    LEFT JOIN vendor v ON v.id = w.vendor_id
    WHERE w.archived = 0`;
  const data = await iqmsQuery(sql);
  const rows = rowsToObjects(data);
  const ins = db.prepare(`INSERT OR REPLACE INTO wo_history
    (pmwo_id,wo_date,status,priority,wo_type,department,requested_by,start_date,end_date,
     task_number,task_description,pmeqmt_id,eqno,wo_open,incomplete,
     arcusto_company,vendor_company,source,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'iqms',CURRENT_TIMESTAMP)`);
  db.transaction(() => {
    db.prepare('DELETE FROM wo_history').run();
    rows.forEach(r => ins.run(r.pmwo_id,r.wo_date,r.status,r.priority,r.wo_type,
      r.department,r.requested_by,r.start_date,r.end_date,r.task_number,
      r.task_description,r.pmeqmt_id,r.eqno,r.wo_open?1:0,r.incomplete?1:0,
      r.arcusto_company,r.vendor_company));
  })();
  return rows.length;
}

// POST /api/maintenance/sync — trigger IQMS sync (supervisor only)
app.post('/api/maintenance/sync', requireAuth, async (req, res) => {
  if (req.session.userRole !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });
  const { targets = ['equipment','pm_schedules','pm_templates','wo_history'] } = req.body;
  const results = {};
  const errors = {};
  async function trySync(key, fn) {
    try { results[key] = await fn(); }
    catch(e) { errors[key] = e.message; }
  }
  if (targets.includes('equipment'))    await trySync('equipment',    () => syncEquipment(db));
  if (targets.includes('pm_schedules')) await trySync('pm_schedules', () => syncPmSchedules(db));
  if (targets.includes('pm_templates')) await trySync('pm_templates', () => syncPmTemplates(db));
  if (targets.includes('wo_history'))   await trySync('wo_history',   () => syncWoHistory(db));
  res.json({ ok: true, synced: results, errors, at: new Date().toISOString() });
});

// GET /api/maintenance/sync/status
app.get('/api/maintenance/sync/status', requireAuth, (req, res) => {
  const eq   = db.prepare('SELECT COUNT(*) n, MAX(synced_at) at FROM equipment').get();
  const pm   = db.prepare('SELECT COUNT(*) n, MAX(synced_at) at FROM pm_schedule').get();
  const wo   = db.prepare('SELECT COUNT(*) n, MAX(synced_at) at FROM wo_history').get();
  const tmpl = db.prepare('SELECT COUNT(*) n, MAX(synced_at) at FROM pm_template').get();
  res.json({ equipment: eq, pm_schedules: pm, pm_templates: tmpl, wo_history: wo });
});

// ── Equipment ────────────────────────────────────────────────────────────────

app.get('/api/maintenance/equipment', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM work_order w WHERE w.equipment_id = e.iqms_id AND w.status NOT IN ('complete','closed')) open_wo_count,
    (SELECT COUNT(*) FROM equipment_spare_link l WHERE l.equipment_id = e.iqms_id) spare_count
    FROM equipment e ORDER BY e.critical DESC, e.eqno`).all();
  res.json(rows);
});

app.get('/api/maintenance/equipment/:id', requireAuth, (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE iqms_id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Not found' });

  const schedules = db.prepare('SELECT * FROM pm_schedule WHERE pmeqmt_id = ? AND archived = 0 ORDER BY taskno').all(req.params.id);
  const openWOs   = db.prepare(`SELECT w.*, e.eqno FROM work_order w
    LEFT JOIN equipment e ON e.iqms_id = w.equipment_id
    WHERE w.equipment_id = ? AND w.status NOT IN ('complete','closed')
    ORDER BY w.created_at DESC`).all(req.params.id);
  const spares    = db.prepare(`SELECT cs.*, l.qty_required,
    ss.name supplier_name
    FROM equipment_spare_link l
    JOIN critical_spare cs ON cs.id = l.spare_id
    LEFT JOIN spare_supplier ss ON ss.id = cs.supplier_id
    WHERE l.equipment_id = ? ORDER BY cs.bin`).all(req.params.id);
  const history   = db.prepare(`SELECT * FROM wo_history WHERE pmeqmt_id = ? ORDER BY wo_date DESC LIMIT 20`).all(req.params.id);

  res.json({ equipment: eq, schedules, openWOs, spares, history });
});

// ── PM Due-date computation ───────────────────────────────────────────────────

function pmDueDate(sched, eqTotalUnits) {
  // Calendar mode: perform_every + uom from scheduled_since
  let calDue = null;
  if (sched.scheduled_since && sched.perform_every && sched.uom) {
    const since = new Date(sched.scheduled_since);
    const uom = (sched.uom || '').toLowerCase();
    const ms = uom.startsWith('day')   ? sched.perform_every * 86400000
             : uom.startsWith('week')  ? sched.perform_every * 7 * 86400000
             : uom.startsWith('month') ? sched.perform_every * 30.44 * 86400000
             : uom.startsWith('year')  ? sched.perform_every * 365.25 * 86400000
             : null;
    if (ms) calDue = new Date(since.getTime() + ms);
  }
  // Meter mode: total_units threshold vs equipment live total_units
  let meterDue = null;
  let meterPct = null;
  if (sched.total_units && eqTotalUnits != null) {
    meterPct = Math.round((eqTotalUnits / sched.total_units) * 100);
    meterDue = eqTotalUnits >= sched.total_units;
  }
  const now = new Date();
  const daysUntil = calDue ? Math.round((calDue - now) / 86400000) : null;
  return { calDue, daysUntil, meterDue, meterPct };
}

app.get('/api/maintenance/pm-due', requireAuth, (req, res) => {
  const scheds = db.prepare('SELECT * FROM pm_schedule WHERE archived = 0').all();
  const eqMap  = {};
  db.prepare('SELECT iqms_id, total_units FROM equipment').all()
    .forEach(e => { eqMap[e.iqms_id] = e.total_units; });

  const due = scheds.map(s => {
    const due = pmDueDate(s, eqMap[s.pmeqmt_id]);
    return { ...s, ...due };
  }).filter(s => {
    if (s.daysUntil != null && s.daysUntil <= (s.wo_create_threshold || 7)) return true;
    if (s.meterDue) return true;
    return false;
  }).sort((a,b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999));

  res.json(due);
});

// ── Work Orders ──────────────────────────────────────────────────────────────

function nextWoNumber(db) {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const last = db.prepare(`SELECT wo_number FROM work_order WHERE wo_number LIKE 'WO-${today}-%' ORDER BY wo_number DESC LIMIT 1`).get();
  let seq = 1;
  if (last) { const parts = last.wo_number.split('-'); seq = (parseInt(parts[3]||parts[2]||'0') + 1); }
  return `WO-${today}-${String(seq).padStart(4,'0')}`;
}

function rowToWO(r) {
  return { id: r.id, woNumber: r.wo_number, equipmentId: r.equipment_id,
    pmScheduleId: r.pm_schedule_id, woType: r.wo_type, status: r.status,
    priority: r.priority, department: r.department, requestedBy: r.requested_by,
    assignedTo: r.assigned_to, description: r.description,
    createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at,
    closedAt: r.closed_at, plantId: r.plant_id, source: r.source,
    closeIncompleteReason: r.close_incomplete_reason,
    eqno: r.eqno, equipDescrip: r.eq_descrip };
}

app.get('/api/maintenance/work-orders', requireAuth, (req, res) => {
  const { status, equipment_id } = req.query;
  let sql = `SELECT w.*, e.eqno, e.descrip eq_descrip FROM work_order w
    LEFT JOIN equipment e ON e.iqms_id = w.equipment_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND w.status = ?`; params.push(status); }
  if (equipment_id) { sql += ` AND w.equipment_id = ?`; params.push(equipment_id); }
  sql += ` ORDER BY w.created_at DESC LIMIT 200`;
  res.json(db.prepare(sql).all(...params).map(rowToWO));
});

app.get('/api/maintenance/work-orders/:id', requireAuth, (req, res) => {
  const wo = db.prepare(`SELECT w.*, e.eqno, e.descrip eq_descrip, e.critical eq_critical
    FROM work_order w LEFT JOIN equipment e ON e.iqms_id = w.equipment_id
    WHERE w.id = ?`).get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const checklist = db.prepare('SELECT * FROM wo_checklist_item WHERE work_order_id = ? ORDER BY seq,id').all(req.params.id);
  const spareUsage = db.prepare(`SELECT u.*, cs.description, cs.bin, cs.part_no
    FROM wo_spare_usage u JOIN critical_spare cs ON cs.id = u.spare_id
    WHERE u.work_order_id = ?`).all(req.params.id);
  res.json({ ...rowToWO(wo), checklist, spareUsage });
});

// Create a work order
app.post('/api/maintenance/work-orders', requireAuth, (req, res) => {
  const { equipment_id, pm_schedule_id, wo_type = 'repair', priority = 'med',
          department, requested_by, assigned_to, description, plant_id } = req.body;
  if (!equipment_id) return res.status(400).json({ error: 'equipment_id required' });

  const wo_number = nextWoNumber(db);
  const stmt = db.prepare(`INSERT INTO work_order
    (wo_number,equipment_id,pm_schedule_id,wo_type,status,priority,department,
     requested_by,assigned_to,description,plant_id,source)
    VALUES (?,?,?,?,'open',?,?,?,?,?,?,?)`);
  const info = stmt.run(wo_number,equipment_id,pm_schedule_id||null,wo_type,priority,
    department||null,requested_by||req.session.userName,assigned_to||null,
    description||null,plant_id||null,pm_schedule_id?'generated':'manual');
  const woId = info.lastInsertRowid;

  // Seed checklist from PM template if PM-driven
  if (pm_schedule_id) {
    const sched = db.prepare('SELECT * FROM pm_schedule WHERE iqms_id = ?').get(pm_schedule_id);
    if (sched) {
      // Try pmtasks_id match to find template checklist items
      const items = db.prepare(`SELECT c.* FROM pm_template_checklist c
        WHERE c.pmtasks_id = ? ORDER BY c.seq`).all(sched.pmtasks_id);
      if (items.length) {
        const ins = db.prepare(`INSERT INTO wo_checklist_item (work_order_id,seq,text,critical,status)
          VALUES (?,?,?,?,'open')`);
        db.transaction(() => items.forEach(i => ins.run(woId,i.seq,i.check_text,i.critical?1:0)))();
      }
    }
  }

  touch();
  res.json({ ok: true, id: woId, wo_number });
});

// Update WO status / assignment
app.patch('/api/maintenance/work-orders/:id', requireAuth, (req, res) => {
  const { status, priority, assigned_to, description, started_at } = req.body;
  const wo = db.prepare('SELECT * FROM work_order WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  if (status !== undefined)      { updates.push('status=?');      params.push(status); }
  if (priority !== undefined)    { updates.push('priority=?');    params.push(priority); }
  if (assigned_to !== undefined) { updates.push('assigned_to=?'); params.push(assigned_to); }
  if (description !== undefined) { updates.push('description=?'); params.push(description); }
  if (started_at !== undefined)  { updates.push('started_at=?');  params.push(started_at); }
  if (status === 'in_progress' && !wo.started_at)
    { updates.push('started_at=CURRENT_TIMESTAMP'); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE work_order SET ${updates.join(',')} WHERE id = ?`).run(...params);
  touch();
  res.json({ ok: true });
});

// Submit / close a WO
app.post('/api/maintenance/work-orders/:id/submit', requireAuth, (req, res) => {
  const { spare_usage = [], close_incomplete_reason } = req.body;
  const wo = db.prepare('SELECT * FROM work_order WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (['complete','closed'].includes(wo.status)) return res.status(400).json({ error: 'Already closed' });

  const items = db.prepare('SELECT * FROM wo_checklist_item WHERE work_order_id = ?').all(wo.id);
  const unfinished = items.filter(i => !i.is_done && i.status !== 'na');
  if (unfinished.length > 0 && !close_incomplete_reason) {
    return res.status(400).json({
      error: 'Checklist incomplete',
      unfinished: unfinished.length,
      hint: 'Provide close_incomplete_reason to close anyway (supervisor)'
    });
  }
  if (close_incomplete_reason && req.session.userRole !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can close incomplete WOs' });
  }

  db.transaction(() => {
    // Record spare usage and decrement on_hand
    spare_usage.forEach(u => {
      db.prepare(`INSERT INTO wo_spare_usage (work_order_id,spare_id,qty_used,used_by)
        VALUES (?,?,?,?)`).run(wo.id,u.spare_id,u.qty_used,req.session.userName);
      db.prepare(`UPDATE critical_spare SET on_hand = MAX(0, on_hand - ?) WHERE id = ?`)
        .run(u.qty_used, u.spare_id);
    });
    db.prepare(`UPDATE work_order SET status='complete', completed_at=CURRENT_TIMESTAMP,
      closed_at=CURRENT_TIMESTAMP, close_incomplete_reason=? WHERE id = ?`)
      .run(close_incomplete_reason||null, wo.id);
  })();
  touch();
  res.json({ ok: true });
});

// ── Checklist sign-off ────────────────────────────────────────────────────────

app.patch('/api/maintenance/checklist/:itemId', requireAuth, (req, res) => {
  const { is_done, status, note } = req.body;
  const item = db.prepare('SELECT * FROM wo_checklist_item WHERE id = ?').get(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const done = is_done != null ? (is_done ? 1 : 0) : item.is_done;
  const st   = status || (done ? 'done' : 'open');
  db.prepare(`UPDATE wo_checklist_item SET is_done=?,status=?,done_by=?,done_at=CURRENT_TIMESTAMP,note=?
    WHERE id = ?`).run(done,st,req.session.userName,note||item.note,req.params.itemId);

  // Mark WO in_progress on first sign-off
  const wo = db.prepare('SELECT * FROM work_order WHERE id = ?').get(item.work_order_id);
  if (wo && wo.status === 'open' && done) {
    db.prepare(`UPDATE work_order SET status='in_progress',started_at=CURRENT_TIMESTAMP WHERE id = ?`)
      .run(wo.id);
  }
  touch();
  res.json({ ok: true });
});

app.post('/api/maintenance/checklist/:woId/add', requireAuth, (req, res) => {
  const { text, critical = 0, seq } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const maxSeq = db.prepare('SELECT MAX(seq) ms FROM wo_checklist_item WHERE work_order_id=?').get(req.params.woId);
  const info = db.prepare(`INSERT INTO wo_checklist_item (work_order_id,seq,text,critical,status)
    VALUES (?,?,?,?,'open')`).run(req.params.woId, seq ?? ((maxSeq?.ms??0)+10), text, critical?1:0);
  touch();
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── Critical Spares ───────────────────────────────────────────────────────────

app.get('/api/maintenance/spares', requireAuth, (req, res) => {
  const { below_min, category, equipment_id } = req.query;
  let sql = `SELECT cs.*, ss.name supplier_name,
    (SELECT COUNT(*) FROM equipment_spare_link l WHERE l.spare_id = cs.id) eq_count
    FROM critical_spare cs
    LEFT JOIN spare_supplier ss ON ss.id = cs.supplier_id
    WHERE cs.active = 1`;
  const params = [];
  if (below_min === '1') { sql += ` AND cs.on_hand < cs.min_qty`; }
  if (category)          { sql += ` AND cs.category = ?`; params.push(category); }
  if (equipment_id) {
    sql += ` AND EXISTS (SELECT 1 FROM equipment_spare_link l WHERE l.equipment_id=? AND l.spare_id=cs.id)`;
    params.push(equipment_id);
  }
  sql += ` ORDER BY cs.bin`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/maintenance/spares/:id', requireAuth, (req, res) => {
  const spare = db.prepare(`SELECT cs.*, ss.name supplier_name FROM critical_spare cs
    LEFT JOIN spare_supplier ss ON ss.id = cs.supplier_id WHERE cs.id = ?`).get(req.params.id);
  if (!spare) return res.status(404).json({ error: 'Not found' });
  const equipment = db.prepare(`SELECT e.*, l.qty_required FROM equipment_spare_link l
    JOIN equipment e ON e.iqms_id = l.equipment_id WHERE l.spare_id = ?`).all(req.params.id);
  const usage = db.prepare(`SELECT u.*, w.wo_number FROM wo_spare_usage u
    JOIN work_order w ON w.id = u.work_order_id WHERE u.spare_id = ? ORDER BY u.used_at DESC LIMIT 20`).all(req.params.id);
  res.json({ ...spare, equipment, usage });
});

app.patch('/api/maintenance/spares/:id', requireAuth, (req, res) => {
  const { on_hand, min_qty, unit_cost, reorder_url, active, description, part_no } = req.body;
  const spare = db.prepare('SELECT id FROM critical_spare WHERE id=?').get(req.params.id);
  if (!spare) return res.status(404).json({ error: 'Not found' });
  const updates = []; const params = [];
  if (on_hand !== undefined)    { updates.push('on_hand=?');    params.push(on_hand); }
  if (min_qty !== undefined)    { updates.push('min_qty=?');    params.push(min_qty); }
  if (unit_cost !== undefined)  { updates.push('unit_cost=?');  params.push(unit_cost); }
  if (reorder_url !== undefined){ updates.push('reorder_url=?');params.push(reorder_url); }
  if (active !== undefined)     { updates.push('active=?');     params.push(active?1:0); }
  if (description !== undefined){ updates.push('description=?');params.push(description); }
  if (part_no !== undefined)    { updates.push('part_no=?');    params.push(part_no); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE critical_spare SET ${updates.join(',')} WHERE id=?`).run(...params);
  touch();
  res.json({ ok: true });
});

// ── Equipment↔Spare links ────────────────────────────────────────────────────

app.get('/api/maintenance/equipment/:id/spares', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT cs.*, l.qty_required, ss.name supplier_name
    FROM equipment_spare_link l JOIN critical_spare cs ON cs.id = l.spare_id
    LEFT JOIN spare_supplier ss ON ss.id = cs.supplier_id
    WHERE l.equipment_id = ? ORDER BY cs.bin`).all(req.params.id);
  res.json(rows);
});

app.put('/api/maintenance/equipment/:id/spares', requireAuth, (req, res) => {
  // Body: [{ spare_id, qty_required }]
  if (req.session.userRole !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });
  const links = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Array expected' });
  db.transaction(() => {
    db.prepare('DELETE FROM equipment_spare_link WHERE equipment_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO equipment_spare_link (equipment_id,spare_id,qty_required) VALUES (?,?,?)');
    links.forEach(l => ins.run(req.params.id, l.spare_id, l.qty_required||1));
  })();
  touch();
  res.json({ ok: true });
});

// Convenience: toggle a single spare link
app.post('/api/maintenance/equipment/:eqId/spares/:spareId', requireAuth, (req, res) => {
  if (req.session.userRole !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });
  const { qty_required = 1, remove = false } = req.body;
  if (remove) {
    db.prepare('DELETE FROM equipment_spare_link WHERE equipment_id=? AND spare_id=?')
      .run(req.params.eqId, req.params.spareId);
  } else {
    db.prepare(`INSERT OR REPLACE INTO equipment_spare_link (equipment_id,spare_id,qty_required)
      VALUES (?,?,?)`).run(req.params.eqId, req.params.spareId, qty_required);
  }
  touch();
  res.json({ ok: true });
});

// POST /api/maintenance/import-csp — one-time CSP spreadsheet import (supervisor only)
app.post('/api/maintenance/import-csp', requireAuth, upload.single('file'), async (req, res) => {
  if (req.session.userRole !== 'supervisor') return res.status(403).json({ error: 'Supervisor only' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch(e) { return res.status(400).json({ error: 'Could not parse xlsx: ' + e.message }); }

  // Find the CSP sheet
  let ws = wb.worksheets.find(s => s.name.toLowerCase().includes('csp')) || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'No worksheet found' });

  // Convert to array of plain objects using first row as header
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value||'').trim(); });
  const rows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj = {};
    row.eachCell((cell, col) => {
      if (headers[col]) {
        let v = cell.value;
        if (v && typeof v === 'object' && v.richText) v = v.richText.map(r=>r.text).join('');
        if (v && typeof v === 'object' && v.text) v = v.text;
        obj[headers[col]] = v ?? null;
      }
    });
    rows.push(obj);
  });

  // Supplier canonical map (dirty → clean)
  const supplierMap = {
    'km': 'Komax', 'komax': 'Komax',
    'mcmaster carr': 'McMaster-Carr', 'mcmaster-carr': 'McMaster-Carr', 'mcmaster': 'McMaster-Carr',
    'parts plus': 'Parts Plus', 'parts plus auto': 'Parts Plus',
    'grainger': 'Grainger',
    'fastenal': 'Fastenal',
    'motion': 'Motion Industries', 'motion industries': 'Motion Industries',
  };

  function canonicalSupplier(raw) {
    if (!raw) return null;
    const key = String(raw).trim().toLowerCase();
    return supplierMap[key] || String(raw).trim();
  }

  // Category from first letter of bin
  function category(bin) { return bin ? String(bin).trim()[0].toUpperCase() : null; }

  // Columns to drop (usage tracking — §6)
  const DROP_COLS = new Set([
    'jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
    'projected monthly use','total monthly','qty used - tracker','used',
    'iqms qty update','total used/bought this month','total purchases','column1',
    'total-used','total-bought','number of months recorded',
    'bin tare','part weight','total weight','count',
    'total used','total bought'
  ]);

  const errors = [];
  const supplierCache = {};

  // Ensure a supplier exists and return its id
  function ensureSupplier(name) {
    if (!name) return null;
    if (supplierCache[name]) return supplierCache[name];
    let row = db.prepare('SELECT id FROM spare_supplier WHERE name=?').get(name);
    if (!row) {
      const info = db.prepare('INSERT OR IGNORE INTO spare_supplier (name) VALUES (?)').run(name);
      row = db.prepare('SELECT id FROM spare_supplier WHERE name=?').get(name);
    }
    supplierCache[name] = row.id;
    return row.id;
  }

  function coerceNum(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  const ins = db.prepare(`INSERT OR REPLACE INTO critical_spare
    (bin,category,description,part_no,do_not_order,supplier_raw,supplier_id,uom,on_hand,min_qty,unit_cost,reorder_url,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);

  let spareCount = 0;
  const suppliersSeen = new Set();

  db.transaction(() => {
    db.prepare('DELETE FROM critical_spare').run();
    db.prepare('DELETE FROM spare_supplier').run();

    rows.forEach((row, idx) => {
      // Try common column name variants
      const bin = row['Bin #'] || row['Bin#'] || row['BIN #'] || row['BIN'] || row['bin'];
      if (!bin) return; // skip blank rows

      const rawDesc    = row['Description'] || row['Desc'] || '';
      const rawPartNo  = row['Part #'] || row['Part#'] || row['PART #'] || row['part_no'] || '';
      const rawSupp    = row['Supplier'] || row['supplier'] || '';
      const rawOnHand  = row['Current Quantity'] || row['On Hand'] || row['on_hand'] || 0;
      const rawMinQty  = row['Min. Bin Qty'] || row['Min Qty'] || row['min_qty'] || 0;
      const rawCost    = row['Price'] || row['Unit Cost'] || row['unit_cost'];
      const rawUOM     = row['Unit'] || row['UOM'] || row['uom'] || '';
      const rawUrl     = row['McMaster Link'] || row['McMaster URL'] || row['reorder_url'] || '';

      // Clean part number — strip "Do Not Order" contamination
      let partNo = String(rawPartNo || '').trim();
      let doNotOrder = 0;
      if (/do\s*not\s*order/i.test(partNo)) {
        doNotOrder = 1;
        partNo = partNo.replace(/do\s*not\s*order\**/gi, '').replace(/^\*+|\*+$/g, '').trim();
      }

      const suppCanon = canonicalSupplier(rawSupp);
      suppliersSeen.add(suppCanon);
      const suppId = ensureSupplier(suppCanon);

      const onHand = coerceNum(rawOnHand);
      const minQty = coerceNum(rawMinQty);
      const cost   = coerceNum(rawCost);

      if (onHand === null && rawOnHand !== null && rawOnHand !== '')
        errors.push(`Row ${idx+2}: on_hand "${rawOnHand}" not numeric`);

      try {
        ins.run(
          String(bin).trim(),
          category(bin),
          String(rawDesc).trim() || null,
          partNo || null,
          doNotOrder,
          String(rawSupp).trim() || null,
          suppId,
          String(rawUOM).trim() || null,
          onHand ?? 0,
          minQty ?? 0,
          cost,
          String(rawUrl).trim() || null
        );
        spareCount++;
      } catch(e) {
        errors.push(`Row ${idx+2}: ${e.message}`);
      }
    });
  })();

  res.json({
    ok: true,
    spares: spareCount,
    suppliers: suppliersSeen.size,
    errors: errors.slice(0, 20)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENG REQUESTS — live read-only sync from Justin's OneDrive xlsx via MS Graph
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');

const ENG_DRIVE_ID = process.env.ENG_DRIVE_ID || 'b!2NMJboov0kWeEJA81bibUZouNcWT6-JGg51u43y1cjRQpuuagL1QRpiCe7hpRy2o';
const ENG_ITEM_ID  = process.env.ENG_ITEM_ID  || '014UQDRKZNPYM74573GBA3VQBWBSGELPAI';

// Credentials: env vars first, then graph-config.json next to the db folder
function graphConfig() {
  let { MS_TENANT_ID: tenant, MS_CLIENT_ID: client, MS_CLIENT_SECRET: secret } = process.env;
  if (!tenant || !client || !secret) {
    try {
      const cfgPath = path.join(process.env.DB_DIR || path.join(__dirname, '../db'), '..', 'graph-config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      tenant = tenant || cfg.tenantId; client = client || cfg.clientId; secret = secret || cfg.clientSecret;
    } catch { /* no config file */ }
  }
  return (tenant && client && secret) ? { tenant, client, secret } : null;
}

let graphToken = null, graphTokenExp = 0;
async function getGraphToken() {
  if (graphToken && Date.now() < graphTokenExp - 5 * 60 * 1000) return graphToken;
  const cfg = graphConfig();
  if (!cfg) throw new Error('Graph credentials not configured');
  const resp = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.client,
      client_secret: cfg.secret,
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  if (!resp.ok) throw new Error(`Graph token error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const j = await resp.json();
  graphToken = j.access_token;
  graphTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return graphToken;
}

function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
function getMeta(key) {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return r ? r.value : null;
}

// Unwrap ExcelJS cell values (richText, hyperlinks, formula results, Dates)
function cellText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // Excel serial dates come through as UTC Dates
    const y = v.getUTCFullYear(), m = String(v.getUTCMonth() + 1).padStart(2, '0'), d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    return String(v);
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normStatus(v) {
  const s = (cellText(v) || '').trim().toLowerCase();
  return ['g', 'y', 'r', 'p'].includes(s) ? s : (s || null);
}

// Parse tech/fab-style sheet: find the header row starting with "Request"
function parseRequestSheet(ws, sheetKey) {
  const out = [];
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (!headerRow && String(cellText(row.getCell(1).value) || '').toLowerCase() === 'request') headerRow = n;
  });
  if (!headerRow) return out;
  // Locate the "Tech Comments" / "Fab Comments" column by header text so it
  // keeps working even if the column moves
  let teamCol = 0, prioCol = 0;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const h = String(cellText(cell.value) || '').trim();
    if (!teamCol && /^(tech|fab)\s*comments$/i.test(h)) teamCol = col;
    if (!prioCol && /^priority$/i.test(h)) prioCol = col;
  });
  // Remember where to write back (worksheet name + columns)
  out.writeInfo = { wsName: ws.name, teamCol, prioCol };
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const c = i => cellText(row.getCell(i).value);
    const request = c(1);
    if (!request || /add lines above/i.test(request)) return;
    out.push({
      sheet: sheetKey, row_num: n,
      request, customer_part: c(2), notes: c(3),
      assigned_to: c(4), program_manager: c(5),
      date_open: c(6), target_date: c(7), date_closed: c(8),
      status: normStatus(row.getCell(9).value),
      pct_complete: null,
      comments: c(10), addl_comments: c(11),
      team_comments: teamCol ? c(teamCol) : null,
      priority: prioCol ? c(prioCol) : null
    });
  });
  return out;
}

// Parse proto sheet: Description | % Complete | Comments | Target Date | Completed (cols A-E)
function parseProtoSheet(ws) {
  const out = [];
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (!headerRow && String(cellText(row.getCell(1).value) || '').toLowerCase() === 'description') headerRow = n;
  });
  if (!headerRow) return out;
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const c = i => cellText(row.getCell(i).value);
    const request = c(1);
    if (!request) return;
    let pct = row.getCell(2).value;
    if (pct && typeof pct === 'object' && pct.result !== undefined) pct = pct.result;
    pct = typeof pct === 'number' ? (pct <= 1 ? pct * 100 : pct) : (parseFloat(String(pct || '').replace('%', '')) || null);
    out.push({
      sheet: 'proto', row_num: n,
      request, customer_part: null, notes: null,
      assigned_to: null, program_manager: null,
      date_open: null, target_date: c(4), date_closed: c(5),
      status: null, pct_complete: pct,
      comments: c(3), addl_comments: null
    });
  });
  return out;
}

async function syncEngRequests() {
  const token = await getGraphToken();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${ENG_DRIVE_ID}/items/${ENG_ITEM_ID}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Graph download error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const findSheet = kw => wb.worksheets.find(s => s.name.toLowerCase().includes(kw));
  const rows = [];
  const counts = { tech: 0, fab: 0, proto: 0 };

  const writeInfo = {};
  const techWs = findSheet('tech');
  if (techWs) { const r = parseRequestSheet(techWs, 'tech'); counts.tech = r.length; writeInfo.tech = r.writeInfo; rows.push(...r); }
  const fabWs = findSheet('fab');
  if (fabWs) { const r = parseRequestSheet(fabWs, 'fab'); counts.fab = r.length; writeInfo.fab = r.writeInfo; rows.push(...r); }
  const protoWs = findSheet('proto');
  if (protoWs) { const r = parseProtoSheet(protoWs); counts.proto = r.length; rows.push(...r); }

  const now = new Date().toISOString();
  txn(() => {
    db.prepare('DELETE FROM eng_request').run();
    const ins = db.prepare(`INSERT INTO eng_request
      (sheet, row_num, request, customer_part, notes, assigned_to, program_manager,
       date_open, target_date, date_closed, status, pct_complete, comments, addl_comments, team_comments, priority, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    rows.forEach(r => ins.run(
      r.sheet, r.row_num, r.request, r.customer_part, r.notes, r.assigned_to, r.program_manager,
      r.date_open, r.target_date, r.date_closed, r.status, r.pct_complete, r.comments, r.addl_comments, r.team_comments ?? null, r.priority ?? null, now
    ));
    setMeta('eng_sync_at', now);
    setMeta('eng_sync_error', '');
    for (const k of ['tech', 'fab']) {
      if (writeInfo[k]) {
        setMeta(`eng_ws_${k}`, writeInfo[k].wsName);
        setMeta(`eng_teamcol_${k}`, String(writeInfo[k].teamCol || 0));
        setMeta(`eng_prioritycol_${k}`, String(writeInfo[k].prioCol || 0));
      }
    }
  });
  return counts;
}

// Column number → Excel letter (1→A, 27→AA)
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function graphExcel(method, urlPath, body) {
  const token = await getGraphToken();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${ENG_DRIVE_ID}/items/${ENG_ITEM_ID}/workbook/${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!resp.ok) throw new Error(`Graph workbook error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

app.get('/api/version', (req, res) => {
  res.json({ version: process.env.APP_VERSION || 'dev (node server.js)' });
});

// Editable spreadsheet-backed fields and where their column number is stored
const ENG_WRITE_FIELDS = {
  team_comments: { metaKey: 'eng_teamcol_', label: s => `${s === 'tech' ? 'Tech' : 'Fab'} Comments` },
  priority:      { metaKey: 'eng_prioritycol_', label: () => 'Priority' }
};

function engWsPath(wsName) {
  return `worksheets('${encodeURIComponent(wsName.replace(/'/g, "''"))}')`;
}

// Write a field back into the spreadsheet cell, then update local cache
app.post('/api/eng-requests/:id/comment', requireAuth, async (req, res) => {
  try {
    const field = String(req.body.field || 'team_comments');
    const spec = ENG_WRITE_FIELDS[field];
    if (!spec) return res.status(400).json({ error: 'Field not editable' });
    const text = String(req.body.text ?? '').slice(0, 2000);
    let row = db.prepare('SELECT * FROM eng_request WHERE id=?').get(req.params.id);
    // Ids change on every sync — fall back to matching the row by content
    if (!row && req.body.sheet && req.body.row_num && req.body.request) {
      row = db.prepare('SELECT * FROM eng_request WHERE sheet=? AND row_num=? AND request=?')
        .get(String(req.body.sheet), parseInt(req.body.row_num, 10), String(req.body.request));
    }
    if (!row) return res.status(404).json({ error: 'List out of date — press Sync and try again' });
    if (row.sheet !== 'tech' && row.sheet !== 'fab') return res.status(400).json({ error: 'Editing only supported on Tech and Fab sheets' });

    const wsName = getMeta(`eng_ws_${row.sheet}`);
    const col = parseInt(getMeta(spec.metaKey + row.sheet) || '0', 10);
    if (!wsName || !col) return res.status(400).json({ error: `No "${spec.label(row.sheet)}" column found in the spreadsheet — add the header and run a sync` });

    const wsPath = engWsPath(wsName);

    // Safety check: confirm the row hasn't shifted since last sync
    const check = await graphExcel('GET', `${wsPath}/range(address='A${row.row_num}')`);
    const liveReq = String((check.values && check.values[0] && check.values[0][0]) ?? '').trim();
    if (liveReq !== String(row.request || '').trim()) {
      return res.status(409).json({ error: 'The spreadsheet has changed since the last sync — press Sync and try again' });
    }

    const addr = `${colLetter(col)}${row.row_num}`;
    await graphExcel('PATCH', `${wsPath}/range(address='${addr}')`, { values: [[text]] });

    db.prepare(`UPDATE eng_request SET ${field}=? WHERE id=?`).run(text || null, row.id);
    res.json({ ok: true, field, value: text || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fixed notification recipients per sheet — eng-notify.json next to the db folder
// (same lookup as graph-config.json), falling back to the server folder
function engNotifyRecipients(sheet) {
  for (const p of [
    path.join(process.env.DB_DIR || path.join(__dirname, '../db'), '..', 'eng-notify.json'),
    path.join(__dirname, '..', 'eng-notify.json')
  ]) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(cfg[sheet]) ? cfg[sheet] : [];
      return list.filter(r => r && r.email && !/FILL ME IN/i.test(r.name || '') && !/^someone@/i.test(r.email));
    } catch { /* try next */ }
  }
  return [];
}

// Queue an email through the same notify pipeline the applicator Notify uses
function queueEngNotification(req, sheet, body) {
  try {
    const recipients = engNotifyRecipients(sheet);
    if (!recipients.length) return 0;
    const payload = {
      id: Date.now(),
      section: 'eng',
      sectionLabel: `New ENG Request (${sheet === 'tech' ? 'Tech' : 'Fab'})`,
      statusText: 'New Request',
      status: 'open',
      desc: [body.request, body.customer_part].filter(Boolean).join(' — '),
      note: body.notes || null,
      ticketNum: null,
      ticketUrl: null,
      priority: body.priority || 'normal',
      by: (req.session && req.session.userName) || null,
      daysOpen: 0,
      terminal: null, wire: null, awg: null, doc: null,
      notes: [body.assigned_to && ('Assigned to: ' + body.assigned_to),
              body.program_manager && ('PM: ' + body.program_manager),
              body.target_date && ('Target: ' + body.target_date)].filter(Boolean).join(' · ') || null,
      result: null,
      recipients,
      queuedAt: Date.now(),
      queuedBy: (req.session && req.session.userName) || 'FloorSync'
    };
    db.prepare('INSERT INTO notify_queue (payload) VALUES (?)').run(JSON.stringify(payload));
    return recipients.length;
  } catch (e) {
    console.error('[eng-notify] queue failed:', e.message);
    return 0;
  }
}

// Create a new request row in the spreadsheet (above the "Add Lines Above" sentinel)
app.post('/api/eng-requests/new', requireAuth, async (req, res) => {
  try {
    const { sheet } = req.body;
    if (sheet !== 'tech' && sheet !== 'fab') return res.status(400).json({ error: 'sheet must be tech or fab' });
    const request = String(req.body.request || '').trim();
    if (!request) return res.status(400).json({ error: 'Request description is required' });

    const wsName = getMeta(`eng_ws_${sheet}`);
    if (!wsName) return res.status(400).json({ error: 'Run a sync first so the server knows the worksheet layout' });
    const wsPath = engWsPath(wsName);

    // Find the sentinel row live so rows added since last sync don't break placement
    const colA = await graphExcel('GET', `${wsPath}/usedRange(valuesOnly=true)?$select=values,rowIndex`);
    const values = colA.values || [];
    const base = (colA.rowIndex || 0) + 1; // rowIndex is 0-based
    let insertAt = 0, lastData = 0;
    values.forEach((rowVals, i) => {
      const a = String((rowVals && rowVals[0]) ?? '').trim();
      if (/add lines above/i.test(a)) { if (!insertAt) insertAt = base + i; }
      else if (a) lastData = base + i;
    });
    if (!insertAt) insertAt = lastData + 1;

    // Insert a blank row so nothing below is overwritten
    await graphExcel('POST', `${wsPath}/range(address='${insertAt}:${insertAt}')/insert`, { shift: 'Down' });

    const d = new Date();
    const today = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
    const f = k => String(req.body[k] ?? '').slice(0, 500);
    // A..I: Request, Customer, Notes, Assigned, PM, Date Open, Target, Date Closed, Status
    await graphExcel('PATCH', `${wsPath}/range(address='A${insertAt}:I${insertAt}')`, {
      values: [[request, f('customer_part'), f('notes'), f('assigned_to'), f('program_manager'), today, f('target_date'), '', 'G']]
    });
    // Optional header-located columns
    for (const [field, spec] of Object.entries(ENG_WRITE_FIELDS)) {
      const v = f(field);
      const col = parseInt(getMeta(spec.metaKey + sheet) || '0', 10);
      if (v && col) await graphExcel('PATCH', `${wsPath}/range(address='${colLetter(col)}${insertAt}')`, { values: [[v]] });
    }

    // Refresh the local cache so row numbers line up
    const counts = await syncEngRequests();
    const notified = queueEngNotification(req, sheet, req.body);
    res.json({ ok: true, counts, notified });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/eng-requests/sync', requireAuth, async (req, res) => {
  try {
    const counts = await syncEngRequests();
    res.json({ ok: true, counts, synced_at: getMeta('eng_sync_at') });
  } catch (e) {
    setMeta('eng_sync_error', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/eng-requests', requireAuth, (req, res) => {
  const { sheet, open } = req.query;
  let sql = 'SELECT * FROM eng_request WHERE 1=1';
  const params = [];
  if (sheet) { sql += ' AND sheet=?'; params.push(sheet); }
  if (open === '1') sql += " AND (date_closed IS NULL OR date_closed='')";
  sql += ' ORDER BY row_num';
  res.json({
    rows: db.prepare(sql).all(...params),
    synced_at: getMeta('eng_sync_at'),
    error: getMeta('eng_sync_error') || null,
    configured: !!graphConfig()
  });
});

// Auto-sync every 15 minutes (plus once shortly after startup) when configured
if (graphConfig()) {
  const safeSync = () => syncEngRequests().catch(e => {
    setMeta('eng_sync_error', e.message);
    console.error('[eng-sync]', e.message);
  });
  setTimeout(safeSync, 30 * 1000);
  setInterval(safeSync, 15 * 60 * 1000);
} else {
  console.log('[eng-sync] Graph credentials not configured — ENG Requests sync disabled');
}

app.listen(PORT, () => console.log(`FloorSync listening on port ${PORT}`));
