'use strict';
// Email notifier — merged from the standalone notifier script.
// Runs inside the FloorSync server against the same database:
//  - emails new issue tickets (applicator/machine/setup) to matching contacts
//  - sends queued manual/ENG notifications from notify_queue
// Seen-tracking lives in the notifier_seen table instead of a JSON file.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const POLL_MS = parseInt(process.env.NOTIFY_POLL_INTERVAL || '60000', 10);

// SMTP config: env vars first, then smtp-config.json next to the db folder
function smtpConfig() {
  let cfg = {
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
    from: process.env.NOTIFY_FROM, skip: process.env.NOTIFY_SKIP,
    appUrl: process.env.APP_URL
  };
  if (!cfg.host || !cfg.from) {
    for (const p of [
      path.join(process.env.DB_DIR || path.join(__dirname, '../db'), '..', 'smtp-config.json'),
      path.join(__dirname, '..', 'smtp-config.json')
    ]) {
      try {
        const f = JSON.parse(fs.readFileSync(p, 'utf8'));
        cfg = { ...f, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v)) };
        break;
      } catch { /* try next */ }
    }
  }
  if (!cfg.host || !cfg.from) return null;
  cfg.appUrl = cfg.appUrl || 'http://tyler.hl.local:3000';
  cfg.skipAddresses = String(cfg.skip || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return cfg;
}

// ── Email builders (ported unchanged in content from the standalone notifier) ──

function buildEmail(cfg, entry, section) {
  const typeLabel = { applicator: 'Applicator Issue', machine: 'Machine Issue', setup: 'Setup Sheet Issue' }[section];
  const typeIcon = { applicator: '🔧', machine: '⚙️', setup: '📄' }[section];
  const priority = entry.priority || 'normal';
  const priorityLabel = { urgent: '🔴 URGENT', high: '🟡 HIGH', normal: '🟢 Normal' }[priority];
  const primaryId = { applicator: entry.apn, machine: entry.machine, setup: entry.terminal }[section] || '—';
  const description = { applicator: entry.issue, machine: entry.desc, setup: entry.issue }[section] || '—';
  const subject = `[${priority === 'urgent' ? 'URGENT ' : priority === 'high' ? 'HIGH ' : ''}New Ticket] ${typeIcon} ${primaryId} — ${entry.ticket_num}`;

  const extraLines = {
    applicator: [
      entry.press ? `Press / Machine:  ${entry.press}` : null,
      entry.terminal ? `Terminal P/N:     ${entry.terminal}` : null,
      entry.wire ? `Wire:             ${entry.wire}` : null,
    ],
    machine: [],
    setup: [
      entry.awg ? `AWG:      ${entry.awg}` : null,
      entry.doc ? `Document: ${entry.doc}` : null,
    ]
  }[section].filter(Boolean);

  const submitted = new Date(entry.date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });

  const ticketUrl = `${cfg.appUrl}/t/?ticket=${entry.ticket_num || ''}`;

  const text = [
    `H&L Manufacturing — New Issue Ticket`,
    `${'─'.repeat(40)}`,
    ``,
    `Ticket Number:    ${entry.ticket_num}`,
    `Issue Type:       ${typeLabel}`,
    `Priority:         ${priorityLabel}`,
    ``,
    `${section === 'applicator' ? 'Applicator #' : section === 'machine' ? 'Machine #' : 'Terminal #'}:  ${primaryId}`,
    ...extraLines,
    ``,
    `Description:`,
    `  ${description}`,
    ``,
    `Submitted by:     ${entry.submitted_by || entry.by_user || '—'}`,
    `Submitted at:     ${submitted}`,
    ``,
    `Track this ticket:`,
    `  ${ticketUrl}`,
    ``,
    `${'─'.repeat(40)}`,
    `H&L Applicator Log Notification Service`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)">
    <div style="background:#cc2222;padding:20px 24px">
      <div style="color:#fff;font-size:16px;font-weight:600">${typeIcon} New Issue Ticket — ${entry.ticket_num}</div>
      <div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:2px">H&L Manufacturing · ${typeLabel}</div>
    </div>
    <div style="background:#1c1c1c;padding:12px 24px;display:flex;align-items:center;justify-content:space-between">
      <span style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.1em">Priority</span>
      <span style="color:${priority === 'urgent' ? '#ff6666' : priority === 'high' ? '#d4a030' : '#50a870'};font-weight:700;font-size:13px">${priorityLabel}</span>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:7px 0;color:#666;width:40%">${section === 'applicator' ? 'Applicator #' : section === 'machine' ? 'Machine #' : 'Terminal #'}</td><td style="padding:7px 0;font-weight:600;font-family:monospace">${primaryId}</td></tr>
        ${extraLines.map(l => `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">${l.split(':')[0].trim()}</td><td style="padding:7px 0">${l.split(':').slice(1).join(':').trim()}</td></tr>`).join('')}
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666;vertical-align:top">Description</td><td style="padding:7px 0">${description}</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Submitted by</td><td style="padding:7px 0">${entry.submitted_by || entry.by_user || '—'}</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Submitted at</td><td style="padding:7px 0">${submitted}</td></tr>
      </table>
      <div style="margin-top:20px;text-align:center">
        <a href="${ticketUrl}" style="display:inline-block;background:#cc2222;color:#fff;text-decoration:none;padding:11px 24px;border-radius:5px;font-size:13px;font-weight:500">View Ticket Status →</a>
      </div>
    </div>
    <div style="background:#f9f9f9;border-top:1px solid #eee;padding:12px 24px;text-align:center;font-size:11px;color:#999">
      H&L Issue Log · <a href="${ticketUrl}" style="color:#5b9bd5">Track ticket ${entry.ticket_num}</a>
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

function buildAdminEmail(n) {
  const payload = JSON.parse(n.payload);
  const priority = payload.priority || 'normal';
  const priorityLabel = { urgent: 'URGENT', high: 'HIGH', normal: 'Normal' }[priority] || priority;
  const priorityColor = { urgent: '#ff6666', high: '#d4a030', normal: '#50a870' }[priority] || '#50a870';
  const typeIcon = { applicator: '🔧', machine: '⚙️', setup: '📄', eng: '🛠' }[payload.section] || '📋';
  const typeLabel = { applicator: 'Applicator Issue', machine: 'Machine Issue', setup: 'Setup Sheet Issue', eng: 'ENG Request' }[payload.section] || 'Issue';
  const statusColor = { done: '#50a870', inprog: '#d4a030', waiting: '#5090d0', open: '#e07050' }[payload.status] || '#e07050';

  const subject = `[${payload.statusText}] ${typeIcon} ${payload.sectionLabel}${payload.ticketNum ? ' — ' + payload.ticketNum : ''}`;

  const extraRows = [
    payload.terminal ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Terminal P/N</td><td style="padding:7px 0">${payload.terminal}</td></tr>` : '',
    payload.wire ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Wire</td><td style="padding:7px 0">${payload.wire}</td></tr>` : '',
    payload.awg ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">AWG</td><td style="padding:7px 0">${payload.awg}</td></tr>` : '',
    payload.doc ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Document</td><td style="padding:7px 0">${payload.doc}</td></tr>` : '',
    payload.notes ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666;vertical-align:top">Notes</td><td style="padding:7px 0">${payload.notes}</td></tr>` : '',
    payload.result ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666;vertical-align:top">Result</td><td style="padding:7px 0">${payload.result}</td></tr>` : '',
    payload.note ? `<tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#e07050;vertical-align:top">Additional Note</td><td style="padding:7px 0;color:#333">${payload.note}</td></tr>` : '',
  ].join('');

  const sentAt = new Date(n.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)">
    <div style="background:#cc2222;padding:20px 24px">
      <div style="color:#fff;font-size:16px;font-weight:600">${typeIcon} ${payload.sectionLabel}</div>
      <div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:2px">H&L Manufacturing · ${typeLabel}</div>
    </div>
    <div style="background:#1c1c1c;padding:12px 24px;display:flex;align-items:center;justify-content:space-between">
      <span style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.1em">Status</span>
      <span style="color:${statusColor};font-weight:700;font-size:13px">${payload.statusText}</span>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${payload.ticketNum ? `<tr><td style="padding:7px 0;color:#666;width:40%">Ticket</td><td style="padding:7px 0;font-family:monospace;font-weight:600;color:#5090d0">${payload.ticketNum}</td></tr>` : ''}
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Description</td><td style="padding:7px 0">${payload.desc}</td></tr>
        ${extraRows}
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Priority</td><td style="padding:7px 0;color:${priorityColor};font-weight:600">${priorityLabel}</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Logged by</td><td style="padding:7px 0">${payload.by || '—'}</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Days open</td><td style="padding:7px 0">${payload.daysOpen}d</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:7px 0;color:#666">Sent by</td><td style="padding:7px 0">${payload.queuedBy || '—'} at ${sentAt}</td></tr>
      </table>
      ${payload.ticketUrl ? `<div style="margin-top:20px;text-align:center"><a href="${payload.ticketUrl}" style="display:inline-block;background:#cc2222;color:#fff;text-decoration:none;padding:11px 24px;border-radius:5px;font-size:13px;font-weight:500">View Ticket Status →</a></div>` : ''}
    </div>
    <div style="background:#f9f9f9;border-top:1px solid #eee;padding:12px 24px;text-align:center;font-size:11px;color:#999">
      H&L Issue Log · Notification
    </div>
  </div>
</body></html>`;

  const text = [
    `H&L Manufacturing — Issue Update`,
    '─'.repeat(40),
    '',
    `${payload.sectionLabel}`,
    `Status:      ${payload.statusText}`,
    payload.ticketNum ? `Ticket:      ${payload.ticketNum}` : '',
    `Description: ${payload.desc}`,
    payload.note ? `\nNote: ${payload.note}` : '',
    '',
    `Priority:    ${priorityLabel}`,
    `Logged by:   ${payload.by || '—'}`,
    `Days open:   ${payload.daysOpen}d`,
    payload.ticketUrl ? `\nTrack: ${payload.ticketUrl}` : '',
    '',
    '─'.repeat(40),
    `Sent by ${payload.queuedBy || 'Unknown'} at ${sentAt}`
  ].filter(l => l !== null).join('\n');

  return { subject, text, html, payload };
}

// ── Recipient formatting ──
function toAndCc(recipients) {
  const fmt = r => r.name ? `"${r.name}" <${r.email}>` : r.email;
  return { to: fmt(recipients[0]), cc: recipients.slice(1).map(fmt).join(', ') };
}

// ── Main poll ──
function startNotifier(db) {
  const cfg = smtpConfig();
  if (!cfg) {
    console.log('[notifier] SMTP not configured — email notifications disabled (create server/smtp-config.json)');
    return;
  }

  const transportConfig = {
    host: cfg.host,
    port: parseInt(cfg.port || '25', 10),
    secure: false,
    tls: { rejectUnauthorized: false }
  };
  if (cfg.user && cfg.pass) transportConfig.auth = { user: cfg.user, pass: cfg.pass };
  const transport = nodemailer.createTransport(transportConfig);

  const seenHas = db.prepare('SELECT 1 FROM notifier_seen WHERE id=?');
  const seenIns = db.prepare('INSERT OR IGNORE INTO notifier_seen (id) VALUES (?)');

  function allIssues() {
    return [
      ...db.prepare('SELECT * FROM applicator_entries').all().map(e => ({ ...e, _section: 'applicator' })),
      ...db.prepare('SELECT * FROM machine_entries').all().map(e => ({ ...e, _section: 'machine' })),
      ...db.prepare('SELECT * FROM setup_entries').all().map(e => ({ ...e, _section: 'setup' })),
    ];
  }

  // First run: baseline all existing tickets as seen (matches the old notifier_seen.json bootstrap)
  const initRow = db.prepare("SELECT value FROM meta WHERE key='notifier_seen_init'").get();
  if (!initRow || initRow.value !== '1') {
    const all = allIssues();
    all.forEach(e => seenIns.run(String(e.id)));
    db.prepare("INSERT INTO meta (key,value) VALUES ('notifier_seen_init','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    console.log(`[notifier] first run — baselined ${all.length} existing tickets as seen`);
  }

  async function poll() {
    try {
      const contacts = db.prepare('SELECT * FROM contacts WHERE active=1').all();
      const customers = db.prepare('SELECT * FROM customers WHERE active=1').all();
      const issues = allIssues();

      const fresh = issues.filter(e => e.ticket_num && !seenHas.get(String(e.id)));
      const newTickets = fresh.filter(e => !e.ticket_num.startsWith('S-'));
      const suppressed = fresh.filter(e => e.ticket_num.startsWith('S-'));
      suppressed.forEach(e => seenIns.run(String(e.id)));

      for (const entry of newTickets) {
        try {
          const { subject, text, html } = buildEmail(cfg, entry, entry._section);
          const matchedCustomer = entry.customer
            ? customers.find(c => c.name && c.name.toLowerCase() === entry.customer.toLowerCase())
            : null;
          const customerId = matchedCustomer ? String(matchedCustomer.id) : null;
          const recipients = contacts.filter(c => {
            if (!c.email) return false;
            if (cfg.skipAddresses.includes(c.email.toLowerCase())) return false;
            const custList = (() => { try { return JSON.parse(c.customers || '[]'); } catch { return []; } })();
            if (!custList.length) return true;
            if (!customerId) return false;
            return custList.map(String).includes(customerId);
          });
          if (!recipients.length) {
            console.log(`[notifier] no recipients for ${entry.ticket_num} — skipping`);
            seenIns.run(String(entry.id));
            continue;
          }
          const { to, cc } = toAndCc(recipients);
          await transport.sendMail({
            from: `"H&L Issue Log" <${cfg.from}>`,
            to,
            replyTo: 'ENG@hlmanufacturing.com, wirecutter@hlmanufacturing.com',
            ...(cc && { cc }),
            subject, text, html
          });
          console.log(`[notifier] sent ${entry.ticket_num} -> ${to}${cc ? ' + CC' : ''}`);
          seenIns.run(String(entry.id));
        } catch (e) {
          console.error(`[notifier] failed for ${entry.ticket_num}:`, e.message);
        }
      }

      // Manual / ENG notification queue
      const queue = db.prepare("SELECT * FROM notify_queue WHERE status='pending'").all();
      for (const n of queue) {
        try {
          const { subject, text, html, payload } = buildAdminEmail(n);
          const recipients = payload.recipients || [];
          if (!recipients.length) {
            db.prepare("UPDATE notify_queue SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?").run(n.id);
            continue;
          }
          const { to, cc } = toAndCc(recipients);
          await transport.sendMail({
            from: `"H&L Issue Log" <${cfg.from}>`,
            to,
            replyTo: 'ENG@hlmanufacturing.com, wirecutter@hlmanufacturing.com',
            ...(cc && { cc }),
            subject, text, html
          });
          console.log(`[notifier] notification sent -> ${to}`);
          db.prepare("UPDATE notify_queue SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?").run(n.id);
        } catch (e) {
          console.error('[notifier] notification failed:', e.message);
        }
      }
    } catch (e) {
      console.error('[notifier] poll error:', e.message);
    }
  }

  transport.verify()
    .then(() => console.log(`[notifier] SMTP verified (${cfg.host}) — polling every ${POLL_MS / 1000}s`))
    .catch(e => console.error('[notifier] SMTP verify failed (will still try to send):', e.message));

  setTimeout(poll, 10 * 1000);
  setInterval(poll, POLL_MS);
}

module.exports = { startNotifier, buildEmail, buildAdminEmail, smtpConfig };
