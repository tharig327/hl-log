async function loadReports() {
  const page = document.getElementById('page-reports');
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  page.innerHTML = `
    <h1>Reports</h1>
    <div class="card" style="margin-bottom:16px">
      <div class="toolbar">
        <label>From <input type="date" id="r-from" value="${monthAgo}" /></label>
        <label>To <input type="date" id="r-to" value="${today()}" /></label>
        <button class="btn btn-primary btn-sm" id="r-run">Run Report</button>
      </div>
    </div>
    <div id="report-output"></div>
  `;

  async function runReport() {
    const from = document.getElementById('r-from').value;
    const to   = document.getElementById('r-to').value;
    const data = await API.get(`/api/reports/summary?date_from=${from}&date_to=${to}`);
    const out  = document.getElementById('report-output');
    const tp = data.byPart.reduce((s,r)=>s+r.total_produced,0);
    const ts = data.byPart.reduce((s,r)=>s+r.total_scrap,0);
    const th = data.byPart.reduce((s,r)=>s+(r.total_hours||0),0);
    const sp = tp > 0 ? ((ts/(tp+ts))*100).toFixed(1) : '0.0';
    out.innerHTML = `
      <div class="cards-row">
        <div class="stat-card blue"><div class="label">Total Produced</div><div class="value">${tp.toLocaleString()}</div></div>
        <div class="stat-card red"><div class="label">Total Scrap</div><div class="value">${ts.toLocaleString()}</div></div>
        <div class="stat-card ${parseFloat(sp)>5?'red':'green'}"><div class="label">Scrap Rate</div><div class="value">${sp}%</div></div>
        <div class="stat-card"><div class="label">Total Hours Run</div><div class="value">${th.toFixed(1)}</div></div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <h2>Production by Part Number</h2>
        <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Part #</th><th>Runs</th><th>Produced</th><th>Scrap</th><th>Scrap %</th><th>Hours</th><th>Actual Rate</th><th>Target Rate</th><th>Efficiency</th></tr></thead><tbody>
          ${data.byPart.map(r=>`<tr><td>${r.customer}</td><td><span class="badge badge-blue">${r.part_number}</span></td><td>${r.run_count}</td><td>${r.total_produced.toLocaleString()}</td><td>${r.total_scrap>0?`<span class="badge badge-red">${r.total_scrap}</span>`:'0'}</td><td>${parseFloat(r.scrap_pct)>5?`<span class="badge badge-red">${r.scrap_pct}%</span>`:r.scrap_pct+'%'}</td><td>${r.total_hours?r.total_hours.toFixed(1):'—'}</td><td>${r.actual_rate!=null?r.actual_rate+' pcs/hr':'—'}</td><td>${r.target_rate!=null?r.target_rate+' pcs/hr':'—'}</td><td class="${effClass(r.efficiency)}">${r.efficiency!=null?r.efficiency+'%':'—'}</td></tr>`).join('')||'<tr><td colspan="10" style="text-align:center;color:#999;padding:24px">No data</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="two-col">
        <div class="card"><h2>Production by Employee</h2><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Produced</th><th>Scrap</th><th>Hours</th></tr></thead><tbody>${data.byEmployee.map(e=>`<tr><td>${e.employee}</td><td>${e.total_produced.toLocaleString()}</td><td>${e.total_scrap>0?`<span class="badge badge-red">${e.total_scrap}</span>`:'0'}</td><td>${e.total_hours?e.total_hours.toFixed(1):'—'}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">No data</td></tr>'}</tbody></table></div></div>
        <div class="card"><h2>Scrap by Reason</h2><div class="table-wrap"><table><thead><tr><th>Reason</th><th>Qty</th></tr></thead><tbody>${data.byScrap.map(s=>`<tr><td>${s.reason}</td><td><span class="badge badge-red">${s.total}</span></td></tr>`).join('')||'<tr><td colspan="2" style="text-align:center;color:#999;padding:24px">No scrap data</td></tr>'}</tbody></table></div></div>
      </div>
    `;
  }

  document.getElementById('r-run').addEventListener('click', runReport);
  runReport();
}
