'use strict';
const express = require('express');
const session = require('express-session');
const path = require('path');
const createDb = require('./db');

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

app.use(express.static(path.join(__dirname, '../../')));


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

app.listen(PORT, () => console.log(`FloorSync listening on port ${PORT}`));
