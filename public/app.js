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
const loginSubmitLabel = loginSubmitButton.querySelector('span');
const pageTitle = document.getElementById('pageTitle');
const userName = document.getElementById('userName');
const userRole = document.getElementById('userRole');
const togglePinBtn = document.getElementById('togglePin');
const pinInput = document.getElementById('pinInput');
const changePinDialog = document.getElementById('changePinDialog');
const changePinForm = document.getElementById('changePinForm');
const changePinMessage = document.getElementById('changePinMessage');

let loginLockTimer = null;
let loginLockUntil = 0;

document.getElementById('loginYear').textContent = new Date().getFullYear();

function setLoginSubmitLabel(text) {
  loginSubmitLabel.textContent = text;
}

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
  setLoginSubmitLabel(`Tunggu ${seconds}s`);
  loginMessage.textContent = `Terlalu banyak percobaan login. Coba lagi dalam ${seconds} detik.`;

  if (loginLockTimer) {
    clearInterval(loginLockTimer);
  }

  loginLockTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((loginLockUntil - Date.now()) / 1000));
    setLoginSubmitLabel(remaining > 0 ? `Tunggu ${remaining}s` : 'Masuk dengan aman');

    if (remaining <= 0) {
      clearInterval(loginLockTimer);
      loginSubmitButton.disabled = false;
      setLoginSubmitLabel('Masuk dengan aman');
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

function validateUploadSize(form) {
  const fileInput = form.querySelector('input[type="file"]');
  const file = fileInput?.files?.[0];
  if (!file) return true;

  const maxBytes = Number(fileInput.dataset.maxUpload) || 3 * 1024 * 1024;
  if (file.size <= maxBytes) return true;

  alert(`Ukuran file "${file.name}" ${ (file.size / (1024 * 1024)).toFixed(2) } MB. Batas upload 3 MB agar tidak ditolak Vercel. Kompres file terlebih dahulu, lalu coba kembali.`);
  fileInput.value = '';
  fileInput.focus();
  return false;
}

function renderSummaryCards(data) {
  const summaryGrid = document.getElementById('summaryGrid');
  const isDirector = state.user?.role === 'DIREKTUR';
  document.getElementById('companyDashboardContent').classList.toggle('hidden', !isDirector);
  document.getElementById('employeeDashboardNote').classList.toggle('hidden', isDirector);
  document.getElementById('directorQuickActions').classList.toggle('hidden', !isDirector);
  const cards = isDirector
    ? [
      { key: 'balance', label: 'Total Saldo', value: data?.summary?.balance ?? 0, format: 'currency' },
      { key: 'income', label: 'Total Pemasukan', value: data?.summary?.income ?? 0, format: 'currency' },
      { key: 'expense', label: 'Total Pengeluaran', value: data?.summary?.expense ?? 0, format: 'currency' },
      { key: 'transactions', label: 'Total Transaksi', value: data?.summary?.totalTransactions ?? 0, format: 'number' },
      { key: 'pendingTasks', label: 'Pekerjaan Menunggu Verifikasi', value: data?.summary?.pendingVerification ?? 0, format: 'number' },
      { key: 'approvedTasks', label: 'Pekerjaan Disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' },
      { key: 'bonuses', label: 'Total Bonus Karyawan', value: data?.summary?.totalBonus ?? 0, format: 'currency' }
    ]
    : [
      { key: 'assignedTasks', label: 'Tugas ditugaskan', value: data?.summary?.assignedTasks ?? 0, format: 'number' },
      { key: 'inProgressTasks', label: 'Dalam pengerjaan', value: data?.summary?.inProgressTasks ?? 0, format: 'number' },
      { key: 'waitingTasks', label: 'Menunggu pemeriksaan', value: data?.summary?.waitingTasks ?? 0, format: 'number' },
      { key: 'approvedTasks', label: 'Selesai disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' }
    ];

  summaryGrid.innerHTML = cards.map(card => {
    const value = card.format === 'currency' ? formatCurrency(card.value) : card.value;
    return `
      <button type="button" class="summary-card" data-dashboard-detail="${card.key}" aria-label="Lihat rincian: ${escapeHtml(card.label)}">
        <span class="label">${escapeHtml(card.label)}</span>
        <p class="value">${value}</p>
        <span class="summary-card-hint">Lihat rincian <span aria-hidden="true">→</span></span>
      </button>
    `;
  }).join('');
}

function renderTransactionDetails(transactions, type) {
  const filtered = type === 'balance' || type === 'all'
    ? transactions
    : transactions.filter((transaction) => transaction.type === type);
  const income = transactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const expense = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const title = type === 'balance' ? 'Rangkuman saldo perusahaan' : type === 'income' ? 'Rincian pemasukan' : type === 'expense' ? 'Rincian pengeluaran' : 'Daftar transaksi';
  const summary = type === 'balance'
    ? `<div class="indicator-detail-summary">
        <span>Total pemasukan <strong>${formatCurrency(income)}</strong></span>
        <span>Total pengeluaran <strong>${formatCurrency(expense)}</strong></span>
        <span>Saldo <strong>${formatCurrency(income - expense)}</strong></span>
      </div>`
    : '';
  const rows = filtered.map((transaction) => `
    <article class="indicator-detail-row">
      <div>
        <strong>${escapeHtml(transaction.project_name || transaction.category || 'Transaksi')}</strong>
        <span>${new Date(transaction.date).toLocaleDateString('id-ID')} · ${escapeHtml(transaction.category || '-')}</span>
      </div>
      <strong class="${transaction.type === 'income' ? 'detail-income' : 'detail-expense'}">${formatCurrency(transaction.amount)}</strong>
    </article>
  `).join('');
  return `<h3>${title}</h3>${summary}${rows || '<p class="indicator-empty">Belum ada data untuk indikator ini.</p>'}`;
}

function renderTaskDetails(tasks, key) {
  const filtered = key === 'pendingTasks'
    ? tasks.filter((task) => task.status === 'in_review')
    : key === 'approvedTasks'
      ? tasks.filter((task) => task.status === 'approved')
      : key === 'inProgressTasks'
        ? tasks.filter((task) => task.status === 'pending' || task.status === 'rejected')
        : tasks;
  const rows = filtered.map((task) => {
    const statusLabels = {
      pending: 'Dalam pengerjaan',
      in_review: 'Menunggu pemeriksaan',
      approved: 'Disetujui',
      rejected: 'Perlu perbaikan'
    };
    const taskStatus = statusLabels[task.status] || 'Belum selesai';
    const assignee = state.user?.role === 'DIREKTUR' && task.assignee_name
      ? `<span>${escapeHtml(task.assignee_name)}</span>`
      : '';
    const bonus = state.user?.role === 'DIREKTUR' && task.bonus_amount !== undefined
      ? `<span>Bonus: ${formatCurrency(task.bonus_amount)}</span>`
      : '';
    return `
      <article class="indicator-detail-row indicator-task-row">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${assignee}${assignee ? ' · ' : ''}${taskStatus} · Progres ${Math.max(0, Math.min(100, Number(task.progress_percent) || 0))}%</span>
          ${task.progress_note ? `<p>${escapeHtml(task.progress_note)}</p>` : ''}
          ${task.result ? `<p><strong>Hasil:</strong> ${escapeHtml(task.result)}</p>` : ''}
        </div>
        ${bonus}
      </article>
    `;
  }).join('');
  return rows || '<p class="indicator-empty">Belum ada pekerjaan pada indikator ini.</p>';
}

async function openIndicatorDetails(key) {
  const dialog = document.getElementById('indicatorDialog');
  const title = document.getElementById('indicatorDialogTitle');
  const content = document.getElementById('indicatorDialogContent');
  const isDirector = state.user?.role === 'DIREKTUR';
  const labels = {
    balance: 'Total Saldo',
    income: 'Total Pemasukan',
    expense: 'Total Pengeluaran',
    transactions: 'Total Transaksi',
    pendingTasks: 'Pekerjaan Menunggu Verifikasi',
    approvedTasks: 'Pekerjaan Disetujui',
    bonuses: 'Total Bonus Karyawan',
    assignedTasks: 'Tugas ditugaskan',
    inProgressTasks: 'Dalam pengerjaan',
    waitingTasks: 'Menunggu pemeriksaan'
  };
  title.textContent = labels[key] || 'Rincian indikator';
  content.innerHTML = '<p class="indicator-empty">Memuat rincian...</p>';
  dialog.showModal();

  try {
    if (['balance', 'income', 'expense', 'transactions'].includes(key) && isDirector) {
      const transactions = await apiFetch('/api/transactions');
      content.innerHTML = renderTransactionDetails(
        transactions,
        key === 'transactions' ? 'all' : key
      );
      return;
    }

    if (key === 'bonuses') {
      const bonuses = await apiFetch('/api/bonus');
      const total = bonuses.reduce((sum, bonus) => sum + Number(bonus.bonus_amount || 0), 0);
      const rows = bonuses.map((bonus) => `
        <article class="indicator-detail-row">
          <div>
            <strong>${escapeHtml(bonus.title)}</strong>
            <span>${state.user?.role === 'DIREKTUR' ? `${escapeHtml(bonus.assignee_name || '-')} · ` : ''}${bonus.status === 'approved' ? 'Disetujui' : bonus.status === 'in_review' ? 'Menunggu pemeriksaan' : 'Belum disetujui'}</span>
          </div>
          <strong>${formatCurrency(bonus.bonus_amount)}</strong>
        </article>
      `).join('');
      content.innerHTML = `<div class="indicator-detail-summary"><span>Total bonus tercatat<strong>${formatCurrency(total)}</strong></span></div>${rows || '<p class="indicator-empty">Belum ada data bonus.</p>'}`;
      return;
    }

    const tasks = await apiFetch('/api/tasks');
    content.innerHTML = renderTaskDetails(tasks, key);
  } catch (error) {
    content.innerHTML = `<p class="indicator-error">${escapeHtml(error.message)}</p>`;
  }
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
      <span>${tx.has_attachment ? `<a href="/api/transactions/${Number(tx.id)}/attachment" target="_blank" rel="noreferrer">Buka lampiran</a>` : 'Tanpa lampiran'}</span>
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada transaksi.</p>';
}

function renderTaskTable(tasks) {
  const target = document.getElementById('taskTable');
  const canVerify = state.user?.role === 'DIREKTUR';
  const isEmployee = state.user?.role === 'KARYAWAN';
  document.getElementById('taskListHeading').textContent = canVerify ? 'Semua pekerjaan' : 'Pekerjaan saya';

  const rows = (tasks || []).map(task => {
    const progress = Math.max(0, Math.min(100, Number(task.progress_percent) || 0));
    const statusLabels = {
      pending: 'Belum selesai',
      in_review: 'Menunggu pemeriksaan',
      approved: 'Disetujui',
      rejected: 'Perlu diperbaiki'
    };
    const status = ['pending', 'in_review', 'approved', 'rejected'].includes(task.status) ? task.status : 'pending';
    const verificationActions = canVerify && status === 'in_review'
      ? `<div class="inline-actions task-verification-actions">
          <button class="mini-btn success" data-task-action="approved" data-task-id="${Number(task.id)}" data-task-bonus="${Number(task.bonus_amount || 0)}">Setujui hasil</button>
          <button class="mini-btn danger" data-task-action="rejected" data-task-id="${Number(task.id)}">Minta perbaikan</button>
        </div>`
      : '';
    const progressForm = !canVerify && !['approved', 'in_review'].includes(status)
      ? `<form class="task-progress-form" data-progress-form data-task-id="${Number(task.id)}">
          <label>
            <span>Progres saat ini (%)</span>
            <input type="number" name="progress_percent" min="0" max="100" step="1" value="${progress}" required />
          </label>
          <label>
            <span>Uraian progres</span>
            <textarea name="progress_note" rows="2" maxlength="2000" placeholder="Apa yang sudah dikerjakan?" required>${escapeHtml(task.progress_note || '')}</textarea>
          </label>
          <label>
            <span>Hasil sementara / akhir</span>
            <textarea name="result" rows="2" maxlength="3000" placeholder="Catat hasil pekerjaan yang sudah diperoleh">${escapeHtml(task.result || '')}</textarea>
          </label>
          <button class="primary-btn small" type="submit">Simpan progres</button>
        </form>`
      : '';
    const reviewNote = !canVerify && status === 'in_review'
      ? '<p class="task-waiting-review">Hasil sudah dikirim untuk diperiksa. Anda dapat memperbarui pekerjaan setelah mendapat keputusan Direktur.</p>'
      : '';

    return `
      <article class="task-card">
        <div class="task-card-heading">
          <div>
            <h4>${escapeHtml(task.title)}</h4>
            ${canVerify ? `<p class="task-assignee">Ditugaskan kepada ${escapeHtml(task.assignee_name || '-')}</p>` : ''}
          </div>
          <span class="tag ${status}">${statusLabels[status]}</span>
        </div>
        ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
        <div class="task-progress-heading">
          <span>Progres</span>
          <strong>${progress}%</strong>
        </div>
        <div class="task-progress-track" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${progress}%"></span>
        </div>
        <div class="task-details">
          <span>Target: <strong>${escapeHtml(task.quantity)}</strong></span>
          ${task.progress_note ? `<span>Update: ${escapeHtml(task.progress_note)}</span>` : '<span>Belum ada catatan progres.</span>'}
          ${task.result ? `<span>Hasil: ${escapeHtml(task.result)}</span>` : ''}
          ${canVerify ? `<span>Bonus tugas: <strong>${formatCurrency(task.bonus_amount ?? 0)}</strong></span>` : ''}
        </div>
        <details class="task-history">
          <summary data-task-history="${Number(task.id)}">Lihat riwayat progres</summary>
          <div class="task-history-list" data-task-updates="${Number(task.id)}"><span class="field-help">Buka untuk memuat riwayat.</span></div>
        </details>
        ${progressForm}
        ${reviewNote}
        ${verificationActions}
      </article>
    `;
  }).join('');

  target.innerHTML = rows || `<div class="task-empty">
    <strong>${isEmployee ? 'Belum ada tugas untuk Anda.' : 'Belum ada pekerjaan.'}</strong>
    <p>${isEmployee ? 'Tugas baru yang diberikan kepada Anda akan muncul di sini.' : 'Pekerjaan yang ditugaskan akan muncul di sini.'}</p>
  </div>`;
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
      <span>${doc.has_file ? `<a href="/api/documents/${Number(doc.id)}/download" target="_blank" rel="noreferrer">Buka file</a>` : 'Tanpa file'}</span>
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
  const isDirector = role === 'DIREKTUR';

  document.querySelectorAll('.nav-btn').forEach((button) => {
    const isAllowed = allowed.includes(button.dataset.view);
    button.style.display = isAllowed ? 'block' : 'none';
  });

  const financeView = document.getElementById('financeView');
  const taskForm = document.getElementById('taskForm');
  const taskAssignmentPanel = document.getElementById('taskAssignmentPanel');
  const transactionForm = document.getElementById('transactionForm');
  const documentForm = document.getElementById('documentForm');

  document.getElementById('directorQuickActions').classList.toggle('hidden', !isDirector);
  document.getElementById('companyDashboardContent').classList.toggle('hidden', !isDirector);
  document.getElementById('employeeDashboardNote').classList.toggle('hidden', isDirector);

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
    taskAssignmentPanel.classList.toggle('hidden', !isDirector);
    taskForm.querySelectorAll('input, select, textarea, button').forEach((element) => {
      element.disabled = !isDirector;
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
    const message = res.status === 413
      ? 'Ukuran file atau request terlalu besar. Batas file 3 MB; kompres file lalu coba kembali.'
      : data.error || data.message || 'Request failed';
    const error = new Error(message);
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
  const assigneeSelect = document.getElementById('taskAssignee');
  assigneeSelect.innerHTML = '<option value="">Pilih karyawan</option>' + users
    .filter((user) => user.role === 'KARYAWAN' && user.status === 'active')
    .map((user) => `<option value="${Number(user.id)}">${escapeHtml(user.name)}</option>`)
    .join('');
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
        await Promise.all([loadFinance(), loadDocuments(), loadBonus(), loadUsers(), loadAudit(), loadTasks()]);
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
        note.textContent = 'Penyimpanan file belum tersedia. Unggah file tidak dapat digunakan saat ini.';
        note.previousElementSibling.disabled = true;
      });
    } else if (health.fileStorageMode === 'neon') {
      document.querySelectorAll('[data-storage-note]').forEach((note) => {
        note.hidden = false;
        note.textContent = 'File kecil disimpan privat di database Neon (maks. 3 MB).';
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
    setLoginSubmitLabel('Masuk dengan aman');
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
document.getElementById('changePinBtn').addEventListener('click', () => {
  changePinMessage.textContent = '';
  changePinMessage.className = 'pin-change-message';
  changePinForm.reset();
  changePinDialog.showModal();
});

document.querySelector('[data-close-pin]').addEventListener('click', () => {
  changePinDialog.close();
});

changePinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = changePinForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(changePinForm).entries());
  if (values.new_pin !== values.confirm_pin) {
    changePinMessage.textContent = 'PIN baru dan konfirmasi belum cocok.';
    changePinMessage.classList.add('error');
    return;
  }
  if (values.current_pin === values.new_pin) {
    changePinMessage.textContent = 'PIN baru harus berbeda dari PIN saat ini.';
    changePinMessage.classList.add('error');
    return;
  }

  submitButton.disabled = true;
  changePinMessage.textContent = '';
  changePinMessage.className = 'pin-change-message';
  try {
    await apiFetch('/api/profile/change-pin', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    changePinForm.reset();
    changePinMessage.textContent = 'PIN berhasil diperbarui.';
    changePinMessage.classList.add('success');
  } catch (error) {
    changePinMessage.textContent = error.message;
    changePinMessage.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
});

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
  const indicatorCard = event.target.closest('[data-dashboard-detail]');
  if (indicatorCard) {
    await openIndicatorDetails(indicatorCard.dataset.dashboardDetail);
    return;
  }

  if (event.target.closest('[data-close-indicator]')) {
    document.getElementById('indicatorDialog').close();
    return;
  }

  const openTasksButton = event.target.closest('[data-open-tasks]');
  if (openTasksButton) {
    setCurrentView('tasks');
    return;
  }

  const historySummary = event.target.closest('[data-task-history]');
  if (historySummary) {
    const taskId = historySummary.dataset.taskHistory;
    const historyList = document.querySelector(`[data-task-updates="${taskId}"]`);
    if (!historyList || historyList.dataset.loaded === 'true') return;
    historyList.textContent = 'Memuat riwayat progres...';
    try {
      const updates = await apiFetch(`/api/tasks/${taskId}/updates`);
      historyList.innerHTML = updates.length
        ? updates.map((update) => `
            <article class="task-history-entry">
              <div><strong>${Number(update.progress_percent)}%</strong><time>${escapeHtml(new Date(update.submitted_at).toLocaleString('id-ID'))}</time></div>
              <p>${escapeHtml(update.progress_note)}</p>
              ${update.result ? `<p><strong>Hasil:</strong> ${escapeHtml(update.result)}</p>` : ''}
              ${state.user?.role === 'DIREKTUR' ? `<small>${escapeHtml(update.user_name)}</small>` : ''}
            </article>
          `).join('')
        : '<p class="field-help">Belum ada riwayat pembaruan.</p>';
      historyList.dataset.loaded = 'true';
    } catch (error) {
      historyList.textContent = error.message;
    }
    return;
  }

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

document.addEventListener('submit', async (event) => {
  const progressForm = event.target.closest('[data-progress-form]');
  if (!progressForm) return;
  event.preventDefault();
  const submitButton = progressForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(progressForm).entries());
    await apiFetch(`/api/tasks/${progressForm.dataset.taskId}/progress`, {
      method: 'POST',
      body: JSON.stringify(values)
    });
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

const transactionForm = document.getElementById('transactionForm');
const transactionDateInput = transactionForm.elements.date;
const setTransactionDateToday = () => {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  transactionDateInput.value = localDate;
};

setTransactionDateToday();

transactionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateUploadSize(form)) return;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      body: formData
    });
    form.reset();
    setTransactionDateToday();
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
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
  if (!validateUploadSize(form)) return;
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
