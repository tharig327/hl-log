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
        <button class="btn btn-sm" id="r-export-prod" style="display:none">&#8615; Export Production CSV</button>
        <button class="btn btn-sm" id="r-export-scrap" style="display:none">&#8615; Export Scrap CSV</button>
      </div>
    </div>
    <div id="report-output"></div>
  `;

  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(v => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let lastData = null;

  async function runReport() {
    const from = document.getElementById('r-from').value;
    const to   = document.getElementById('r-to').value;
    const data = await API.get(`/api/reports/summary?date_from=${from}&date_to=${to}`);
    lastData = data;
    document.getElementById('r-export-prod').style.display = '';
    document.getElementById('r-export-scrap').style.display = '';
    const out  = document.getElementById('report-output');

    const totalProduced = data.byPart.reduce((s, r) => s + r.total_produced, 0);
    const totalScrap    = data.byPart.reduce((s, r) => s + r.total_scrap, 0);
    const totalHours    = data.byPart.reduce((s, r) => s + (r.total_hours || 0), 0);
    const overallScrapPct = totalProduced > 0
      ? ((totalScrap / (totalProduced + totalScrap)) * 100).toFixed(1) : '0.0';

    out.innerHTML = `
      <div class="cards-row">
        <div class="stat-card blue"><div class="label">Total Produced</div><div class="value">${totalProduced.toLocaleString()}</div></div>
        <div class="stat-card red"><div class="label">Total Scrap</div><div class="value">${totalScrap.toLocaleString()}</div></div>
        <div class="stat-card ${parseFloat(overallScrapPct) > 5 ? 'red' : 'green'}">
          <div class="label">Scrap Rate</div><div class="value">${overallScrapPct}%</div>
        </div>
        <div class="stat-card"><div class="label">Total Hours Run</div><div class="value">${totalHours.toFixed(1)}</div></div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h2>Production by Part Number</h2>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Customer</th><th>Part #</th><th>Runs</th><th>Produced</th>
              <th>Scrap</th><th>Scrap %</th><th>Hours</th>
              <th>Actual Rate</th><th>Target Rate</th><th>Efficiency</th>
            </tr></thead>
            <tbody>
              ${data.byPart.map(r => `
                <tr>
                  <td>${r.customer}</td>
                  <td><span class="badge badge-blue">${r.part_number}</span></td>
                  <td>${r.run_count}</td>
                  <td>${r.total_produced.toLocaleString()}</td>
                  <td>${r.total_scrap > 0 ? `<span class="badge badge-red">${r.total_scrap}</span>` : '0'}</td>
                  <td>${parseFloat(r.scrap_pct) > 5
                        ? `<span class="badge badge-red">${r.scrap_pct}%</span>`
                        : r.scrap_pct + '%'}</td>
                  <td>${r.total_hours ? r.total_hours.toFixed(1) : '—'}</td>
                  <td>${r.actual_rate != null ? r.actual_rate + ' pcs/hr' : '—'}</td>
                  <td>${r.target_rate != null ? r.target_rate + ' pcs/hr' : '—'}</td>
                  <td class="${effClass(r.efficiency)}">${r.efficiency != null ? r.efficiency + '%' : '—'}</td>
                </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px">No data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <h2>Production by Employee</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Produced</th><th>Scrap</th><th>Hours</th></tr></thead>
              <tbody>
                ${data.byEmployee.map(e => `
                  <tr>
                    <td>${e.employee}</td>
                    <td>${e.total_produced.toLocaleString()}</td>
                    <td>${e.total_scrap > 0 ? `<span class="badge badge-red">${e.total_scrap}</span>` : '0'}</td>
                    <td>${e.total_hours ? e.total_hours.toFixed(1) : '—'}</td>
                  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;padding:24px">No data</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>Scrap by Reason</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Reason</th><th>Qty</th></tr></thead>
              <tbody>
                ${data.byScrap.map(s => `
                  <tr>
                    <td>${s.reason}</td>
                    <td><span class="badge badge-red">${s.total}</span></td>
                  </tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:#999;padding:24px">No scrap data</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  document.getElementById('r-run').addEventListener('click', runReport);

  document.getElementById('r-export-prod').addEventListener('click', () => {
    if (!lastData) return;
    const from = document.getElementById('r-from').value;
    const to   = document.getElementById('r-to').value;
    const rows = [
      ['Production Report', `${from} to ${to}`],
      [],
      ['Customer', 'Part #', 'Runs', 'Produced', 'Scrap', 'Scrap %', 'Hours', 'Actual Rate (pcs/hr)', 'Target Rate (pcs/hr)', 'Efficiency %'],
      ...lastData.byPart.map(r => [
        r.customer, r.part_number, r.run_count, r.total_produced, r.total_scrap,
        r.scrap_pct, r.total_hours ? r.total_hours.toFixed(1) : '',
        r.actual_rate ?? '', r.target_rate ?? '', r.efficiency ?? ''
      ]),
      [],
      ['By Employee'],
      ['Employee', 'Produced', 'Scrap', 'Hours'],
      ...lastData.byEmployee.map(e => [
        e.employee, e.total_produced, e.total_scrap,
        e.total_hours ? e.total_hours.toFixed(1) : ''
      ])
    ];
    downloadCsv(`production-report-${from}-${to}.csv`, rows);
  });

  document.getElementById('r-export-scrap').addEventListener('click', () => {
    if (!lastData) return;
    const from = document.getElementById('r-from').value;
    const to   = document.getElementById('r-to').value;
    const rows = [
      ['Scrap Report', `${from} to ${to}`],
      [],
      ['Reason', 'Total Qty'],
      ...lastData.byScrap.map(s => [s.reason, s.total]),
      [],
      ['Scrap Detail by Part'],
      ['Customer', 'Part #', 'Total Produced', 'Total Scrap', 'Scrap %'],
      ...lastData.byPart.filter(r => r.total_scrap > 0).map(r => [
        r.customer, r.part_number, r.total_produced, r.total_scrap, r.scrap_pct
      ])
    ];
    downloadCsv(`scrap-report-${from}-${to}.csv`, rows);
  });

  runReport();
}
