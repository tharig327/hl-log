'use strict';
// Run: node import-users.js
// Set GIST_ID and GIST_TOKEN env vars first (or edit the lines below)

const { DatabaseSync } = require('node:sqlite');
const https = require('https');

const GIST_ID = process.env.GIST_ID || '934943f5c9d8ea126f30a27526c95771';
const TOKEN = process.env.GIST_TOKEN || '';
const DB_PATH = process.env.DB_PATH || './db/floorsync.db';

const db = new DatabaseSync(DB_PATH);

const options = {
  hostname: 'api.github.com',
  path: '/gists/' + GIST_ID,
  headers: {
    'User-Agent': 'floorsync-import',
    'Authorization': 'token ' + TOKEN
  }
};

https.get(options, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const gist = JSON.parse(d);
    const metaFile = gist.files && gist.files['hl_applicator_meta.json'];
    if (!metaFile) {
      console.error('hl_applicator_meta.json not found in Gist. Files:', Object.keys(gist.files || {}).join(', '));
      process.exit(1);
    }
    const meta = JSON.parse(metaFile.content);
    console.log('Raw meta:', JSON.stringify(meta, null, 2));

    const users = meta.users || (meta.name ? [meta] : []);
    if (!users.length) {
      console.error('No users found in meta file');
      process.exit(1);
    }

    db.exec('DELETE FROM users');
    const stmt = db.prepare('INSERT INTO users (name, pin_hash, role, active) VALUES (?, ?, ?, 1)');
    users.forEach(u => {
      const name = u.name || u.n;
      const hash = u.pinHash || u.pin_hash || u.p;
      const role = u.role || 'supervisor';
      console.log(`  Importing: ${name} (${role})`);
      stmt.run(name, hash, role);
    });
    console.log(`\nImported ${users.length} user(s). Restart the server.`);
  });
}).on('error', err => {
  console.error('Request failed:', err.message);
});
