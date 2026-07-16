async function loadDashboard() {
  const page = document.getElementById('page-dashboard');
  const todayStr = today();
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const [todayData, weekData, scrapData] = await Promise.all([
    API.get(`/api/reports/summary?date_from=${todayStr}&date_to=${todayStr}`),
    API.get(`/api/reports/summary?date_from=${weekAgo}&date_to=${todayStr}`),
    API.get(`/api/reports/summary?date_from=${weekAgo}&date_to=${todayStr}`)
  ]);

  const todayProduced = todayData.byPart.reduce((s, r) => s + r.total_produced, 0);
  const todayScrap    = todayData.byPart.reduce((s, r) => s + r.total_scrap, 0);
  const weekProduced  = weekData.byPart.reduce((s, r) => s + r.total_produced, 0);
  const weekScrap     = weekData.byPart.reduce((s, r) => s + r.total_scrap, 0);
  const scrapPct      = weekProduced > 0 ? ((weekScrap / (weekProduced + weekScrap)) * 100).toFixed(1) : '0.0';
  const recentLogs    = await API.get(`/api/production?date_from=${weekAgo}&date_to=${todayStr}`);

  page.innerHTML = `
    <h1>Dashboard</h1>
    <div class="cards-row">
      <div class="stat-card blue"><div class="label">Today — Parts Produced</div><div class="value">${todayProduced.toLocaleString()}</div><div class="sub">${new Date().toLocaleDateString()}</div></div>
      <div class="stat-card red"><div class="label">Today — Scrap</div><div class="value">${todayScrap.toLocaleString()}</div></div>
      <div class="stat-card green"><div class="label">7-Day Production</div><div class="value">${weekProduced.toLocaleString()}</div><div class="sub">Last 7 days</div></div>
      <div class="stat-card ${parseFloat(scrapPct) > 5 ? 'red' : 'green'}"><div class="label">7-Day Scrap Rate</div><div class="value">${scrapPct}%</div><div class="sub">${weekScrap.toLocaleString()} pcs scrapped</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="section-header"><h2>Recent Production Runs</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Part</th><th>Produced</th><th>Scrap</th><th>Eff %</th></tr></thead><tbody>
          ${recentLogs.slice(0, 10).map(l => `<tr><td>${fmtDate(l.date)}</td><td>${l.employee_name}</td><td><span class="badge badge-blue">${l.part_number}</span><br><small>${l.customer_name}</small></td><td>${l.qty_produced.toLocaleString()}</td><td>${l.qty_scrap > 0 ? `<span class="badge badge-red">${l.qty_scrap}</span>` : '0'}</td><td class="${effClass(l.efficiency)}">${l.efficiency != null ? l.efficiency + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px">No data yet</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="section-header"><h2>Top Scrap Reasons (7 days)</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Reason</th><th>Qty</th></tr></thead><tbody>
          ${scrapData.byScrap.map(s => `<tr><td>${s.reason}</td><td><span class="badge badge-red">${s.total}</span></td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:#999;padding:24px">No scrap recorded</td></tr>'}
        </tbody></table></div>
      </div>
    </div>
  `;
}
