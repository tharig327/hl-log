// ── Customers & Parts ──────────────────────────────────────────
async function loadCustomers() {
  const page = document.getElementById('page-customers');
  const [customers, allParts] = await Promise.all([API.get('/api/customers'), API.get('/api/parts')]);

  page.innerHTML = `
    <h1>Customers &amp; Parts</h1>

    <div class="card" style="margin-bottom:20px;border-left:4px solid var(--blue)">
      <h2 style="margin-bottom:16px">Bulk Import</h2>
      <div class="two-col">
        <div>
          <h2 style="font-size:14px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">Customers &mdash; one per line</h2>
          <textarea id="bulk-customers" placeholder="Acme Corp&#10;Wayne Industries&#10;Stark Manufacturing" style="width:100%;height:110px;margin-top:8px;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace;resize:vertical"></textarea>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" id="bulk-customers-btn">Import Customers</button>
          <div id="bulk-customers-result" style="margin-top:6px;font-size:13px"></div>
        </div>
        <div>
          <h2 style="font-size:14px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">Parts &mdash; Customer, Part#, Description, Rate (pcs/hr)</h2>
          <textarea id="bulk-parts" placeholder="Acme Corp, ABC-1234, Bracket, 120&#10;Acme Corp, ABC-5678, Housing&#10;Wayne Industries, WI-001, Shaft, 85" style="width:100%;height:110px;margin-top:8px;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace;resize:vertical"></textarea>
          <div style="font-size:11px;color:var(--gray);margin-top:4px">Customer, Part Number, Description (optional), Target Rate (optional). Customer is auto-created if needed.</div>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" id="bulk-parts-btn">Import Parts</button>
          <div id="bulk-parts-result" style="margin-top:6px;font-size:13px"></div>
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-header"><h2>Customers</h2></div>
        <form id="add-customer-form" style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="new-customer-name" placeholder="Customer name" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Parts</th><th></th></tr></thead>
            <tbody>
              ${customers.map(c => {
                const pc = allParts.filter(p => p.customer_id === c.id).length;
                return `<tr>
                  <td>${c.name}</td>
                  <td><span class="badge badge-blue">${pc}</span></td>
                  <td><button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Delete</button></td>
                </tr>`;
              }).join('') || '<tr><td colspan="3" style="text-align:center;color:#999;padding:24px">No customers yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-header"><h2>Add Part</h2></div>
        <form id="add-part-form">
          <div class="form-grid">
            <div class="form-group"><label>Customer *</label>
              <select id="part-customer" required>
                <option value="">— Select —</option>
                ${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Part Number *</label><input type="text" id="part-number" required placeholder="e.g. ABC-1234" /></div>
            <div class="form-group"><label>Description</label><input type="text" id="part-desc" placeholder="Optional" /></div>
            <div class="form-group"><label>Target Rate (pcs/hr)</label><input type="number" id="part-rate" min="0" step="1" placeholder="0" /></div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">Add Part</button>
        </form>

        <div style="margin-top:24px">
          <h2>All Parts</h2>
          <div class="table-wrap" style="margin-top:12px">
            <table>
              <thead><tr><th>Customer</th><th>Part #</th><th>Description</th><th>Target Rate</th><th></th></tr></thead>
              <tbody>
                ${allParts.map(p => `<tr>
                  <td>${p.customer_name}</td>
                  <td><span class="badge badge-blue">${p.part_number}</span></td>
                  <td>${p.description || ''}</td>
                  <td>${p.target_rate != null ? p.target_rate + ' pcs/hr' : '—'}</td>
                  <td><button class="btn btn-danger btn-sm" onclick="deletePart(${p.id}, '${p.part_number.replace(/'/g, "\\'")}')">Delete</button></td>
                </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:24px">No parts yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bulk customers
  document.getElementById('bulk-customers-btn').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-customers').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    try {
      const res = await API.post('/api/customers/bulk', { names: lines });
      document.getElementById('bulk-customers-result').innerHTML = `<span style="color:var(--green)">&#10003; ${res.added} customer(s) imported</span>`;
      document.getElementById('bulk-customers').value = '';
      toast('Customers imported!'); loadCustomers();
    } catch (e) { document.getElementById('bulk-customers-result').innerHTML = `<span style="color:var(--red)">Error: ${e.error || 'failed'}</span>`; }
  });

  // Bulk parts
  document.getElementById('bulk-parts-btn').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-parts').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const rows = lines.map(line => {
      const cols = line.split(',').map(c => c.trim());
      return { customer_name: cols[0] || '', part_number: cols[1] || '', description: cols[2] || null, target_rate: cols[3] || null };
    });
    try {
      const res = await API.post('/api/parts/bulk', { rows });
      let msg = `&#10003; ${res.added} part(s) added`;
      if (res.skipped) msg += `, ${res.skipped} skipped`;
      document.getElementById('bulk-parts-result').innerHTML = `<span style="color:var(--green)">${msg}</span>`;
      document.getElementById('bulk-parts').value = '';
      toast('Parts imported!'); loadCustomers();
    } catch (e) { document.getElementById('bulk-parts-result').innerHTML = `<span style="color:var(--red)">Error: ${e.error || 'failed'}</span>`; }
  });

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
    try { await API.post('/api/customers', { name: document.getElementById('new-customer-name').value.trim() }); toast('Customer added'); loadCustomers(); }
    catch (err) { toast(err.error || 'Failed', 'error'); }
  });

  document.getElementById('add-part-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      customer_id: parseInt(document.getElementById('part-customer').value),
      part_number: document.getElementById('part-number').value.trim(),
      description: document.getElementById('part-desc').value.trim() || null,
      target_rate: parseFloat(document.getElementById('part-rate').value) || null
    };
    try { await API.post('/api/parts', payload); toast('Part added'); loadCustomers(); }
    catch (err) { toast(err.error || 'Failed', 'error'); }
  });
}

// ── Employees ──────────────────────────────────────────────────
async function loadEmployees() {
  const page = document.getElementById('page-employees');
  const employees = await API.get('/api/employees');

  page.innerHTML = `
    <h1>Employees</h1>
    <div class="card" style="margin-bottom:20px;border-left:4px solid var(--blue)">
      <h2 style="margin-bottom:12px">Bulk Import</h2>
      <h2 style="font-size:14px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">One per line &mdash; Name or Name, EmployeeID</h2>
      <textarea id="bulk-employees" placeholder="John Smith&#10;Jane Doe, EMP-001&#10;Bob Johnson, 1042" style="width:100%;max-width:500px;height:120px;margin-top:8px;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;font-family:monospace;resize:vertical"></textarea>
      <br/>
      <button class="btn btn-primary btn-sm" style="margin-top:8px" id="bulk-employees-btn">Import Employees</button>
      <span id="bulk-employees-result" style="margin-left:12px;font-size:13px"></span>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>Add Single Employee</h2>
        <form id="add-emp-form" style="margin-top:14px">
          <div class="form-grid">
            <div class="form-group"><label>Name *</label><input type="text" id="emp-name" required placeholder="Full name" /></div>
            <div class="form-group"><label>Employee ID</label><input type="text" id="emp-id" placeholder="Optional badge #" /></div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">Add Employee</button>
        </form>
      </div>
      <div class="card">
        <h2>Active Employees</h2>
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Name</th><th>ID</th><th></th></tr></thead>
            <tbody>
              ${employees.map(e => `<tr>
                <td>${e.name}</td>
                <td>${e.employee_id || '—'}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn btn-ghost btn-sm" onclick="deactivateEmp(${e.id})">Deactivate</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteEmp(${e.id}, '${e.name.replace(/'/g, "\\'")}')">Delete</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:#999;padding:24px">No employees yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('bulk-employees-btn').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-employees').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const rows = lines.map(line => {
      const parts = line.split(',').map(p => p.trim());
      return { name: parts[0] || '', employee_id: parts[1] || null };
    });
    try {
      const res = await API.post('/api/employees/bulk', { rows });
      document.getElementById('bulk-employees-result').innerHTML = `<span style="color:var(--green)">&#10003; ${res.added} employee(s) imported</span>`;
      document.getElementById('bulk-employees').value = '';
      toast('Employees imported!'); loadEmployees();
    } catch (e) { document.getElementById('bulk-employees-result').innerHTML = `<span style="color:var(--red)">Error: ${e.error || 'failed'}</span>`; }
  });

  window.deactivateEmp = async function(id) {
    if (!confirm('Deactivate this employee?')) return;
    await API.put(`/api/employees/${id}`, { active: false });
    toast('Employee deactivated'); loadEmployees();
  };

  window.deleteEmp = async function(id, name) {
    if (!confirm(`Permanently delete "${name}"?`)) return;
    try { await API.del(`/api/employees/${id}`); toast('Employee deleted'); loadEmployees(); }
    catch (e) { toast('Delete failed', 'error'); }
  };

  document.getElementById('add-emp-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await API.post('/api/employees', { name: document.getElementById('emp-name').value.trim(), employee_id: document.getElementById('emp-id').value.trim() || null });
      toast('Employee added'); loadEmployees();
    } catch (err) { toast(err.error || 'Failed', 'error'); }
  });
}

// ── Scrap Reasons ──────────────────────────────────────────────
async function loadSettings() {
  const page = document.getElementById('page-settings');
  const reasons = await API.get('/api/scrap-reasons');
  page.innerHTML = `
    <h1>Scrap Reasons</h1>
    <div class="two-col">
      <div class="card"><h2>Add Scrap Reason</h2><form id="add-reason-form" style="margin-top:14px;display:flex;gap:8px"><input type="text" id="new-reason" placeholder="Reason description" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required /><button type="submit" class="btn btn-primary btn-sm">Add</button></form></div>
      <div class="card"><h2>Current Reasons</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Reason</th></tr></thead><tbody>${reasons.map(r => `<tr><td>${r.reason}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
  `;
  document.getElementById('add-reason-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await API.post('/api/scrap-reasons', { reason: document.getElementById('new-reason').value.trim() }); toast('Reason added'); loadSettings(); }
    catch (err) { toast(err.error || 'Failed', 'error'); }
  });
}
