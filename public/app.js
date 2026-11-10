const state = {
  user: null,
  currentView: 'dashboard',
  dashboardData: null,
  transactions: [],
  tasks: [],
  users: [],
  audit: [],
  documents: [],
  bonus: [],
  inventory: null,
  procurement: null
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

function formatCompactCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    notation: 'compact',
    maximumFractionDigits: 1
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
  const canViewFinance = ['DIREKTUR', 'KOMISARIS'].includes(state.user?.role);
  document.getElementById('companyDashboardContent').classList.toggle('hidden', !canViewFinance);
  document.getElementById('employeeDashboardNote').classList.toggle('hidden', canViewFinance);
  document.getElementById('directorQuickActions').classList.toggle('hidden', !isDirector);
  const cards = canViewFinance
    ? [
      { key: 'balance', label: 'Total Saldo', value: data?.summary?.balance ?? 0, format: 'currency' },
      { key: 'income', label: 'Total Pemasukan', value: data?.summary?.income ?? 0, format: 'currency' },
      { key: 'expense', label: 'Total Pengeluaran', value: data?.summary?.expense ?? 0, format: 'currency' },
      { key: 'transactions', label: 'Total Transaksi', value: data?.summary?.totalTransactions ?? 0, format: 'number' },
      ...(isDirector ? [
        { key: 'pendingTasks', label: 'Pekerjaan Menunggu Verifikasi', value: data?.summary?.pendingVerification ?? 0, format: 'number' },
        { key: 'approvedTasks', label: 'Pekerjaan Disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' },
        { key: 'bonuses', label: 'Total Bonus Karyawan', value: data?.summary?.totalBonus ?? 0, format: 'currency' }
      ] : [
        { key: 'assignedTasks', label: 'Tugas ditugaskan', value: data?.summary?.assignedTasks ?? 0, format: 'number' },
        { key: 'inProgressTasks', label: 'Dalam pengerjaan', value: data?.summary?.inProgressTasks ?? 0, format: 'number' },
        { key: 'waitingTasks', label: 'Menunggu pemeriksaan', value: data?.summary?.waitingTasks ?? 0, format: 'number' },
        { key: 'approvedTasks', label: 'Selesai disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' }
      ])
    ]
    : [
      { key: 'assignedTasks', label: 'Tugas ditugaskan', value: data?.summary?.assignedTasks ?? 0, format: 'number' },
      { key: 'inProgressTasks', label: 'Dalam pengerjaan', value: data?.summary?.inProgressTasks ?? 0, format: 'number' },
      { key: 'waitingTasks', label: 'Menunggu pemeriksaan', value: data?.summary?.waitingTasks ?? 0, format: 'number' },
      { key: 'approvedTasks', label: 'Selesai disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' }
    ];

  summaryGrid.innerHTML = cards.map(card => {
    const value = card.format === 'currency' ? formatCompactCurrency(card.value) : card.value;
    return `
      <button type="button" class="summary-card" data-dashboard-detail="${card.key}" aria-label="Lihat rincian: ${escapeHtml(card.label)}">
        <span class="label">${escapeHtml(card.label)}</span>
        <p class="value" title="${card.format === 'currency' ? escapeHtml(formatCurrency(card.value)) : ''}">${value}</p>
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
  const canViewFinance = ['DIREKTUR', 'KOMISARIS'].includes(state.user?.role);
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
    if (['balance', 'income', 'expense', 'transactions'].includes(key) && canViewFinance) {
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

function renderInventory(data) {
  state.inventory = data;
  const loadMessage = document.getElementById('inventoryLoadMessage');
  loadMessage.hidden = true;
  loadMessage.textContent = '';
  document.getElementById('inventoryTotalItems').textContent = data.summary.totalItems;
  document.getElementById('inventoryLowStock').textContent = data.summary.lowStockItems;
  document.getElementById('inventoryOutOfStock').textContent = data.summary.outOfStockItems;
  document.getElementById('inventoryTotalValue').textContent = formatCurrency(data.summary.totalInventoryValue);

  const canWrite = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const categories = data.categories.filter((category) => category.is_active);
  const warehouses = data.warehouses.filter((warehouse) => warehouse.is_active);
  const categorySelect = document.querySelector('#inventoryItemForm [name="category_id"]');
  const defaultWarehouseSelect = document.querySelector('#inventoryItemForm [name="default_warehouse_id"]');
  categorySelect.innerHTML = '<option value="">Pilih kategori</option>' + categories
    .map((category) => `<option value="${Number(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');
  defaultWarehouseSelect.innerHTML = '<option value="">Tidak ditentukan</option>' + warehouses
    .map((warehouse) => `<option value="${Number(warehouse.id)}">${escapeHtml(warehouse.name)}</option>`)
    .join('');

  const itemSelect = document.querySelector('#inventoryMovementForm [name="item_id"]');
  const warehouseSelect = document.querySelector('#inventoryMovementForm [name="warehouse_id"]');
  const previousItemId = itemSelect.value;
  itemSelect.innerHTML = '<option value="">Pilih barang</option>' + data.items
    .filter((item) => item.is_active)
    .map((item) => `<option value="${Number(item.id)}">${escapeHtml(item.sku)} · ${escapeHtml(item.name)}</option>`)
    .join('');
  if (data.items.some((item) => String(item.id) === previousItemId && item.is_active)) {
    itemSelect.value = previousItemId;
  }
  warehouseSelect.innerHTML = '<option value="">Pilih gudang</option>' + warehouses
    .map((warehouse) => `<option value="${Number(warehouse.id)}">${escapeHtml(warehouse.name)}</option>`)
    .join('');
  syncInventoryMovementUnits();

  const items = data.items.map((item) => `
    <div class="table-row inventory-item-row">
      <span><strong>${escapeHtml(item.sku)}</strong><small>${escapeHtml(item.name)}</small></span>
      <span>${escapeHtml(item.category_name)}</span>
      <span>${escapeHtml(item.total_stock)} ${escapeHtml(item.base_unit)}</span>
      <span>Min. ${escapeHtml(item.min_stock)} ${escapeHtml(item.base_unit)}</span>
      <span>${escapeHtml(item.default_warehouse_name || '-')}</span>
      <span><span class="tag ${item.is_active ? (item.is_low_stock ? 'pending' : 'approved') : 'inactive'}">${item.is_active ? (item.is_low_stock ? 'Stok rendah' : 'Aktif') : 'Nonaktif'}</span></span>
      ${canWrite ? `<span><button class="mini-btn" type="button" data-inventory-edit="item" data-id="${Number(item.id)}">Ubah</button></span>` : ''}
    </div>
  `).join('');
  document.getElementById('inventoryItemsTable').innerHTML = items || '<p>Belum ada barang terdaftar.</p>';

  const categoriesHtml = data.categories.map((category) => `
    <div class="table-row inventory-admin-row">
      <span><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description || 'Tanpa deskripsi')}</small></span>
      <span>${category.is_active ? 'Aktif' : 'Nonaktif'}</span>
      ${canWrite ? `<span><button class="mini-btn" type="button" data-inventory-edit="category" data-id="${Number(category.id)}">Ubah</button></span>` : ''}
    </div>
  `).join('');
  document.getElementById('inventoryCategoriesList').innerHTML = categoriesHtml || '<p>Belum ada kategori.</p>';

  const warehousesHtml = data.warehouses.map((warehouse) => `
    <div class="table-row inventory-admin-row">
      <span><strong>${escapeHtml(warehouse.name)}</strong><small>${escapeHtml(warehouse.location || 'Lokasi belum diisi')}</small></span>
      <span>${warehouse.is_active ? 'Aktif' : 'Nonaktif'}</span>
      ${canWrite ? `<span><button class="mini-btn" type="button" data-inventory-edit="warehouse" data-id="${Number(warehouse.id)}">Ubah</button></span>` : ''}
    </div>
  `).join('');
  document.getElementById('inventoryWarehousesList').innerHTML = warehousesHtml || '<p>Belum ada gudang.</p>';

  const movementRows = data.movements.map((movement) => `
    <div class="table-row inventory-movement-row">
      <span><span class="tag ${movement.movement_type === 'IN' ? 'approved' : 'pending'}">${movement.movement_type === 'IN' ? 'Masuk' : 'Keluar'}</span></span>
      <span><strong>${escapeHtml(movement.sku)}</strong><small>${escapeHtml(movement.item_name)}</small></span>
      <span>${escapeHtml(movement.quantity)} ${escapeHtml(movement.unit)}</span>
      <span>${escapeHtml(movement.warehouse_name)}</span>
      <span>Sisa ${escapeHtml(movement.balance_after)} ${escapeHtml(data.items.find((item) => item.sku === movement.sku)?.base_unit || movement.unit)}</span>
      <span>${escapeHtml(movement.reference || '-')}</span>
      <span>${escapeHtml(movement.created_by_name)} · ${escapeHtml(new Date(movement.created_at).toLocaleString('id-ID'))}</span>
    </div>
  `).join('');
  document.getElementById('inventoryMovementsTable').innerHTML = movementRows || '<p>Belum ada mutasi stok.</p>';

  document.querySelectorAll('[data-inventory-write]').forEach((section) => {
    section.hidden = !canWrite;
  });
}

function syncInventoryMovementUnits() {
  const itemId = document.querySelector('#inventoryMovementForm [name="item_id"]').value;
  const item = state.inventory?.items.find((entry) => String(entry.id) === itemId);
  const unitSelect = document.querySelector('#inventoryMovementForm [name="unit"]');
  const units = item ? [item.base_unit, ...(item.alternate_unit ? [item.alternate_unit] : [])] : [];
  unitSelect.innerHTML = units.map((unit) => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join('');
}

function syncCustomInventoryUnits() {
  const form = document.getElementById('inventoryItemForm');
  const baseIsCustom = form.elements.base_unit.value === 'LAINNYA';
  const alternateIsCustom = form.elements.alternate_unit.value === 'LAINNYA';
  const baseCustomField = form.querySelector('[data-custom-unit="base"]');
  const alternateCustomField = form.querySelector('[data-custom-unit="alternate"]');
  baseCustomField.hidden = !baseIsCustom;
  alternateCustomField.hidden = !alternateIsCustom;
  baseCustomField.querySelector('input').required = baseIsCustom;
  alternateCustomField.querySelector('input').required = alternateIsCustom;
}

function formatRequestItems(items) {
  return (items || []).map((item) =>
    `${escapeHtml(item.item_name)} — ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)} @ ${formatCurrency(item.estimated_unit_price)}`
  ).join('<br>');
}

function renderProcurement(data) {
  state.procurement = data;
  const loadMessage = document.getElementById('procurementLoadMessage');
  loadMessage.hidden = true;
  loadMessage.textContent = '';
  const canManage = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const isDirector = state.user?.role === 'DIREKTUR';
  document.getElementById('procurementSupplierCount').textContent =
    data.suppliers.filter((supplier) => supplier.is_active).length;
  const pendingRequests = data.requests.filter((request) =>
    ['submitted', 'under_review'].includes(request.status)
  );
  document.getElementById('procurementPendingCount').textContent = pendingRequests.length;
  document.getElementById('procurementPendingValue').textContent = formatCurrency(
    pendingRequests.reduce((sum, request) => sum + Number(request.total_estimate || 0), 0)
  );

  const bankField = document.querySelector('[data-supplier-bank]');
  bankField.hidden = !isDirector;
  document.querySelectorAll('[data-procurement-write]').forEach((section) => {
    section.hidden = state.user?.role === 'KOMISARIS';
  });
  document.querySelectorAll('[data-director-only]').forEach((section) => {
    section.hidden = !isDirector;
  });
  if (isDirector) {
    document.getElementById('procurementLimitForm').elements.manager_approval_limit.value =
      data.managerApprovalLimit || '0';
  }

  const categories = [...new Set(data.suppliers.map((supplier) => supplier.category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const filter = document.getElementById('supplierCategoryFilter');
  const oldFilter = filter.value;
  filter.innerHTML = '<option value="">Semua kategori</option>' + categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join('');
  if (categories.includes(oldFilter)) filter.value = oldFilter;
  renderSupplierRows();
  renderPurchaseRequestRows();
}

function renderSupplierRows() {
  if (!state.procurement) return;
  const query = document.getElementById('supplierSearch').value.trim().toLocaleLowerCase('id-ID');
  const category = document.getElementById('supplierCategoryFilter').value;
  const canManage = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const rows = state.procurement.suppliers
    .filter((supplier) => !category || supplier.category === category)
    .filter((supplier) => !query || [
      supplier.company_name, supplier.contact_name, supplier.category, supplier.city_province, supplier.email
    ].some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query)))
    .map((supplier) => {
      const digits = String(supplier.whatsapp || '').replace(/\D/g, '');
      const whatsappNumber = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
      const whatsappLink = whatsappNumber
        ? `<a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
        : '-';
      return `
        <div class="table-row supplier-row">
          <span><strong>${escapeHtml(supplier.supplier_code)}</strong><small>${escapeHtml(supplier.company_name)}</small></span>
          <span>${escapeHtml(supplier.contact_name || '-')}<small>${escapeHtml(supplier.phone || '-')}</small></span>
          <span>${escapeHtml(supplier.category || '-')}</span>
          <span>${escapeHtml(supplier.city_province || '-')}<small>${escapeHtml(supplier.email || '-')}</small></span>
          <span>${whatsappLink}</span>
          <span>${escapeHtml(supplier.payment_terms || '-')}<small>${supplier.lead_time_days == null ? '-' : `${Number(supplier.lead_time_days)} hari`}</small></span>
          ${state.user?.role === 'DIREKTUR' ? `<span>Rekening: ${escapeHtml(supplier.bank_details || '-')}</span>` : ''}
          <span><span class="tag ${supplier.is_active ? 'approved' : 'inactive'}">${supplier.is_active ? 'Aktif' : 'Nonaktif'}</span></span>
          ${canManage ? `<span><button class="mini-btn" type="button" data-edit-supplier="${Number(supplier.id)}">Ubah</button></span>` : ''}
        </div>
      `;
    }).join('');
  document.getElementById('suppliersTable').innerHTML = rows || '<p>Tidak ada supplier yang cocok.</p>';
}

function renderPurchaseRequestRows() {
  if (!state.procurement) return;
  const canApprove = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const canManage = canApprove;
  const currentUserId = String(state.user?.id || '');
  const rows = state.procurement.requests.map((request) => {
    const isPending = ['submitted', 'under_review'].includes(request.status);
    const canReview = canApprove && isPending && String(request.requester_id) !== currentUserId;
    const hasActiveOrder = state.procurement.purchaseOrders.some((order) =>
      Number(order.request_id) === Number(request.id)
      && ['pending_approval', 'issued'].includes(order.status)
    );
    const history = (request.approval_history || []).map((entry) => `
      <small>${escapeHtml(entry.approver_name)} · ${escapeHtml(entry.decision)} · ${escapeHtml(new Date(entry.created_at).toLocaleString('id-ID'))}${entry.note ? ` — ${escapeHtml(entry.note)}` : ''}</small>
    `).join('');
    const actions = canReview ? `
      <span class="inline-actions">
        <button class="mini-btn" type="button" data-pr-decision="under_review" data-id="${Number(request.id)}">Tinjau</button>
        <button class="mini-btn success" type="button" data-pr-decision="approved" data-id="${Number(request.id)}">Setujui</button>
        <button class="mini-btn danger" type="button" data-pr-decision="rejected" data-id="${Number(request.id)}">Tolak</button>
      </span>
    ` : '';
    const supplierOptions = state.procurement.suppliers
      .filter((supplier) => supplier.is_active)
      .map((supplier) => `<option value="${Number(supplier.id)}">${escapeHtml(supplier.supplier_code)} · ${escapeHtml(supplier.company_name)}</option>`)
      .join('');
    const quotationForm = canManage && request.status === 'approved' && !hasActiveOrder ? `
      <details class="quotation-entry">
        <summary>Catat penawaran supplier</summary>
        <form class="transaction-form" data-quotation-form data-request-id="${Number(request.id)}">
          <div class="form-grid">
            <label><span>Supplier</span><select name="supplier_id" required><option value="">Pilih supplier</option>${supplierOptions}</select></label>
            <label><span>Nomor penawaran</span><input name="supplier_quote_number" maxlength="100" /></label>
            <label><span>Berlaku sampai</span><input name="valid_until" type="date" /></label>
          </div>
          <div class="procurement-lines">
            ${(request.items || []).map((item) => `
              <label class="quotation-price-line">
                <span>${escapeHtml(item.item_name)} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</span>
                <input data-quote-price="${Number(item.id)}" type="number" min="0" step="0.01" value="0" required aria-label="Harga ${escapeHtml(item.item_name)}" />
              </label>
            `).join('')}
          </div>
          <label><span>Catatan penawaran</span><textarea name="notes" rows="2" maxlength="1000"></textarea></label>
          <button class="mini-btn success" type="submit">Simpan Penawaran</button>
        </form>
      </details>
    ` : '';
    const statusLabel = {
      submitted: 'Menunggu persetujuan',
      under_review: 'Sedang ditinjau',
      approved: 'Disetujui',
      rejected: 'Ditolak',
      converted_to_po: 'Menjadi PO',
      cancelled: 'Dibatalkan',
      draft: 'Draft'
    }[request.status] || request.status;
    return `
      <article class="procurement-request-row">
        <div class="procurement-request-heading">
          <div><strong>${escapeHtml(request.request_number)}</strong><small>${escapeHtml(request.requester_name)} · ${escapeHtml(request.division || 'Tanpa divisi')} · ${new Date(request.created_at).toLocaleDateString('id-ID')}</small></div>
          <span class="tag ${request.status === 'approved' ? 'approved' : request.status === 'rejected' ? 'inactive' : 'pending'}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="procurement-request-meta">
          <span>Kategori: ${escapeHtml(request.category)}</span>
          <span>Urgensi: ${escapeHtml(request.urgency)}</span>
          <span>Perkiraan: <strong>${formatCurrency(request.total_estimate)}</strong></span>
          <span>Dibutuhkan: ${request.needed_by ? new Date(`${request.needed_by}T00:00:00`).toLocaleDateString('id-ID') : '-'}</span>
        </div>
        <p>${formatRequestItems(request.items)}</p>
        <p>${escapeHtml(request.reason)}</p>
        ${request.project_name ? `<small>Proyek: ${escapeHtml(request.project_name)}</small>` : ''}
        ${request.rejection_reason ? `<p class="procurement-rejection">Alasan penolakan: ${escapeHtml(request.rejection_reason)}</p>` : ''}
        <div class="procurement-approval-history">${history || '<small>Belum ada riwayat persetujuan.</small>'}</div>
        ${actions}
        ${quotationForm}
      </article>
    `;
  }).join('');
  document.getElementById('purchaseRequestsTable').innerHTML = rows || '<p>Belum ada Purchase Request.</p>';
  renderQuotationRows();
  renderPurchaseOrderRows();
}

function renderQuotationRows() {
  if (!state.procurement) return;
  const canManage = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const orders = state.procurement.purchaseOrders || [];
  const rows = (state.procurement.quotations || []).map((quotation) => {
    const request = state.procurement.requests.find((item) => Number(item.id) === Number(quotation.request_id));
    const activeOrder = orders.some((order) =>
      Number(order.request_id) === Number(quotation.request_id)
      && ['pending_approval', 'issued'].includes(order.status)
    );
    const expired = quotation.valid_until
      && new Date(`${String(quotation.valid_until).slice(0, 10)}T00:00:00`) < new Date(new Date().toDateString());
    const canCreateOrder = canManage && request?.status === 'approved'
      && quotation.status === 'available' && !expired && !activeOrder;
    const statusLabel = quotation.status === 'selected'
      ? 'Dipilih untuk PO'
      : quotation.status === 'not_selected' ? 'Belum dipilih' : expired ? 'Kedaluwarsa' : 'Tersedia';
    return `
      <article class="procurement-request-row">
        <div class="procurement-request-heading">
          <div><strong>${escapeHtml(quotation.request_number)} · ${escapeHtml(quotation.supplier_code)}</strong><small>${escapeHtml(quotation.company_name)}${quotation.supplier_quote_number ? ` · Ref: ${escapeHtml(quotation.supplier_quote_number)}` : ''}</small></div>
          <span class="tag ${quotation.status === 'selected' ? 'approved' : expired ? 'inactive' : 'pending'}">${statusLabel}</span>
        </div>
        <div class="procurement-request-meta">
          <span>Total penawaran: <strong>${formatCurrency(quotation.total)}</strong></span>
          <span>Berlaku sampai: ${quotation.valid_until ? new Date(`${String(quotation.valid_until).slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID') : 'Tidak ditentukan'}</span>
        </div>
        <p>${formatRequestItems((quotation.items || []).map((item) => ({
          ...item,
          estimated_unit_price: item.unit_price
        })))}</p>
        ${quotation.notes ? `<p>${escapeHtml(quotation.notes)}</p>` : ''}
        ${canCreateOrder ? `<button class="mini-btn success" type="button" data-create-po data-request-id="${Number(quotation.request_id)}" data-quotation-id="${Number(quotation.id)}">Buat PO dari Penawaran</button>` : ''}
      </article>
    `;
  }).join('');
  document.getElementById('supplierQuotationsTable').innerHTML = rows || '<p>Belum ada penawaran supplier untuk PR yang disetujui.</p>';
}

function renderPurchaseOrderRows() {
  if (!state.procurement) return;
  const isDirector = state.user?.role === 'DIREKTUR';
  const currentUserId = String(state.user?.id || '');
  const rows = (state.procurement.purchaseOrders || []).map((order) => {
    const canDecide = isDirector && order.status === 'pending_approval'
      && String(order.created_by) !== currentUserId;
    const history = (order.approval_history || []).map((entry) => `
      <small>${escapeHtml(entry.approver_name)} · ${escapeHtml(entry.decision)} · ${escapeHtml(new Date(entry.created_at).toLocaleString('id-ID'))}${entry.note ? ` — ${escapeHtml(entry.note)}` : ''}</small>
    `).join('');
    const statusLabel = {
      pending_approval: 'Menunggu persetujuan Direktur',
      issued: 'Terbit',
      rejected: 'Ditolak',
      cancelled: 'Dibatalkan'
    }[order.status] || order.status;
    return `
      <article class="procurement-request-row">
        <div class="procurement-request-heading">
          <div><strong>${escapeHtml(order.po_number)} · ${escapeHtml(order.request_number)}</strong><small>${escapeHtml(order.supplier_code)} · ${escapeHtml(order.company_name)} · Dibuat ${escapeHtml(order.creator_name)}</small></div>
          <span class="tag ${order.status === 'issued' ? 'approved' : order.status === 'rejected' ? 'inactive' : 'pending'}">${statusLabel}</span>
        </div>
        <div class="procurement-request-meta"><span>Total PO: <strong>${formatCurrency(order.total)}</strong></span><span>${order.issued_at ? `Terbit ${new Date(order.issued_at).toLocaleString('id-ID')}` : 'Belum diterbitkan'}</span></div>
        <p>${formatRequestItems((order.items || []).map((item) => ({ ...item, estimated_unit_price: item.unit_price })))}</p>
        ${order.rejection_reason ? `<p class="procurement-rejection">Alasan penolakan: ${escapeHtml(order.rejection_reason)}</p>` : ''}
        <div class="procurement-approval-history">${history || '<small>Belum ada riwayat persetujuan.</small>'}</div>
        ${canDecide ? `
          <span class="inline-actions">
            <button class="mini-btn success" type="button" data-po-decision="approved" data-id="${Number(order.id)}">Setujui & Terbitkan</button>
            <button class="mini-btn danger" type="button" data-po-decision="rejected" data-id="${Number(order.id)}">Tolak PO</button>
          </span>
        ` : ''}
      </article>
    `;
  }).join('');
  document.getElementById('purchaseOrdersTable').innerHTML = rows || '<p>Belum ada Purchase Order.</p>';
}

function getAllowedViews(role) {
  const map = {
    DIREKTUR: ['dashboard', 'finance', 'inventory', 'procurement', 'documents', 'bonus', 'tasks', 'users', 'audit'],
    MANAGER: ['dashboard', 'inventory', 'procurement', 'bonus', 'tasks'],
    KOMISARIS: ['dashboard', 'finance', 'inventory', 'procurement', 'bonus', 'tasks'],
    KARYAWAN: ['dashboard', 'procurement', 'bonus', 'tasks']
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

  document.querySelectorAll('[data-finance-write]').forEach((section) => {
    section.hidden = !isDirector;
  });
  document.getElementById('financeReadOnlyNote').hidden = role !== 'KOMISARIS';
  document.querySelectorAll('[data-inventory-write]').forEach((section) => {
    section.hidden = !['DIREKTUR', 'MANAGER'].includes(role);
  });
  document.querySelectorAll('[data-procurement-write]').forEach((section) => {
    section.hidden = role === 'KOMISARIS';
  });
  document.querySelectorAll('[data-director-only]').forEach((section) => {
    section.hidden = !isDirector;
  });
  document.getElementById('directorQuickActions').classList.toggle('hidden', !isDirector);
  document.getElementById('companyDashboardContent').classList.toggle('hidden', !['DIREKTUR', 'KOMISARIS'].includes(role));
  document.getElementById('employeeDashboardNote').classList.toggle('hidden', ['DIREKTUR', 'KOMISARIS'].includes(role));

  if (financeView) {
    financeView.style.display = allowed.includes('finance') ? 'block' : 'none';
  }

  if (transactionForm) {
    transactionForm.querySelectorAll('input, select, textarea, button').forEach((element) => {
      element.disabled = !isDirector;
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
    inventory: 'Inventory',
    procurement: 'Pengadaan',
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

async function loadInventory() {
  try {
    const inventory = await apiFetch('/api/inventory');
    renderInventory(inventory);
  } catch (error) {
    const message = document.getElementById('inventoryLoadMessage');
    message.hidden = false;
    message.textContent = `Gagal memuat data inventory: ${error.message}`;
    throw error;
  }
}

async function loadProcurement() {
  try {
    const data = await apiFetch('/api/procurement');
    renderProcurement(data);
  } catch (error) {
    const message = document.getElementById('procurementLoadMessage');
    message.hidden = false;
    message.textContent = `Gagal memuat data pengadaan: ${error.message}`;
    throw error;
  }
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
        await Promise.all([loadFinance(), loadInventory(), loadProcurement(), loadDocuments(), loadBonus(), loadUsers(), loadAudit(), loadTasks()]);
      } else {
        const tasks = [loadBonus(), loadTasks()];
        if (getAllowedViews(state.user.role).includes('finance')) tasks.push(loadFinance());
        if (getAllowedViews(state.user.role).includes('inventory')) tasks.push(loadInventory());
        if (getAllowedViews(state.user.role).includes('procurement')) tasks.push(loadProcurement());
        await Promise.all(tasks);
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

document.addEventListener('submit', async (event) => {
  const quotationForm = event.target.closest('[data-quotation-form]');
  if (!quotationForm) return;
  event.preventDefault();
  const button = quotationForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(quotationForm).entries());
  values.items = [...quotationForm.querySelectorAll('[data-quote-price]')].map((input) => ({
    request_item_id: Number(input.dataset.quotePrice),
    unit_price: input.value
  }));
  try {
    await apiFetch(`/api/procurement/requests/${Number(quotationForm.dataset.requestId)}/quotations`, {
      method: 'POST',
      body: JSON.stringify(values)
    });
    await refreshData();
    alert('Penawaran supplier berhasil dicatat.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
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

const supplierForm = document.getElementById('supplierForm');
const purchaseRequestForm = document.getElementById('purchaseRequestForm');
const procurementLimitForm = document.getElementById('procurementLimitForm');
const purchaseRequestItems = document.getElementById('purchaseRequestItems');

document.getElementById('supplierSearch').addEventListener('input', renderSupplierRows);
document.getElementById('supplierCategoryFilter').addEventListener('change', renderSupplierRows);
document.getElementById('cancelSupplierEdit').addEventListener('click', () => {
  supplierForm.reset();
  supplierForm.elements.supplier_id.value = '';
  supplierForm.querySelector('button[type="submit"]').textContent = 'Simpan Supplier';
  document.getElementById('cancelSupplierEdit').hidden = true;
});

supplierForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const supplierId = values.supplier_id;
    delete values.supplier_id;
    if (supplierId) values.is_active = values.is_active === 'true';
    else delete values.is_active;
    await apiFetch(
      supplierId ? `/api/procurement/suppliers/${Number(supplierId)}` : '/api/procurement/suppliers',
      { method: supplierId ? 'PATCH' : 'POST', body: JSON.stringify(values) }
    );
    form.reset();
    form.elements.supplier_id.value = '';
    button.textContent = 'Simpan Supplier';
    document.getElementById('cancelSupplierEdit').hidden = true;
    await refreshData();
    alert(supplierId ? 'Data supplier diperbarui.' : 'Supplier berhasil ditambahkan.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('addPurchaseRequestItem').addEventListener('click', () => {
  if (purchaseRequestItems.children.length >= 30) {
    alert('Satu PR maksimal berisi 30 barang.');
    return;
  }
  const row = purchaseRequestItems.querySelector('[data-request-line]').cloneNode(true);
  row.querySelectorAll('input').forEach((input) => {
    input.value = '';
  });
  row.querySelector('[data-remove-request-line]').hidden = false;
  purchaseRequestItems.append(row);
});

purchaseRequestItems.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-request-line]');
  if (!removeButton || purchaseRequestItems.children.length <= 1) return;
  removeButton.closest('[data-request-line]').remove();
});

purchaseRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(form).entries());
  values.items = [...purchaseRequestItems.querySelectorAll('[data-request-line]')].map((row) => ({
    item_name: row.querySelector('[data-line-name]').value,
    quantity: row.querySelector('[data-line-quantity]').value,
    unit: row.querySelector('[data-line-unit]').value,
    estimated_unit_price: row.querySelector('[data-line-price]').value
  }));
  try {
    const result = await apiFetch('/api/procurement/requests', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    form.reset();
    purchaseRequestItems.innerHTML = `
      <div class="procurement-line" data-request-line>
        <label><span>Nama barang</span><input data-line-name maxlength="160" required /></label>
        <label><span>Jumlah</span><input data-line-quantity type="number" min="0.000001" step="0.000001" required /></label>
        <label><span>Satuan</span><input data-line-unit maxlength="20" placeholder="Kg / unit..." required /></label>
        <label><span>Harga estimasi per satuan</span><input data-line-price type="number" min="0" step="0.01" value="0" required /></label>
        <button class="mini-btn danger" type="button" data-remove-request-line hidden>Hapus</button>
      </div>
    `;
    await refreshData();
    alert(`PR ${result.request_number} berhasil diajukan.`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

procurementLimitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    await apiFetch('/api/procurement/settings/manager-approval-limit', {
      method: 'PUT',
      body: JSON.stringify(values)
    });
    await refreshData();
    alert('Batas persetujuan Manager berhasil diperbarui.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const editSupplierButton = event.target.closest('[data-edit-supplier]');
  if (editSupplierButton) {
    const supplier = state.procurement?.suppliers.find(
      (entry) => Number(entry.id) === Number(editSupplierButton.dataset.editSupplier)
    );
    if (!supplier) return;
    for (const [key, value] of Object.entries(supplier)) {
      if (supplierForm.elements[key]) supplierForm.elements[key].value = value ?? '';
    }
    supplierForm.elements.supplier_id.value = String(supplier.id);
    supplierForm.querySelector('button[type="submit"]').textContent = 'Perbarui Supplier';
    document.getElementById('cancelSupplierEdit').hidden = false;
    supplierForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const createOrderButton = event.target.closest('[data-create-po]');
  if (createOrderButton) {
    if (!window.confirm('Buat Purchase Order dari penawaran ini? Jika dibuat Manager, PO akan menunggu persetujuan Direktur.')) return;
    createOrderButton.disabled = true;
    try {
      const result = await apiFetch(
        `/api/procurement/requests/${Number(createOrderButton.dataset.requestId)}/purchase-orders`,
        {
          method: 'POST',
          body: JSON.stringify({ quotation_id: Number(createOrderButton.dataset.quotationId) })
        }
      );
      await refreshData();
      alert(result.status === 'issued' ? `PO ${result.po_number} berhasil diterbitkan.` : `PO ${result.po_number} menunggu persetujuan Direktur.`);
    } catch (error) {
      alert(error.message);
    } finally {
      createOrderButton.disabled = false;
    }
    return;
  }

  const orderDecisionButton = event.target.closest('[data-po-decision]');
  if (orderDecisionButton) {
    const decision = orderDecisionButton.dataset.poDecision;
    const note = decision === 'rejected'
      ? window.prompt('Tuliskan alasan penolakan PO:')
      : '';
    if (note === null || (decision === 'rejected' && note.trim().length < 3)) {
      if (decision === 'rejected' && note !== null) alert('Alasan penolakan minimal 3 karakter.');
      return;
    }
    orderDecisionButton.disabled = true;
    try {
      await apiFetch(`/api/procurement/purchase-orders/${Number(orderDecisionButton.dataset.id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: note.trim() })
      });
      await refreshData();
      alert(decision === 'approved' ? 'PO disetujui dan diterbitkan.' : 'PO ditolak. Penawaran dapat dipilih ulang.');
    } catch (error) {
      alert(error.message);
    } finally {
      orderDecisionButton.disabled = false;
    }
    return;
  }

  const decisionButton = event.target.closest('[data-pr-decision]');
  if (!decisionButton) return;
  const decision = decisionButton.dataset.prDecision;
  const promptText = decision === 'rejected'
    ? 'Tuliskan alasan penolakan PR:'
    : decision === 'under_review'
      ? 'Catatan untuk memulai peninjauan (opsional):'
      : 'Catatan persetujuan (opsional):';
  const note = window.prompt(promptText);
  if (note === null || (decision === 'rejected' && note.trim().length < 3)) {
    if (decision === 'rejected' && note !== null) alert('Alasan penolakan minimal 3 karakter.');
    return;
  }
  decisionButton.disabled = true;
  try {
    await apiFetch(`/api/procurement/requests/${Number(decisionButton.dataset.id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: note.trim() })
    });
    await refreshData();
    alert(decision === 'approved' ? 'PR berhasil disetujui.' : decision === 'rejected' ? 'PR ditolak.' : 'PR masuk ke tahap peninjauan.');
  } catch (error) {
    alert(error.message);
  } finally {
    decisionButton.disabled = false;
  }
});

const inventoryItemForm = document.getElementById('inventoryItemForm');
const inventoryCategoryForm = document.getElementById('inventoryCategoryForm');
const inventoryWarehouseForm = document.getElementById('inventoryWarehouseForm');
const inventoryMovementForm = document.getElementById('inventoryMovementForm');
const inventoryEditDialog = document.getElementById('inventoryEditDialog');
const inventoryEditForm = document.getElementById('inventoryEditForm');
const inventoryMovementType = inventoryMovementForm.elements.movement_type;

inventoryMovementForm.elements.idempotency_key.value = crypto.randomUUID();
document.querySelector('#inventoryMovementForm [name="item_id"]').addEventListener('change', () => {
  syncInventoryMovementUnits();
  const selectedItem = state.inventory?.items.find(
    (item) => String(item.id) === inventoryMovementForm.elements.item_id.value
  );
  if (selectedItem?.default_warehouse_id) {
    inventoryMovementForm.elements.warehouse_id.value = String(selectedItem.default_warehouse_id);
  }
});
inventoryMovementType.addEventListener('change', () => {
  document.querySelector('[data-inventory-cost]').hidden = inventoryMovementType.value !== 'IN';
});
inventoryItemForm.elements.base_unit.addEventListener('change', syncCustomInventoryUnits);
inventoryItemForm.elements.alternate_unit.addEventListener('change', syncCustomInventoryUnits);

inventoryItemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.base_unit === 'LAINNYA') values.base_unit = values.base_unit_other;
    if (values.alternate_unit === 'LAINNYA') values.alternate_unit = values.alternate_unit_other;
    delete values.base_unit_other;
    delete values.alternate_unit_other;
    await apiFetch('/api/inventory/items', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    syncCustomInventoryUnits();
    await refreshData();
    alert('Barang berhasil ditambahkan.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

inventoryCategoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    await apiFetch('/api/inventory/categories', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

inventoryWarehouseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    await apiFetch('/api/inventory/warehouses', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

inventoryMovementForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.movement_type === 'OUT') values.unit_cost = '0';
    await apiFetch('/api/inventory/movements', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    form.elements.idempotency_key.value = crypto.randomUUID();
    document.querySelector('[data-inventory-cost]').hidden = false;
    await refreshData();
    alert('Mutasi stok berhasil dicatat.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-inventory-edit]')) {
    inventoryEditDialog.close();
    return;
  }
  const button = event.target.closest('[data-inventory-edit]');
  if (!button) return;
  const type = button.dataset.inventoryEdit;
  const id = Number(button.dataset.id);
  const record = type === 'item'
    ? state.inventory?.items.find((item) => Number(item.id) === id)
    : type === 'category'
      ? state.inventory?.categories.find((category) => Number(category.id) === id)
      : state.inventory?.warehouses.find((warehouse) => Number(warehouse.id) === id);
  if (!record) return;

  inventoryEditForm.reset();
  inventoryEditForm.elements.object_type.value = type;
  inventoryEditForm.elements.object_id.value = String(id);
  inventoryEditForm.elements.name.value = record.name;
  inventoryEditForm.elements.is_active.value = String(record.is_active);
  document.getElementById('inventoryEditTitle').textContent = `Ubah ${type === 'item' ? 'Barang' : type === 'category' ? 'Kategori' : 'Gudang'}`;
  document.getElementById('inventoryEditNameLabel').textContent = type === 'item' ? 'Nama barang' : type === 'category' ? 'Nama kategori' : 'Nama gudang';
  document.getElementById('inventoryEditDetailsLabel').textContent = type === 'warehouse' ? 'Lokasi' : 'Deskripsi';
  document.querySelector('[data-inventory-edit-details]').hidden = false;
  inventoryEditForm.elements.details.value = type === 'warehouse' ? record.location : record.description;
  const itemFields = document.querySelector('[data-inventory-edit-item]');
  itemFields.hidden = type !== 'item';
  if (type === 'item') {
    const categorySelect = inventoryEditForm.elements.category_id;
    const warehouseSelect = inventoryEditForm.elements.default_warehouse_id;
    categorySelect.innerHTML = state.inventory.categories
      .map((category) => `<option value="${Number(category.id)}" ${String(category.id) === String(record.category_id) ? 'selected' : ''}>${escapeHtml(category.name)}${category.is_active ? '' : ' (nonaktif)'}</option>`)
      .join('');
    warehouseSelect.innerHTML = '<option value="">Tidak ditentukan</option>' + state.inventory.warehouses
      .map((warehouse) => `<option value="${Number(warehouse.id)}" ${String(warehouse.id) === String(record.default_warehouse_id) ? 'selected' : ''}>${escapeHtml(warehouse.name)}${warehouse.is_active ? '' : ' (nonaktif)'}</option>`)
      .join('');
    categorySelect.value = String(record.category_id);
    warehouseSelect.value = record.default_warehouse_id ? String(record.default_warehouse_id) : '';
    inventoryEditForm.elements.min_stock.value = record.min_stock;
    inventoryEditForm.elements.max_stock.value = record.max_stock ?? '';
    inventoryEditForm.elements.reference_price.value = record.reference_price;
  }
  inventoryEditDialog.showModal();
});

inventoryEditForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = inventoryEditForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(inventoryEditForm).entries());
  const type = values.object_type;
  const id = Number(values.object_id);
  const payload = {
    name: values.name,
    is_active: values.is_active === 'true'
  };
  if (type === 'category') payload.description = values.details;
  if (type === 'warehouse') payload.location = values.details;
  if (type === 'item') {
    payload.description = values.details;
    payload.category_id = values.category_id;
    payload.default_warehouse_id = values.default_warehouse_id;
    payload.min_stock = values.min_stock;
    payload.max_stock = values.max_stock;
    payload.reference_price = values.reference_price;
  }
  try {
    const collection = type === 'item' ? 'items' : type === 'category' ? 'categories' : 'warehouses';
    await apiFetch(`/api/inventory/${collection}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    inventoryEditDialog.close();
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
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
