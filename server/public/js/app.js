const pages = {
  dashboard: loadDashboard,
  log:       loadLog,
  history:   loadHistory,
  reports:   loadReports,
  customers: loadCustomers,
  employees: loadEmployees,
  settings:  loadSettings
};

async function navigate(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.sidebar a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === name);
  });
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.remove('hidden');
  if (pages[name]) await pages[name]();
}

document.querySelectorAll('.sidebar a[data-page]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigate(link.dataset.page);
  });
});

navigate('dashboard');
