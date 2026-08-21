'use strict';
// Post-build: copy the fresh installer + latest.yml into ../updates/ so
// installed copies pick up the new version automatically.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
const updates = path.join(__dirname, '..', 'updates');
fs.mkdirSync(updates, { recursive: true });

const files = fs.readdirSync(dist).filter(f => f.endsWith('.exe') || f === 'latest.yml' || f.endsWith('.blockmap'));
if (!files.some(f => f.endsWith('.exe'))) {
  console.error('No installer found in dist/ — build may have failed.');
  process.exit(1);
}
for (const f of files) {
  fs.copyFileSync(path.join(dist, f), path.join(updates, f));
  console.log(`Copied ${f} -> updates/`);
}
console.log('Done. Installed apps will auto-update on next launch.');
