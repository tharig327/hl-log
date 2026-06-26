const express = require('express');
const path = require('path');
const createDb = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

async function start() {
  const db = await createDb();

  // ── Customers ──────────────────────────────────────────────────
  app.get('/api/customers', (req, res) => {
    res.json(db.prepare('SELECT * FROM customers ORDER BY name').all());
  });

  app.post('/api/customers', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    try {
      const result = db.prepare('INSERT INTO customers (name) VALUES (?)').run(name.trim());
      res.json({ id: result.lastInsertRowid, name: name.trim() });
    } catch (e) {
      res.status(409).json({ error: 'Customer already exists' });
    }
  });

  app.delete('/api/customers/:id', (req, res) => {
    const parts = db.prepare('SELECT id FROM parts WHERE customer_id = ?').all(req.params.id);
    const del = db.transaction(() => {
      parts.forEach(p => {
        db.prepare('DELETE FROM scrap_log WHERE production_log_id IN (SELECT id FROM production_logs WHERE part_id = ?)').run(p.id);
        db.prepare('DELETE FROM production_logs WHERE part_id = ?').run(p.id);
      });
      db.prepare('DELETE FROM parts WHERE customer_id = ?').run(req.params.id);
      db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    });
    del();
    res.json({ ok: true });
  });

  app.post('/api/customers/bulk', (req, res) => {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0) return res.status(400).json({ error: 'names array required' });
    const insert = db.transaction(() => {
      let added = 0, skipped = 0;
      names.forEach(name => {
        const trimmed = name.trim();
        if (!trimmed) return;
        try { db.prepare('INSERT INTO customers (name) VALUES (?)').run(trimmed); added++; }
        catch { skipped++; }
      });
      return { added, skipped };
    });
    res.json(insert());
  });

  // ── Parts ──────────────────────────────────────────────────────
  app.get('/api/parts', (req, res) => {
    const { customer_id } = req.query;
    let query = `SELECT p.*, c.name as customer_name FROM parts p JOIN customers c ON p.customer_id = c.id`;
    const params = [];
    if (customer_id) { query += ' WHERE p.customer_id = ?'; params.push(customer_id); }
    query += ' ORDER BY c.name, p.part_number';
    res.json(db.prepare(query).all(...params));
  });

  app.post('/api/parts', (req, res) => {
    const { customer_id, part_number, description, target_rate } = req.body;
    if (!customer_id || !part_number) return res.status(400).json({ error: 'customer_id and part_number required' });
    try {
      const result = db.prepare(
        'INSERT INTO parts (customer_id, part_number, description, target_rate) VALUES (?, ?, ?, ?)'
      ).run(customer_id, part_number.trim(), description || null, target_rate || null);
      res.json({ id: result.lastInsertRowid });
    } catch (e) {
      res.status(409).json({ error: 'Part already exists for this customer' });
    }
  });

  app.put('/api/parts/:id', (req, res) => {
    const { description, target_rate } = req.body;
    db.prepare('UPDATE parts SET description=?, target_rate=? WHERE id=?')
      .run(description || null, target_rate || null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/api/parts/:id', (req, res) => {
    const del = db.transaction(() => {
      db.prepare('DELETE FROM scrap_log WHERE production_log_id IN (SELECT id FROM production_logs WHERE part_id = ?)').run(req.params.id);
      db.prepare('DELETE FROM production_logs WHERE part_id = ?').run(req.params.id);
      db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
    });
    del();
    res.json({ ok: true });
  });

  app.post('/api/parts/bulk', (req, res) => {
    const { parts } = req.body;
    if (!Array.isArray(parts) || parts.length === 0) return res.status(400).json({ error: 'parts array required' });
    const insert = db.transaction(() => {
      let added = 0, skipped = 0;
      parts.forEach(({ customer_id, part_number, description, target_rate }) => {
        if (!customer_id || !part_number) { skipped++; return; }
        try {
          db.prepare('INSERT INTO parts (customer_id, part_number, description, target_rate) VALUES (?, ?, ?, ?)')
            .run(customer_id, part_number.trim(), description || null, target_rate || null);
          added++;
        } catch { skipped++; }
      });
      return { added, skipped };
    });
    res.json(insert());
  });

  // ── Employees ──────────────────────────────────────────────────
  app.get('/api/employees', (req, res) => {
    const includeInactive = req.query.include_inactive === '1';
    const rows = includeInactive
      ? db.prepare('SELECT * FROM employees ORDER BY active DESC, name').all()
      : db.prepare('SELECT * FROM employees WHERE active=1 ORDER BY name').all();
    res.json(rows);
  });

  app.post('/api/employees', (req, res) => {
    const { name, employee_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    try {
      const result = db.prepare('INSERT INTO employees (name, employee_id) VALUES (?, ?)').run(name.trim(), employee_id || null);
      res.json({ id: result.lastInsertRowid });
    } catch (e) {
      res.status(409).json({ error: 'Employee already exists' });
    }
  });

  app.put('/api/employees/:id', (req, res) => {
    const { active } = req.body;
    db.prepare('UPDATE employees SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/api/employees/:id', (req, res) => {
    db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/employees/bulk', (req, res) => {
    const { employees } = req.body;
    if (!Array.isArray(employees) || employees.length === 0) return res.status(400).json({ error: 'employees array required' });
    const insert = db.transaction(() => {
      let added = 0, skipped = 0;
      employees.forEach(({ name, employee_id }) => {
        if (!name) { skipped++; return; }
        try { db.prepare('INSERT INTO employees (name, employee_id) VALUES (?, ?)').run(name.trim(), employee_id || null); added++; }
        catch { skipped++; }
      });
      return { added, skipped };
    });
    res.json(insert());
  });

  // ── Scrap Reasons ───────────────────────────────────────────────
  app.get('/api/scrap-reasons', (req, res) => {
    res.json(db.prepare('SELECT * FROM scrap_reasons ORDER BY reason').all());
  });

  app.post('/api/scrap-reasons', (req, res) => {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    try {
      const result = db.prepare('INSERT INTO scrap_reasons (reason) VALUES (?)').run(reason.trim());
      res.json({ id: result.lastInsertRowid });
    } catch (e) {
      res.status(409).json({ error: 'Reason already exists' });
    }
  });

  // ── Production Logs ─────────────────────────────────────────────
  app.get('/api/production', (req, res) => {
    const { date_from, date_to, employee_id, part_id, customer_id } = req.query;
    let query = `
      SELECT pl.*, e.name as employee_name, p.part_number, p.target_rate,
             c.name as customer_name, c.id as customer_id
      FROM production_logs pl
      JOIN employees e ON pl.employee_id = e.id
      JOIN parts p ON pl.part_id = p.id
      JOIN customers c ON p.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (date_from)   { query += ' AND pl.date >= ?';       params.push(date_from); }
    if (date_to)     { query += ' AND pl.date <= ?';       params.push(date_to); }
    if (employee_id) { query += ' AND pl.employee_id = ?'; params.push(employee_id); }
    if (part_id)     { query += ' AND pl.part_id = ?';     params.push(part_id); }
    if (customer_id) { query += ' AND c.id = ?';           params.push(customer_id); }
    query += ' ORDER BY pl.date DESC, pl.created_at DESC';
    const logs = db.prepare(query).all(...params);

    const scrapQuery = db.prepare(`
      SELECT sl.*, sr.reason FROM scrap_log sl
      JOIN scrap_reasons sr ON sl.scrap_reason_id = sr.id
      WHERE sl.production_log_id = ?
    `);
    logs.forEach(log => {
      log.scrap_detail = scrapQuery.all(log.id);
      log.actual_rate = (log.hours_run && log.hours_run > 0)
        ? Math.round(log.qty_produced / log.hours_run) : null;
      log.efficiency = (log.actual_rate && log.target_rate)
        ? Math.round((log.actual_rate / log.target_rate) * 100) : null;
    });
    res.json(logs);
  });

  app.post('/api/production', (req, res) => {
    const { date, shift, employee_id, part_id, qty_produced, qty_scrap, hours_run, notes, scrap_detail } = req.body;
    if (!date || !employee_id || !part_id || qty_produced == null)
      return res.status(400).json({ error: 'date, employee_id, part_id, qty_produced required' });

    const insert = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO production_logs (date, shift, employee_id, part_id, qty_produced, qty_scrap, hours_run, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, shift || 'Day', employee_id, part_id, qty_produced, qty_scrap || 0, hours_run || null, notes || null);

      const logId = result.lastInsertRowid;
      if (scrap_detail && scrap_detail.length > 0) {
        const insertScrap = db.prepare('INSERT INTO scrap_log (production_log_id, scrap_reason_id, qty) VALUES (?, ?, ?)');
        scrap_detail.forEach(({ scrap_reason_id, qty }) => {
          if (scrap_reason_id && qty > 0) insertScrap.run(logId, scrap_reason_id, qty);
        });
      }
      return logId;
    });

    res.json({ id: insert() });
  });

  app.delete('/api/production/:id', (req, res) => {
    db.prepare('DELETE FROM scrap_log WHERE production_log_id=?').run(req.params.id);
    db.prepare('DELETE FROM production_logs WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Reports ─────────────────────────────────────────────────────
  app.get('/api/reports/summary', (req, res) => {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to   = date_to   || new Date().toISOString().slice(0, 10);

    const byPart = db.prepare(`
      SELECT c.name as customer, p.part_number, p.target_rate,
             SUM(pl.qty_produced) as total_produced,
             SUM(pl.qty_scrap) as total_scrap,
             SUM(pl.hours_run) as total_hours,
             COUNT(pl.id) as run_count
      FROM production_logs pl
      JOIN parts p ON pl.part_id = p.id
      JOIN customers c ON p.customer_id = c.id
      WHERE pl.date BETWEEN ? AND ?
      GROUP BY p.id ORDER BY c.name, p.part_number
    `).all(from, to);

    byPart.forEach(row => {
      row.scrap_pct = row.total_produced > 0
        ? ((row.total_scrap / (row.total_produced + row.total_scrap)) * 100).toFixed(1) : '0.0';
      row.actual_rate = row.total_hours > 0 ? Math.round(row.total_produced / row.total_hours) : null;
      row.efficiency = (row.actual_rate && row.target_rate)
        ? Math.round((row.actual_rate / row.target_rate) * 100) : null;
    });

    const byEmployee = db.prepare(`
      SELECT e.name as employee, SUM(pl.qty_produced) as total_produced,
             SUM(pl.qty_scrap) as total_scrap, SUM(pl.hours_run) as total_hours
      FROM production_logs pl
      JOIN employees e ON pl.employee_id = e.id
      WHERE pl.date BETWEEN ? AND ?
      GROUP BY e.id ORDER BY total_produced DESC
    `).all(from, to);

    const byScrap = db.prepare(`
      SELECT sr.reason, SUM(sl.qty) as total
      FROM scrap_log sl
      JOIN scrap_reasons sr ON sl.scrap_reason_id = sr.id
      JOIN production_logs pl ON sl.production_log_id = pl.id
      WHERE pl.date BETWEEN ? AND ?
      GROUP BY sr.id ORDER BY total DESC
    `).all(from, to);

    res.json({ byPart, byEmployee, byScrap, from, to });
  });

  app.listen(PORT, () => console.log(`Production Tracker running at http://localhost:${PORT}`));
}

start();
