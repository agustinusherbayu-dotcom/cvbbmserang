const state = {
  user: null,
  currentView: 'dashboard',
  dashboardData: null,
  transactions: [],
  tasks: [],
  users: [],
  audit: [],
  documents: [],
  bonus: []
};

const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const loginSubmitButton = loginForm.querySelector('button[type="submit"]');
const pageTitle = document.getElementById('pageTitle');
const userName = document.getElementById('userName');
const userRole = document.getElementById('userRole');
const togglePinBtn = document.getElementById('togglePin');
const pinInput = document.getElementById('pinInput');

let loginLockTimer = null;
let loginLockUntil = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function setLoginLock(retryAfterSeconds) {
  const seconds = Number(retryAfterSeconds) > 0 ? Number(retryAfterSeconds) : 15;
  loginLockUntil = Date.now() + seconds * 1000;
  loginSubmitButton.disabled = true;
  loginSubmitButton.textContent = `Tunggu ${seconds}s`;
  loginMessage.textContent = `Terlalu banyak percobaan login. Coba lagi dalam ${seconds} detik.`;

  if (loginLockTimer) {
    clearInterval(loginLockTimer);
  }

  loginLockTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((loginLockUntil - Date.now()) / 1000));
    loginSubmitButton.textContent = remaining > 0 ? `Tunggu ${remaining}s` : 'Masuk';

    if (remaining <= 0) {
      clearInterval(loginLockTimer);
      loginSubmitButton.disabled = false;
      loginSubmitButton.textContent = 'Masuk';
      loginMessage.textContent = '';
    }
  }, 1000);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function renderSummaryCards(data) {
  const summaryGrid = document.getElementById('summaryGrid');
  const cards = [
    { label: 'Total Saldo', value: data?.summary?.balance ?? 0, format: 'currency' },
    { label: 'Total Pemasukan', value: data?.summary?.income ?? 0, format: 'currency' },
    { label: 'Total Pengeluaran', value: data?.summary?.expense ?? 0, format: 'currency' },
    { label: 'Total Transaksi', value: data?.summary?.totalTransactions ?? 0, format: 'number' },
    { label: 'Pekerjaan Menunggu Verifikasi', value: data?.summary?.pendingVerification ?? 0, format: 'number' },
    { label: 'Total Bonus Karyawan', value: data?.summary?.totalBonus ?? 0, format: 'currency' }
  ];

  summaryGrid.innerHTML = cards.map(card => {
    const value = card.format === 'currency' ? formatCurrency(card.value) : card.value;
    return `
      <div class="summary-card">
        <span class="label">${escapeHtml(card.label)}</span>
        <p class="value">${value}</p>
      </div>
    `;
  }).join('');
}

function renderChart(data) {
  const chartBars = document.getElementById('chartBars');
  const months = data?.monthlySummary || [];
  const maxValue = Math.max(...months.flatMap(month => [month.income, month.expense]), 1);

  chartBars.innerHTML = months.map(month => `
    <div class="bar-group">
      <div class="bar income" title="Income ${escapeHtml(month.label)}" style="height: ${(month.income / maxValue) * 100}%"></div>
      <div class="bar expense" title="Expense ${escapeHtml(month.label)}" style="height: ${(month.expense / maxValue) * 100}%"></div>
    </div>
  `).join('');

  const labels = months.map(month => `<div style="text-align:center; font-size:0.72rem; color:#64748b;">${escapeHtml(month.label)}</div>`).join('');
  chartBars.insertAdjacentHTML('beforeend', `<div style="display:grid; grid-template-columns: repeat(${months.length}, minmax(42px, 1fr)); gap:10px; margin-top:12px;">${labels}</div>`);
}

function renderMonthlySummary(data) {
  const target = document.getElementById('monthlySummary');
  const rows = (data?.monthlySummary || []).map(month => `
    <div class="table-row">
      <span>${escapeHtml(month.label)}</span>
      <span>${formatCurrency(month.income)}</span>
      <span>${formatCurrency(month.expense)}</span>
    </div>
  `).join('');

  target.innerHTML = rows || '<p>Belum ada data.</p>';
}

function renderRecentTransactions(transactions) {
  const target = document.getElementById('recentTransactions');
  const rows = (transactions || []).map(tx => `
    <div class="table-row">
      <span>${escapeHtml(tx.project_name)}</span>
      <span><span class="tag ${tx.type}">${tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span></span>
      <span>${formatCurrency(tx.amount)}</span>
      <span>${new Date(tx.date).toLocaleDateString('id-ID')}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada transaksi.</p>';
}

function renderRecentActivity(activities) {
  const target = document.getElementById('recentActivity');
  const rows = (activities || []).map(activity => `
    <div class="activity-row">
      <span>${escapeHtml(activity.user_name || 'Sistem')}</span>
      <span>${escapeHtml(activity.action)}</span>
      <span>${new Date(activity.created_at).toLocaleString('id-ID')}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Tidak ada aktivitas.</p>';
}

function renderFinanceTable(transactions) {
  const target = document.getElementById('financeTable');
  const rows = (transactions || []).map(tx => `
    <div class="table-row">
      <span>${escapeHtml(tx.project_name)}</span>
      <span><span class="tag ${tx.type}">${tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span></span>
      <span>${formatCurrency(tx.amount)}</span>
      <span>${escapeHtml(tx.counterparty)}</span>
      <span>${escapeHtml(tx.created_by_name ?? '-')}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada transaksi.</p>';
}

function renderTaskTable(tasks) {
  const target = document.getElementById('taskTable');
  const canVerify = state.user?.role === 'DIREKTUR';

  const rows = (tasks || []).map(task => {
    const taskActions = canVerify && !['approved', 'rejected'].includes(task.status)
      ? `
        <div class="inline-actions">
          <button class="mini-btn success" data-task-action="approved" data-task-id="${task.id}" data-task-bonus="${Number(task.bonus_amount || 0)}">Approve</button>
          <button class="mini-btn danger" data-task-action="rejected" data-task-id="${task.id}">Tolak</button>
        </div>
      `
      : '<span class="tag ' + (task.status || 'pending') + '">' + (task.status || 'pending') + '</span>';

    return `
      <div class="task-row">
        <span>${escapeHtml(task.title)}</span>
        <span>${task.quantity}</span>
        <span>${escapeHtml(task.assignee_name || 'Unknown')}</span>
        <span>${formatCurrency(task.bonus_amount ?? 0)}</span>
        <span>${taskActions}</span>
      </div>
    `;
  }).join('');

  target.innerHTML = rows || '<p>Belum ada pekerjaan.</p>';
}

function renderUsersTable(users) {
  const target = document.getElementById('userTable');
  const currentRole = state.user?.role;
  const statuses = ['active', 'inactive', 'suspended'];

  const rows = (users || []).map(user => {
    const canEdit = currentRole === 'DIREKTUR' && state.user?.id !== user.id;
    const roleOptions = ['DIREKTUR', 'MANAGER', 'KOMISARIS', 'KARYAWAN'].map((role) => `<option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>`).join('');
    const statusOptions = statuses.map((status) => `<option value="${status}" ${status === user.status ? 'selected' : ''}>${status}</option>`).join('');

    const controls = canEdit
      ? `
        <div class="inline-controls">
          <select data-user-role="${user.id}">${roleOptions}</select>
          <select data-user-status="${user.id}">${statusOptions}</select>
          <button class="mini-btn" data-user-update="${user.id}">Update</button>
        </div>
      `
      : '<span class="tag ' + (user.status || 'active') + '">' + (user.status || 'active') + '</span>';

    return `
      <div class="user-row">
        <span>${escapeHtml(user.name)}</span>
        <span>${escapeHtml(user.phone)}</span>
        <span>${user.role}</span>
        <span>${controls}</span>
      </div>
    `;
  }).join('');

  target.innerHTML = rows || '<p>Belum ada pengguna.</p>';
}

function renderAuditTable(logs) {
  const target = document.getElementById('auditTable');
  const rows = (logs || []).map(log => `
    <div class="activity-row">
      <span>${escapeHtml(log.user_name || 'Sistem')}</span>
      <span>${escapeHtml(log.action)}</span>
      <span>${escapeHtml(log.details || '-')}</span>
      <span>${new Date(log.created_at).toLocaleString('id-ID')}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada log.</p>';
}

async function exportExcel() {
  try {
    const response = await fetch('/api/export/excel', { credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Gagal mengekspor Excel.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'bbm-export.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

function renderDocumentTable(documents) {
  const target = document.getElementById('documentTable');
  const rows = (documents || []).map(doc => `
    <div class="table-row">
      <span>${escapeHtml(doc.title)}</span>
      <span>${escapeHtml(doc.category)}</span>
      <span>${escapeHtml(doc.uploaded_by_name || '-')}</span>
      <span>${doc.file_path ? `<a href="/api/documents/${doc.id}/download" target="_blank" rel="noreferrer">Buka file</a>` : 'Tanpa file'}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada dokumen.</p>';
}

function renderBonusSummary(rows) {
  const target = document.getElementById('bonusSummary');
  const approved = (rows || []).filter((row) => row.status === 'approved');
  const pending = (rows || []).filter((row) => row.status !== 'approved');
  const totalApproved = approved.reduce((sum, row) => sum + Number(row.bonus_amount || 0), 0);
  const totalPending = pending.reduce((sum, row) => sum + Number(row.bonus_amount || 0), 0);
  const employeeCount = new Set((rows || []).map((row) => row.assignee_name).filter(Boolean)).size;

  const cards = [
    { label: 'Total Bonus Disetujui', value: formatCurrency(totalApproved) },
    { label: 'Bonus Menunggu', value: formatCurrency(totalPending) },
    { label: 'Karyawan Terlibat', value: employeeCount }
  ];

  target.innerHTML = cards.map(card => `
    <div class="bonus-summary-card">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
    </div>
  `).join('');
}

function renderBonusTable(rows) {
  const target = document.getElementById('bonusTable');
  const tableRows = (rows || []).map(row => `
    <div class="table-row">
      <span>${escapeHtml(row.title)}</span>
      <span>${escapeHtml(row.assignee_name || '-')}</span>
      <span>${formatCurrency(row.bonus_amount || 0)}</span>
      <span><span class="tag ${row.status || 'pending'}">${row.status || 'pending'}</span></span>
    </div>
  `).join('');

  renderBonusSummary(rows);
  target.innerHTML = tableRows || '<p>Belum ada data bonus.</p>';
}

function getAllowedViews(role) {
  const map = {
    DIREKTUR: ['dashboard', 'finance', 'documents', 'bonus', 'tasks', 'users', 'audit'],
    MANAGER: ['dashboard', 'bonus', 'tasks'],
    KOMISARIS: ['dashboard', 'bonus', 'tasks'],
    KARYAWAN: ['dashboard', 'bonus', 'tasks']
  };

  return map[role] || ['dashboard'];
}

function applyRolePermissions() {
  const role = state.user?.role || 'KARYAWAN';
  const allowed = getAllowedViews(role);

  document.querySelectorAll('.nav-btn').forEach((button) => {
    const isAllowed = allowed.includes(button.dataset.view);
    button.style.display = isAllowed ? 'block' : 'none';
  });

  const financeView = document.getElementById('financeView');
  const taskForm = document.getElementById('taskForm');
  const transactionForm = document.getElementById('transactionForm');
  const documentForm = document.getElementById('documentForm');

  if (financeView) {
    financeView.style.display = allowed.includes('finance') ? 'block' : 'none';
  }

  if (transactionForm) {
    transactionForm.querySelectorAll('input, select, textarea, button').forEach((element) => {
      element.disabled = !allowed.includes('finance');
    });
  }

  if (documentForm) {
    documentForm.querySelectorAll('input, textarea, button').forEach((element) => {
      element.disabled = !allowed.includes('documents');
    });
  }

  if (taskForm) {
    const canSubmitTask = allowed.includes('tasks');
    taskForm.querySelectorAll('input, textarea, button').forEach((element) => {
      element.disabled = !canSubmitTask;
    });
  }
}

function setCurrentView(view) {
  const role = state.user?.role || 'KARYAWAN';
  const allowed = getAllowedViews(role);
  const safeView = allowed.includes(view) ? view : 'dashboard';

  document.querySelectorAll('.nav-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.view === safeView);
  });

  document.querySelectorAll('.view').forEach(section => {
    section.classList.toggle('hidden', section.id !== `${safeView}View`);
  });

  pageTitle.textContent = {
    dashboard: 'Dashboard',
    finance: 'Keuangan',
    documents: 'Dokumen',
    bonus: 'Bonus',
    tasks: 'Pekerjaan',
    users: 'Pengguna',
    audit: 'Audit'
  }[safeView];

  state.currentView = safeView;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
    }
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after') || data.retry_after || 0);
    const error = new Error(data.error || data.message || 'Request failed');
    error.retryAfter = retryAfter;
    error.status = res.status;
    throw error;
  }

  return data;
}

async function loadDashboard() {
  const data = await apiFetch('/api/dashboard');
  state.dashboardData = data;
  state.transactions = data.transactions || [];
  state.tasks = data.tasks || [];
  renderSummaryCards(data);
  renderChart(data);
  renderMonthlySummary(data);
  renderRecentTransactions(data.transactions || []);
  renderRecentActivity(data.activities || []);
  renderFinanceTable(state.transactions);
  renderTaskTable(state.tasks);
}

async function loadUsers() {
  const users = await apiFetch('/api/users');
  state.users = users;
  renderUsersTable(users);
}

async function loadAudit() {
  const logs = await apiFetch('/api/audit');
  state.audit = logs;
  renderAuditTable(logs);
}

async function loadTasks() {
  const tasks = await apiFetch('/api/tasks');
  state.tasks = tasks;
  renderTaskTable(tasks);
}

async function loadFinance() {
  const transactions = await apiFetch('/api/transactions');
  state.transactions = transactions;
  renderFinanceTable(transactions);
}

async function loadDocuments() {
  const documents = await apiFetch('/api/documents');
  state.documents = documents;
  renderDocumentTable(documents);
}

async function loadBonus() {
  const bonus = await apiFetch('/api/bonus');
  state.bonus = bonus;
  renderBonusTable(bonus);
}

async function refreshData() {
  try {
    await loadDashboard();
    if (state.user.role === 'DIREKTUR') {
        await Promise.all([loadFinance(), loadDocuments(), loadBonus(), loadUsers(), loadAudit()]);
      } else {
        await Promise.all([loadBonus(), loadTasks()]);
      }
  } catch (error) {
    console.error(error);
  }
}

async function loadSession() {
  try {
    const health = await apiFetch('/api/health');
    if (!health.fileStorageAvailable) {
      document.querySelectorAll('[data-storage-note]').forEach((note) => {
        note.hidden = false;
        note.textContent = 'Penyimpanan lampiran belum diaktifkan. Form dan data tanpa file tetap dapat disimpan.';
        note.previousElementSibling.disabled = true;
      });
    }
  } catch (error) {
    console.error('Gagal memeriksa konfigurasi penyimpanan file:', error);
  }

  try {
    const session = await apiFetch('/api/session');
    if (session.user) {
      state.user = session.user;
      showDashboard();
      await refreshData();
    }
  } catch (error) {
    console.error(error);
  }
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  userName.textContent = state.user?.name || '-';
  userRole.textContent = state.user?.role === 'DIREKTUR' ? 'Admin · Direktur' : state.user?.role || 'KARYAWAN';
  document.getElementById('exportExcelBtn').hidden = state.user?.role !== 'DIREKTUR';
  applyRolePermissions();
  setCurrentView(state.currentView || 'dashboard');
}

function showLogin() {
  dashboardScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (loginSubmitButton.disabled) {
    return;
  }

  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (loginLockTimer) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
    }
    loginSubmitButton.disabled = false;
    loginSubmitButton.textContent = 'Masuk';
    state.user = result.user;
    loginMessage.textContent = '';
    showDashboard();
    await refreshData();
  } catch (error) {
    if (error.status === 429 || error.retryAfter > 0) {
      setLoginLock(error.retryAfter || 15);
      return;
    }
    loginMessage.textContent = error.message;
  }
});

const logoutBtn = document.getElementById('logoutBtn');
logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
    state.user = null;
    showLogin();
  } catch (error) {
    console.error(error);
  }
});

document.getElementById('exportExcelBtn').addEventListener('click', () => {
  if (state.user?.role === 'DIREKTUR') {
    exportExcel();
  } else {
    alert('Hanya direktur yang dapat mengekspor file Excel.');
  }
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => {
    setCurrentView(button.dataset.view);
  });
});

togglePinBtn.addEventListener('click', () => {
  const isHidden = pinInput.type === 'password';
  pinInput.type = isHidden ? 'text' : 'password';
  togglePinBtn.textContent = isHidden ? 'Sembunyikan' : 'Lihat';
});

document.addEventListener('click', async (event) => {
  const taskActionButton = event.target.closest('[data-task-action]');
  if (taskActionButton) {
    const taskId = taskActionButton.dataset.taskId;
    const status = taskActionButton.dataset.taskAction;
    const bonusAmount = Number(taskActionButton.dataset.taskBonus || 0);

    try {
      await apiFetch(`/api/tasks/${taskId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, bonus_amount: bonusAmount })
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const userUpdateButton = event.target.closest('[data-user-update]');
  if (userUpdateButton) {
    const userId = userUpdateButton.dataset.userUpdate;
    const nextRole = document.querySelector(`[data-user-role="${userId}"]`)?.value;
    const nextStatus = document.querySelector(`[data-user-status="${userId}"]`)?.value;

    try {
      await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole, status: nextStatus })
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    }
  }
});

document.getElementById('transactionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      body: formData
    });
    form.reset();
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('taskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('documentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch('/api/documents', {
      method: 'POST',
      body: formData
    });
    form.reset();
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('userCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    await apiFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    await refreshData();
    alert('Pengguna baru berhasil dibuat.');
  } catch (error) {
    alert(error.message);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}

loadSession();
