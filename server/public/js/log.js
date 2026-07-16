async function loadLog() {
  const page = document.getElementById('page-log');
  const [customers, employees, scrapReasons] = await Promise.all([
    API.get('/api/customers'), API.get('/api/employees'), API.get('/api/scrap-reasons')
  ]);

  page.innerHTML = `
    <h1>Log Production Run</h1>
    <div class="card">
      <form id="log-form">
        <div class="form-grid">
          <div class="form-group"><label>Date *</label><input type="date" id="log-date" value="${today()}" required /></div>
          <div class="form-group"><label>Shift</label><select id="log-shift"><option>Day</option><option>Afternoon</option><option>Night</option></select></div>
          <div class="form-group"><label>Employee *</label><select id="log-employee" required><option value="">— Select Employee —</option>${employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select></div>
          <div class="form-group"><label>Customer *</label><select id="log-customer" required><option value="">— Select Customer —</option>${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
          <div class="form-group"><label>Part Number *</label><select id="log-part" required><option value="">— Select Customer First —</option></select></div>
          <div id="log-rate-display" class="form-group" style="display:none"><label>Target Rate</label><div style="padding:8px 10px;background:#f7fafc;border-radius:6px;font-size:14px" id="log-rate-text">—</div></div>
          <div class="form-group"><label>Parts Produced *</label><input type="number" id="log-qty" min="0" required placeholder="0" /></div>
          <div class="form-group"><label>Hours Run</label><input type="number" id="log-hours" min="0" step="0.25" placeholder="e.g. 8" /></div>
          <div id="log-actual-rate" class="form-group" style="display:none"><label>Actual Rate</label><div style="padding:8px 10px;background:#f7fafc;border-radius:6px;font-size:14px" id="log-actual-text">—</div></div>
        </div>
        <div style="margin-top:20px">
          <div class="section-header"><h2>Scrap</h2><button type="button" class="btn btn-ghost btn-sm" id="add-scrap-row">+ Add Scrap</button></div>
          <div class="form-group" style="max-width:160px;margin-bottom:14px"><label>Total Scrap Qty</label><input type="number" id="log-scrap-total" min="0" value="0" /></div>
          <div class="scrap-rows" id="scrap-rows"></div>
        </div>
        <div class="form-group" style="margin-top:16px;max-width:100%"><label>Notes</label><textarea id="log-notes" placeholder="Optional notes..."></textarea></div>
        <div style="margin-top:20px;display:flex;gap:10px">
          <button type="submit" class="btn btn-success">Save Production Log</button>
          <button type="button" class="btn btn-ghost" id="log-reset">Reset</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('log-customer').addEventListener('change', async function () {
    const cid = this.value;
    const partSel = document.getElementById('log-part');
    if (!cid) { partSel.innerHTML = '<option value="">— Select Customer First —</option>'; return; }
    const parts = await API.get(`/api/parts?customer_id=${cid}`);
    partSel.innerHTML = '<option value="">— Select Part —</option>' + parts.map(p => `<option value="${p.id}" data-rate="${p.target_rate || ''}">${p.part_number}${p.description ? ' — ' + p.description : ''}</option>`).join('');
    document.getElementById('log-rate-display').style.display = 'none';
    document.getElementById('log-actual-rate').style.display = 'none';
  });

  document.getElementById('log-part').addEventListener('change', function () {
    const opt = this.options[this.selectedIndex];
    const rate = opt?.dataset?.rate;
    if (rate) { document.getElementById('log-rate-display').style.display = ''; document.getElementById('log-rate-text').textContent = rate + ' pcs/hr'; }
    else { document.getElementById('log-rate-display').style.display = 'none'; }
    updateActualRate();
  });

  function updateActualRate() {
    const qty = parseFloat(document.getElementById('log-qty').value) || 0;
    const hrs = parseFloat(document.getElementById('log-hours').value) || 0;
    if (qty > 0 && hrs > 0) {
      const actual = Math.round(qty / hrs);
      const opt = document.getElementById('log-part').options[document.getElementById('log-part').selectedIndex];
      const target = parseFloat(opt?.dataset?.rate) || 0;
      let html = `${actual} pcs/hr`;
      if (target > 0) { const eff = Math.round((actual / target) * 100); html += ` <span class="${effClass(eff)}">(${eff}%)</span>`; }
      document.getElementById('log-actual-text').innerHTML = html;
      document.getElementById('log-actual-rate').style.display = '';
    } else { document.getElementById('log-actual-rate').style.display = 'none'; }
  }

  document.getElementById('log-qty').addEventListener('input', updateActualRate);
  document.getElementById('log-hours').addEventListener('input', updateActualRate);

  document.getElementById('add-scrap-row').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'scrap-row';
    row.innerHTML = `<select class="scrap-reason-sel"><option value="">— Reason —</option>${scrapReasons.map(r => `<option value="${r.id}">${r.reason}</option>`).join('')}</select><input type="number" class="scrap-qty-in" min="1" value="1" /><button type="button" class="btn-icon" onclick="this.parentElement.remove()">✕</button>`;
    document.getElementById('scrap-rows').appendChild(row);
  });

  document.getElementById('log-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const scrap_detail = [...document.querySelectorAll('.scrap-row')].map(row => ({ scrap_reason_id: parseInt(row.querySelector('.scrap-reason-sel').value) || null, qty: parseInt(row.querySelector('.scrap-qty-in').value) || 0 })).filter(s => s.scrap_reason_id && s.qty > 0);
    const payload = { date: document.getElementById('log-date').value, shift: document.getElementById('log-shift').value, employee_id: parseInt(document.getElementById('log-employee').value), part_id: parseInt(document.getElementById('log-part').value), qty_produced: parseInt(document.getElementById('log-qty').value), qty_scrap: parseInt(document.getElementById('log-scrap-total').value) || 0, hours_run: parseFloat(document.getElementById('log-hours').value) || null, notes: document.getElementById('log-notes').value.trim() || null, scrap_detail };
    try {
      await API.post('/api/production', payload);
      toast('Production run saved!');
      document.getElementById('log-form').reset();
      document.getElementById('log-date').value = today();
      document.getElementById('scrap-rows').innerHTML = '';
      document.getElementById('log-rate-display').style.display = 'none';
      document.getElementById('log-actual-rate').style.display = 'none';
    } catch (err) { toast(err.error || 'Failed to save', 'error'); }
  });

  document.getElementById('log-reset').addEventListener('click', () => {
    document.getElementById('log-form').reset();
    document.getElementById('log-date').value = today();
    document.getElementById('scrap-rows').innerHTML = '';
  });
}
