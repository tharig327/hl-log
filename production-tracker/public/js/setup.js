async function loadCustomers() {
  const page = document.getElementById('page-customers');
  const [customers, allParts] = await Promise.all([API.get('/api/customers'), API.get('/api/parts')]);
  page.innerHTML = `
    <h1>Customers &amp; Parts</h1>
    <div class="two-col">
      <div class="card">
        <div class="section-header"><h2>Customers</h2></div>
        <form id="add-customer-form" style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" id="new-customer-name" placeholder="Customer name" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Parts</th></tr></thead><tbody>${customers.map(c=>{const pc=allParts.filter(p=>p.customer_id===c.id).length;return`<tr><td>${c.name}</td><td><span class="badge badge-blue">${pc}</span></td></tr>`;}).join('')||'<tr><td colspan="2" style="text-align:center;color:#999;padding:24px">No customers yet</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <div class="section-header"><h2>Add Part Number</h2></div>
        <form id="add-part-form">
          <div class="form-grid">
            <div class="form-group"><label>Customer *</label><select id="part-customer" required><option value="">— Select —</option>${customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
            <div class="form-group"><label>Part Number *</label><input type="text" id="part-number" required placeholder="e.g. ABC-1234" /></div>
            <div class="form-group"><label>Description</label><input type="text" id="part-desc" placeholder="Optional" /></div>
            <div class="form-group"><label>Target Rate (pcs/hr)</label><input type="number" id="part-rate" min="0" step="1" placeholder="0" /></div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">Add Part</button>
        </form>
        <div style="margin-top:24px">
          <h2>All Parts</h2>
          <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Customer</th><th>Part #</th><th>Description</th><th>Target Rate</th></tr></thead><tbody>${allParts.map(p=>`<tr><td>${p.customer_name}</td><td><span class="badge badge-blue">${p.part_number}</span></td><td>${p.description||''}</td><td>${p.target_rate!=null?p.target_rate+' pcs/hr':'—'}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">No parts yet</td></tr>'}</tbody></table></div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('add-customer-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await API.post('/api/customers', { name: document.getElementById('new-customer-name').value.trim() }); toast('Customer added'); loadCustomers(); }
    catch (err) { toast(err.error||'Failed','error'); }
  });
  document.getElementById('add-part-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = { customer_id: parseInt(document.getElementById('part-customer').value), part_number: document.getElementById('part-number').value.trim(), description: document.getElementById('part-desc').value.trim()||null, target_rate: parseFloat(document.getElementById('part-rate').value)||null };
    try { await API.post('/api/parts', payload); toast('Part added'); loadCustomers(); }
    catch (err) { toast(err.error||'Failed','error'); }
  });
}

async function loadEmployees() {
  const page = document.getElementById('page-employees');
  const employees = await API.get('/api/employees');
  page.innerHTML = `
    <h1>Employees</h1>
    <div class="two-col">
      <div class="card"><h2>Add Employee</h2><form id="add-emp-form" style="margin-top:14px"><div class="form-grid"><div class="form-group"><label>Name *</label><input type="text" id="emp-name" required placeholder="Full name" /></div><div class="form-group"><label>Employee ID</label><input type="text" id="emp-id" placeholder="Optional badge #" /></div></div><button type="submit" class="btn btn-primary" style="margin-top:14px">Add Employee</button></form></div>
      <div class="card"><h2>Active Employees</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Name</th><th>ID</th><th>Status</th><th></th></tr></thead><tbody>${employees.map(e=>`<tr><td>${e.name}</td><td>${e.employee_id||'—'}</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-ghost btn-sm" onclick="deactivateEmp(${e.id})">Deactivate</button></td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">No employees yet</td></tr>'}</tbody></table></div></div>
    </div>
  `;
  window.deactivateEmp = async function(id) {
    if (!confirm('Deactivate this employee?')) return;
    await API.put(`/api/employees/${id}`, { active: false }); toast('Employee deactivated'); loadEmployees();
  };
  document.getElementById('add-emp-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await API.post('/api/employees', { name: document.getElementById('emp-name').value.trim(), employee_id: document.getElementById('emp-id').value.trim()||null }); toast('Employee added'); loadEmployees(); }
    catch (err) { toast(err.error||'Failed','error'); }
  });
}

async function loadSettings() {
  const page = document.getElementById('page-settings');
  const reasons = await API.get('/api/scrap-reasons');
  page.innerHTML = `
    <h1>Scrap Reasons</h1>
    <div class="two-col">
      <div class="card"><h2>Add Scrap Reason</h2><form id="add-reason-form" style="margin-top:14px;display:flex;gap:8px"><input type="text" id="new-reason" placeholder="Reason description" style="flex:1;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px" required /><button type="submit" class="btn btn-primary btn-sm">Add</button></form></div>
      <div class="card"><h2>Current Reasons</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Reason</th></tr></thead><tbody>${reasons.map(r=>`<tr><td>${r.reason}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
  `;
  document.getElementById('add-reason-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await API.post('/api/scrap-reasons', { reason: document.getElementById('new-reason').value.trim() }); toast('Reason added'); loadSettings(); }
    catch (err) { toast(err.error||'Failed','error'); }
  });
}
