'use strict';
// Usage: node src/migrate.js [--import-gist]
// Requires env vars: GIST_ID, GIST_TOKEN (only for --import-gist)

const https = require('https');
const createDb = require('./db');

const db = createDb();

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(data); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function gistGet(gistId, token) {
  return httpGet(`https://api.github.com/gists/${gistId}`,
    { 'User-Agent': 'floorsync-migrate', 'Authorization': `token ${token}` })
    .then(d => JSON.parse(d));
}

async function importGist() {
  const gistId = process.env.GIST_ID;
  const token  = process.env.GIST_TOKEN;
  if (!gistId || !token) {
    console.error('Set GIST_ID and GIST_TOKEN env vars');
    process.exit(1);
  }

  console.log('Fetching Gist...');
  const gist = await gistGet(gistId, token);
  const files = gist.files || {};
  console.log('Files found in Gist:', Object.keys(files).join(', ') || '(none)');

  async function parseFile(name) {
    const f = files[name];
    if (!f) return null;
    let content = f.content;
    if (f.truncated && f.raw_url) {
      console.log(`  ${name} is truncated — fetching raw...`);
      content = await httpGet(f.raw_url, { 'User-Agent': 'floorsync-migrate', 'Authorization': `token ${token}` });
    }
    try {
      const p = JSON.parse(content);
      // Data may be wrapped: {issues:[...]}, {entries:[...]}, etc.
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.issues))   return p.issues;
      if (p && Array.isArray(p.entries))  return p.entries;
      if (p && Array.isArray(p.data))     return p.data;
      return p;
    } catch { return null; }
  }

  // Users
  const users = await parseFile('users.json');
  if (Array.isArray(users)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`);
    users.forEach(u => stmt.run(u.name||u.n, u.pin_hash||u.pinHash||u.p, u.role||'tech'));
    console.log(`Imported ${users.length} users`);
  } else {
    const meta = await parseFile('hl_applicator_meta.json');
    if (meta && Array.isArray(meta.users)) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`);
      meta.users.forEach(u => stmt.run(u.name||u.n, u.pinHash||u.pin_hash||u.p, u.role||'supervisor'));
      console.log(`Imported ${meta.users.length} users from hl_applicator_meta.json`);
    } else if (meta && meta.pinHash) {
      db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`)
        .run(meta.name||'Tyler', meta.pinHash, 'supervisor');
      console.log('Imported 1 user from hl_applicator_meta.json');
    }
  }

  // Contacts / customers
  const contacts = await parseFile('contacts.json');
  if (Array.isArray(contacts)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO contacts (id,name,email,active) VALUES (?,?,?,1)`);
    contacts.forEach((c,i) => stmt.run(c.id||i+1, c.name, c.email||null));
    console.log(`Imported ${contacts.length} contacts`);
  }
  const customers = await parseFile('customers.json');
  if (Array.isArray(customers)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO customers (id,name,active) VALUES (?,?,1)`);
    customers.forEach((c,i) => stmt.run(c.id||i+1, c.name));
    console.log(`Imported ${customers.length} customers`);
  }

  // Applicator entries
  const applicator = await parseFile('hl_applicator_data.json') || await parseFile('applicator.json');
  if (Array.isArray(applicator)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO applicator_entries
      (id,apn,press,terminal,wire,customer,issue,notes,status,priority,by_user,ticket_num,submitted_by,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    applicator.forEach(e => stmt.run(e.id,e.apn||null,e.press||null,e.terminal||null,
      e.wire||null,e.customer||null,e.issue||null,e.notes||null,
      e.status||'open',e.priority||'normal',e.by||null,e.ticketNum||null,
      e.submittedBy||null,JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${applicator.length} applicator entries`);
  } else { console.log('No applicator entries found'); }

  // Machine entries
  const machine = await parseFile('hl_machine_data.json') || await parseFile('machine.json');
  if (Array.isArray(machine)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO machine_entries
      (id,machine,desc,result,customer,status,by_user,ticket_num,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    machine.forEach(e => stmt.run(e.id,e.machine||null,e.desc||null,e.result||null,
      e.customer||null,e.status||'open',e.by||null,e.ticketNum||null,
      JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${machine.length} machine entries`);
  } else { console.log('No machine entries found'); }

  // Setup entries
  const setup = await parseFile('hl_setup_data.json') || await parseFile('setup.json');
  if (Array.isArray(setup)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO setup_entries
      (id,terminal,awg,issue,doc,notes,customer,status,by_user,ticket_num,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    setup.forEach(e => stmt.run(e.id,e.terminal||null,e.awg||null,e.issue||null,
      e.doc||null,e.notes||null,e.customer||null,e.status||'open',
      e.by||null,e.ticketNum||null,JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${setup.length} setup entries`);
  } else { console.log('No setup entries found'); }

  // Queue order
  const queueOrder = await parseFile('hl_queue_order.json');
  for (const sec of ['applicator','machine','setup']) {
    let q = null;
    if (queueOrder && Array.isArray(queueOrder[sec])) q = queueOrder[sec];
    else if (sec==='machine') q = await parseFile('hl_queue_machine.json');
    else if (sec==='setup')   q = await parseFile('hl_queue_setup.json');
    if (Array.isArray(q) && q.length) {
      db.prepare('UPDATE queue_order SET order_json=? WHERE section=?').run(JSON.stringify(q), sec);
      console.log(`Queue ${sec}: ${q.length} items`);
    }
  }

  console.log('Migration complete.');
}

const cmd = process.argv[2];
if (cmd === '--import-gist') {
  importGist().catch(e => { console.error(e); process.exit(1); });
} else {
  console.log('Schema created/verified. Run with --import-gist to import from Gist.');
}
