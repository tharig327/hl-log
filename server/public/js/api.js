const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw await r.json();
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw await r.json();
    return r.json();
  },
  async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw await r.json();
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw await r.json();
    return r.json();
  }
};

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.className = 'toast hidden', 3000);
}

function effClass(pct) {
  if (pct == null) return '';
  if (pct >= 90) return 'eff-high';
  if (pct >= 70) return 'eff-mid';
  return 'eff-low';
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
