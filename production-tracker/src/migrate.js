'use strict';
// Usage: node src/migrate.js [--import-gist]
// Requires env vars: GIST_ID, GIST_TOKEN (only for --import-gist)

const https = require('https');
const createDb = require('./db');

const db = createDb();

function gistGet(gistId, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/gists/${gistId}`,
      headers: { 'User-Agent': 'floorsync-migrate', 'Authorization': `token ${token}` }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
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

  function parseFile(name) {
    const f = files[name];
    if (!f) return null;
    try { return JSON.parse(f.content); } catch { return null; }
  }

  const users = parseFile('users.json');
  if (Array.isArray(users)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`);
    users.forEach(u => stmt.run(u.name||u.n, u.pin_hash||u.pinHash||u.p, u.role||'tech'));
    console.log(`Imported ${users.length} users`);
  }

  const contacts = parseFile('contacts.json');
  if (Array.isArray(contacts)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO contacts (id,name,email,active) VALUES (?,?,?,1)`);
    contacts.forEach((c,i) => stmt.run(c.id||i+1, c.name, c.email||null));
    console.log(`Imported ${contacts.length} contacts`);
  }

  const customers = parseFile('customers.json');
  if (Array.isArray(customers)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO customers (id,name,active) VALUES (?,?,1)`);
    customers.forEach((c,i) => stmt.run(c.id||i+1, c.name));
    console.log(`Imported ${customers.length} customers`);
  }

  const applicator = parseFile('applicator.json') || parseFile('hl_applicator_data.json');
  if (Array.isArray(applicator)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO applicator_entries
      (id,apn,press,terminal,wire,customer,issue,notes,status,priority,by_user,ticket_num,submitted_by,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    applicator.forEach(e => stmt.run(e.id,e.apn||null,e.press||null,e.terminal||null,
      e.wire||null,e.customer||null,e.issue||null,e.notes||null,
      e.status||'open',e.priority||'normal',e.by||null,e.ticketNum||null,
      e.submittedBy||null,JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${applicator.length} applicator entries`);
  }

  const machine = parseFile('machine.json') || parseFile('hl_machine_data.json');
  if (Array.isArray(machine)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO machine_entries
      (id,machine,desc,result,customer,status,by_user,ticket_num,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    machine.forEach(e => stmt.run(e.id,e.machine||null,e.desc||null,e.result||null,
      e.customer||null,e.status||'open',e.by||null,e.ticketNum||null,
      JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${machine.length} machine entries`);
  }

  const setup = parseFile('setup.json') || parseFile('hl_setup_data.json');
  if (Array.isArray(setup)) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO setup_entries
      (id,terminal,awg,issue,doc,notes,customer,status,by_user,ticket_num,photos,date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    setup.forEach(e => stmt.run(e.id,e.terminal||null,e.awg||null,e.issue||null,
      e.doc||null,e.notes||null,e.customer||null,e.status||'open',
      e.by||null,e.ticketNum||null,JSON.stringify(e.photos||[]),e.date||null));
    console.log(`Imported ${setup.length} setup entries`);
  }

  // Try to read queue from gist
  const gistData = parseFile('hl_applicator_data.json');
  const appQueue = parseFile('hl_queue_applicator.json') || (gistData&&gistData.queueOrder) || [];
  ['applicator','machine','setup'].forEach(sec => {
    const q = sec==='applicator' ? appQueue :
              sec==='machine'    ? (parseFile('hl_queue_machine.json')||[]) :
                                   (parseFile('hl_queue_setup.json')||[]);
    if (Array.isArray(q) && q.length) {
      db.prepare('UPDATE queue_order SET order_json=? WHERE section=?').run(JSON.stringify(q), sec);
    }
  });
  console.log('Queue order imported');

  // Import users from meta file if no users.json
  if (!users) {
    const meta = parseFile('hl_meta.json');
    if (meta && meta.users) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`);
      meta.users.forEach(u => stmt.run(u.name, u.pinHash||u.pin_hash, u.role||'tech'));
      console.log(`Imported ${meta.users.length} users from meta`);
    } else if (meta && meta.pinHash) {
      db.prepare(`INSERT OR IGNORE INTO users (name,pin_hash,role,active) VALUES (?,?,?,1)`)
        .run('Tyler', meta.pinHash, 'supervisor');
      console.log('Imported 1 user from legacy pinHash');
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
