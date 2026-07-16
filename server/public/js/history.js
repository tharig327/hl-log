async function loadHistory() {
  const page = document.getElementById('page-history');
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [customers, employees] = await Promise.all([API.get('/api/customers'), API.get('/api/employees')]);

  page.innerHTML = `
    <h1>Production History</h1>
    <div class="card" style="margin-bottom:16px">
      <div class="toolbar">
        <label>From <input type="date" id="h-from" value="${weekAgo}" /></label>
        <label>To <input type="date" id="h-to" value="${today()}" /></label>
        <select id="h-customer"><option value="">All Customers</option>${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <select id="h-employee"><option value="">All Employees</option>${employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="h-search">Search</button>
      </div>
    </div>
    <div class="card"><div id="history-table">Loading...</div></div>
  `;

  async function loadTable() {
    const from = document.getElementById('h-from').value;
    const to   = document.getElementById('h-to').value;
    const cust = document.getElementById('h-customer').value;
    const emp  = document.getElementById('h-employee').value;
    let url = `/api/production?date_from=${from}&date_to=${to}`;
    if (cust) url += `&customer_id=${cust}`;
    if (emp)  url += `&employee_id=${emp}`;
    const logs = await API.get(url);
    const container = document.getElementById('history-table');
    if (!logs.length) { container.innerHTML = '<p style="text-align:center;padding:24px;color:#999">No records found</p>'; return; }
    container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Shift</th><th>Employee</th><th>Customer</th><th>Part #</th><th>Produced</th><th>Scrap</th><th>Scrap %</th><th>Hours</th><th>Actual Rate</th><th>Target Rate</th><th>Eff %</th><th>Notes</th><th></th></tr></thead><tbody>${logs.map(l => { const total = l.qty_produced + l.qty_scrap; const sp = total > 0 ? ((l.qty_scrap/total)*100).toFixed(1) : '0.0'; return `<tr><td>${fmtDate(l.date)}</td><td><span class="badge badge-gray">${l.shift}</span></td><td>${l.employee_name}</td><td>${l.customer_name}</td><td><span class="badge badge-blue">${l.part_number}</span></td><td>${l.qty_produced.toLocaleString()}</td><td>${l.qty_scrap>0?`<span class="badge badge-red">${l.qty_scrap}</span>`:'0'}</td><td>${parseFloat(sp)>5?`<span class="badge badge-red">${sp}%</span>`:sp+'%'}</td><td>${l.hours_run!=null?l.hours_run:'—'}</td><td>${l.actual_rate!=null?l.actual_rate+' pcs/hr':'—'}</td><td>${l.target_rate!=null?l.target_rate+' pcs/hr':'—'}</td><td class="${effClass(l.efficiency)}">${l.efficiency!=null?l.efficiency+'%':'—'}</td><td style="max-width:180px;white-space:normal;font-size:12px;color:#666">${l.notes||''}</td><td><button class="btn btn-danger btn-sm" onclick="deleteLog(${l.id})">Delete</button></td></tr>${l.scrap_detail&&l.scrap_detail.length>0?`<tr style="background:#fff8f8"><td colspan="14" style="padding:4px 12px 8px;font-size:12px;color:#721c24"><strong>Scrap detail:</strong> ${l.scrap_detail.map(s=>`${s.reason}: ${s.qty}`).join(' | ')}</td></tr>`:''}`; }).join('')}</tbody></table></div>`;
  }

  window.deleteLog = async function(id) {
    if (!confirm('Delete this production log?')) return;
    try { await API.del(`/api/production/${id}`); toast('Log deleted'); loadTable(); } catch (e) { toast('Delete failed', 'error'); }
  };

  document.getElementById('h-search').addEventListener('click', loadTable);
  loadTable();
}
