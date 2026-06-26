// ── Customers & Parts ──────────────────────────────────────────
async function loadCustomers() {
  const page = document.getElementById('page-customers');
  const [customers, allParts] = await Promise.all([
    API.get('/api/customers'),
    API.get('/api/parts')
  ]);

  page.innerHTML = `
    <h1>Customers & Parts</h1>
    <div class="two-col">
      <div class="card">
        <div class="section-header">
          <h2>Customers</h2>
        </div>
        <form id="add-customer-form" style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="new-customer-name" placeholder="Customer name" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Parts</th><th></th></tr></thead>
            <tbody>
              ${customers.map(c => {
                const partCount = allParts.filter(p => p.customer_id === c.id).length;
                return `<tr>
                  <td>${c.name}</td>
                  <td><span class="badge badge-blue">${partCount}</span></td>
                  <td><button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')" >Delete</button></td>
                </tr>`;
              }).join('') || '<tr><td colspan="3" style="text-align:center;color:#999;padding:24px">No customers yet</td></tr>'}
            </tbody>
          </table>
        </div>

        <details style="margin-top:20px">
          <summary style="cursor:pointer;font-weight:600;color:#4a5568;padding:8px 0">Bulk Import Customers</summary>
          <div style="margin-top:12px">
            <p style="font-size:13px;color:#718096;margin-bottom:8px">One customer name per line.</p>
            <textarea id="bulk-customers" rows="6" style="width:100%;padding:8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace" placeholder="Acme Corp&#10;Beta Industries&#10;Gamma LLC"></textarea>
            <button id="bulk-customers-btn" class="btn btn-primary btn-sm" style="margin-top:8px">Import Customers</button>
          </div>
        </details>
      </div>

      <div class="card">
        <div class="section-header"><h2>Add Part Number</h2></div>
        <form id="add-part-form">
          <div class="form-grid">
            <div class="form-group">
              <label>Customer *</label>
              <select id="part-customer" required>
                <option value="">— Select —</option>
                ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Part Number *</label>
              <input type="text" id="part-number" required placeholder="e.g. ABC-1234" />
            </div>
            <div class="form-group">
              <label>Description</label>
              <input type="text" id="part-desc" placeholder="Optional" />
            </div>
            <div class="form-group">
              <label>Target Rate (pcs/hr)</label>
              <input type="number" id="part-rate" min="0" step="1" placeholder="0" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">Add Part</button>
        </form>

        <details style="margin-top:20px">
          <summary style="cursor:pointer;font-weight:600;color:#4a5568;padding:8px 0">Bulk Import Parts</summary>
          <div style="margin-top:12px">
            <p style="font-size:13px;color:#718096;margin-bottom:8px">Format: <code>CustomerName, PartNumber, Description, TargetRate</code><br>Description and TargetRate are optional. New customers are created automatically.</p>
            <textarea id="bulk-parts" rows="6" style="width:100%;padding:8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace" placeholder="Acme Corp, ABC-1234, Widget A, 150&#10;New Customer, XYZ-001, Bracket, 200"></textarea>
            <button id="bulk-parts-btn" class="btn btn-primary btn-sm" style="margin-top:8px">Import Parts</button>
          </div>
        </details>

        <div style="margin-top:24px">
          <h2>All Parts</h2>
          <div class="table-wrap" style="margin-top:12px">
            <table id="parts-table">
              <thead><tr><th>Customer</th><th>Part #</th><th>Description</th><th>Target Rate</th><th></th></tr></thead>
              <tbody>
                ${allParts.map(p => `<tr>
                  <td>${p.customer_name}</td>
                  <td><span class="badge badge-blue">${p.part_number}</span></td>
                  <td>${p.description || ''}</td>
                  <td>${p.target_rate != null ? p.target_rate + ' pcs/hr' : '—'}</td>
                  <td><button class="btn btn-danger btn-sm" onclick="deletePart(${p.id}, '${p.part_number.replace(/'/g, "\\'")}')" >Delete</button></td>
                </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:24px">No parts yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  window.deleteCustomer = async function(id, name) {
    if (!confirm(`Delete "${name}" and ALL its parts and production history?`)) return;
    try { await API.del(`/api/customers/${id}`); toast('Customer deleted'); loadCustomers(); }
    catch (e) { toast('Delete failed', 'error'); }
  };

  window.deletePart = async function(id, partNum) {
    if (!confirm(`Delete part "${partNum}" and its production history?`)) return;
    try { await API.del(`/api/parts/${id}`); toast('Part deleted'); loadCustomers(); }
    catch (e) { toast('Delete failed', 'error'); }
  };

  document.getElementById('add-customer-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('new-customer-name').value.trim();
    try {
      await API.post('/api/customers', { name });
      toast('Customer added');
      loadCustomers();
    } catch (err) { toast(err.error || 'Failed', 'error'); }
  });

  document.getElementById('add-part-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      customer_id: parseInt(document.getElementById('part-customer').value),
      part_number: document.getElementById('part-number').value.trim(),
      description: document.getElementById('part-desc').value.trim() || null,
      target_rate: parseFloat(document.getElementById('part-rate').value) || null
    };
    try {
      await API.post('/api/parts', payload);
      toast('Part added');
      loadCustomers();
    } catch (err) { toast(err.error || 'Failed', 'error'); }
  });

  document.getElementById('bulk-customers-btn').addEventListener('click', async () => {
    const names = document.getElementById('bulk-customers').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return toast('Nothing to import', 'error');
    try {
      const result = await API.post('/api/customers/bulk', { names });
      toast(`Imported ${result.added} customers${result.skipped ? `, skipped ${result.skipped} duplicates` : ''}`);
      loadCustomers();
    } catch (err) { toast(err.error || 'Import failed', 'error'); }
  });

  document.getElementById('bulk-parts-btn').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-parts').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return toast('Nothing to import', 'error');

    // Build customer map, auto-create any missing customers
    const customerMap = {};
    customers.forEach(c => { customerMap[c.name.toLowerCase()] = c.id; });

    const newCustomerNames = [...new Set(
      lines.map(l => l.split(',')[0]?.trim()).filter(n => n && !customerMap[n.toLowerCase()])
    )];
    for (const name of newCustomerNames) {
      try {
        const result = await API.post('/api/customers', { name });
        customerMap[name.toLowerCase()] = result.id;
      } catch {}
    }

    const parts = lines.map(line => {
      const [cName, partNum, desc, rate] = line.split(',').map(s => s.trim());
      const customer_id = customerMap[cName?.toLowerCase()];
      if (!customer_id || !partNum) return null;
      return { customer_id, part_number: partNum, description: desc || null, target_rate: rate ? parseFloat(rate) : null };
    }).filter(Boolean);

    if (!parts.length) return toast('No valid rows to import', 'error');
    try {
      const result = await API.post('/api/parts/bulk', { parts });
      const newCustMsg = newCustomerNames.length ? `, created ${newCustomerNames.length} new customer(s)` : '';
      toast(`Imported ${result.added} parts${result.skipped ? `, skipped ${result.skipped} duplicates` : ''}${newCustMsg}`);
      loadCustomers();
    } catch (err) { toast(err.error || 'Import failed', 'error'); }
  });
}

// ── Employees ──────────────────────────────────────────────────
async function loadEmployees(showInactive = false) {
  const page = document.getElementById('page-employees');
  const employees = await API.get('/api/employees' + (showInactive ? '?include_inactive=1' : ''));

  page.innerHTML = `
    <h1>Employees</h1>
    <div class="two-col">
      <div class="card">
        <h2>Add Employee</h2>
        <form id="add-emp-form" style="margin-top:14px">
          <div class="form-grid">
            <div class="form-group">
              <label>Name *</label>
              <input type="text" id="emp-name" required placeholder="Full name" />
            </div>
            <div class="form-group">
              <label>Employee ID</label>
              <input type="text" id="emp-id" placeholder="Optional badge #" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">Add Employee</button>
        </form>

        <details style="margin-top:20px">
          <summary style="cursor:pointer;font-weight:600;color:#4a5568;padding:8px 0">Bulk Import Employees</summary>
          <div style="margin-top:12px">
            <p style="font-size:13px;color:#718096;margin-bottom:8px">One name per line. Optionally add a badge # after a comma.</p>
            <textarea id="bulk-employees" rows="6" style="width:100%;padding:8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace" placeholder="John Smith&#10;Jane Doe, 1042&#10;Bob Johnson, 2031"></textarea>
            <button id="bulk-employees-btn" class="btn btn-primary btn-sm" style="margin-top:8px">Import Employees</button>
          </div>
        </details>
      </div>

      <div class="card">
        <div class="section-header">
          <h2>${showInactive ? 'All Employees' : 'Active Employees'}</h2>
          <button class="btn btn-ghost btn-sm" id="toggle-inactive">
            ${showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </button>
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Name</th><th>ID</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${employees.map(e => `<tr>
                <td>${e.name}</td>
                <td>${e.employee_id || '—'}</td>
                <td><span class="badge ${e.active ? 'badge-green' : 'badge-red'}">${e.active ? 'Active' : 'Inactive'}</span></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                  ${e.active
                    ? `<button class="btn btn-ghost btn-sm" onclick="deactivateEmp(${e.id})">Deactivate</button>`
                    : `<button class="btn btn-ghost btn-sm" onclick="reactivateEmp(${e.id})">Reactivate</button>`
                  }
                  <button class="btn btn-danger btn-sm" onclick="deleteEmp(${e.id}, '${e.name.replace(/'/g, "\\'")}')" >Delete</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">No employees yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('toggle-inactive').addEventListener('click', () => loadEmployees(!showInactive));

  window.deactivateEmp = async function(id) {
    if (!confirm('Deactivate this employee?')) return;
    await API.put(`/api/employees/${id}`, { active: false });
    toast('Employee deactivated');
    loadEmployees(showInactive);
  };

  window.reactivateEmp = async function(id) {
    await API.put(`/api/employees/${id}`, { active: true });
    toast('Employee reactivated');
    loadEmployees(showInactive);
  };

  window.deleteEmp = async function(id, name) {
    if (!confirm(`Permanently delete "${name}"? Their production history will be kept.`)) return;
    try {
      await API.del(`/api/employees/${id}`);
      toast('Employee deleted');
      loadEmployees(showInactive);
    } catch (err) { toast('Delete failed', 'error'); }
  };

  document.getElementById('add-emp-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await API.post('/api/employees', {
        name: document.getElementById('emp-name').value.trim(),
        employee_id: document.getElementById('emp-id').value.trim() || null
      });
      toast('Employee added');
      loadEmployees(showInactive);
    } catch (err) { toast(err.error || 'Failed', 'error'); }
  });

  document.getElementById('bulk-employees-btn').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-employees').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return toast('Nothing to import', 'error');

    const employees = lines.map(line => {
      const [name, employee_id] = line.split(',').map(s => s.trim());
      return { name, employee_id: employee_id || null };
    });

    try {
      const result = await API.post('/api/employees/bulk', { employees });
      toast(`Imported ${result.added} employees${result.skipped ? `, skipped ${result.skipped} duplicates` : ''}`);
      loadEmployees(showInactive);
    } catch (err) { toast(err.error || 'Import failed', 'error'); }
  });
}

// ── Scrap Reasons ──────────────────────────────────────────────
async function loadSettings() {
  const page = document.getElementById('page-settings');
  const reasons = await API.get('/api/scrap-reasons');

  page.innerHTML = `
    <h1>Scrap Reasons</h1>
    <div class="two-col">
      <div class="card">
        <h2>Add Scrap Reason</h2>
        <form id="add-reason-form" style="margin-top:14px;display:flex;gap:8px">
          <input type="text" id="new-reason" placeholder="Reason description" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      </div>
      <div class="card">
        <h2>Current Reasons</h2>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Reason</th></tr></thead>
            <tbody>
              ${reasons.map(r => `<tr><td>${r.reason}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('add-reason-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await API.post('/api/scrap-reasons', { reason: document.getElementById('new-reason').value.trim() });
      toast('Reason added');
      loadSettings();
    } catch (err) { toast(err.error || 'Failed', 'error'); }
  });
}
