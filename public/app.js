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
  procurement: null,
  fieldReports: [],
  fieldDashboard: null,
  fieldReferences: null,
  fieldNotifications: [],
  fieldTab: 'dashboard',
  galleryMode: 'grid',
  fieldHistoryArchived: false,
  fieldPhotos: []
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
  const canViewFinance = ['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(state.user?.role);
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
        { key: 'pendingTasks', label: 'Pekerjaan Menunggu Pemeriksaan Direktur', value: data?.summary?.pendingVerification ?? 0, format: 'number' },
        { key: 'approvedTasks', label: 'Pekerjaan Disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' },
        { key: 'bonuses', label: 'Total Bonus Karyawan', value: data?.summary?.totalBonus ?? 0, format: 'currency' }
      ] : [
        { key: 'assignedTasks', label: 'Tugas ditugaskan', value: data?.summary?.assignedTasks ?? 0, format: 'number' },
        { key: 'inProgressTasks', label: 'Dalam pengerjaan', value: data?.summary?.inProgressTasks ?? 0, format: 'number' },
        { key: 'waitingTasks', label: 'Menunggu pemeriksaan Direktur', value: data?.summary?.waitingTasks ?? 0, format: 'number' },
        { key: 'approvedTasks', label: 'Selesai disetujui', value: data?.summary?.approvedTasks ?? 0, format: 'number' }
      ])
    ]
    : [
      { key: 'assignedTasks', label: 'Tugas ditugaskan', value: data?.summary?.assignedTasks ?? 0, format: 'number' },
      { key: 'inProgressTasks', label: 'Dalam pengerjaan', value: data?.summary?.inProgressTasks ?? 0, format: 'number' },
      { key: 'waitingTasks', label: 'Menunggu pemeriksaan Direktur', value: data?.summary?.waitingTasks ?? 0, format: 'number' },
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
      in_review: 'Menunggu pemeriksaan Direktur',
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
  const canViewFinance = ['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(state.user?.role);
  const labels = {
    balance: 'Total Saldo',
    income: 'Total Pemasukan',
    expense: 'Total Pengeluaran',
    transactions: 'Total Transaksi',
    pendingTasks: 'Pekerjaan Menunggu Pemeriksaan Direktur',
    approvedTasks: 'Pekerjaan Disetujui',
    bonuses: 'Total Bonus Karyawan',
    assignedTasks: 'Tugas ditugaskan',
    inProgressTasks: 'Dalam pengerjaan',
    waitingTasks: 'Menunggu pemeriksaan Direktur'
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
            <span>${state.user?.role === 'DIREKTUR' ? `${escapeHtml(bonus.assignee_name || '-')} · ` : ''}${bonus.status === 'approved' ? 'Disetujui' : bonus.status === 'in_review' ? 'Menunggu pemeriksaan Direktur' : 'Belum disetujui'}</span>
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
  const canEdit = ['DIREKTUR', 'MANAGER'].includes(state.user?.role);
  const canDelete = state.user?.role === 'DIREKTUR';
  const rows = (transactions || []).map(tx => `
    <div class="table-row">
      <span>${escapeHtml(tx.project_name)}</span>
      <span><span class="tag ${tx.archived_at ? 'inactive' : tx.type}">${tx.archived_at ? 'Diarsipkan' : tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span></span>
      <span>${formatCurrency(tx.amount)}</span>
      <span>${escapeHtml(tx.counterparty)}</span>
      <span>${escapeHtml(tx.created_by_name ?? '-')}</span>
      <span>${tx.archived_at ? 'Lampiran tersimpan' : tx.has_attachment ? `<a href="/api/transactions/${Number(tx.id)}/attachment" target="_blank" rel="noreferrer">Buka lampiran</a>` : 'Tanpa lampiran'}</span>
      ${canEdit || canDelete ? `<span class="inline-actions">
        ${tx.archived_at
          ? canDelete ? `<button class="mini-btn" type="button" data-restore-transaction="${Number(tx.id)}">Pulihkan</button>` : ''
          : `${canEdit ? `<button class="mini-btn" type="button" data-edit-transaction="${Number(tx.id)}">Edit</button>` : ''}
             ${canDelete ? `<button class="mini-btn danger" type="button" data-delete-transaction="${Number(tx.id)}">Arsipkan</button>` : ''}`}
      </span>` : ''}
    </div>
  `).join('');
  target.innerHTML = rows || '<p>Belum ada transaksi.</p>';
}

function renderTaskTable(tasks) {
  const target = document.getElementById('taskTable');
  target.querySelectorAll('[data-task-local-photo]').forEach((image) => URL.revokeObjectURL(image.src));
  const canVerify = state.user?.role === 'DIREKTUR';
  const isDirector = canVerify;
  const isEmployee = state.user?.role === 'KARYAWAN';
  document.getElementById('taskListHeading').textContent = canVerify ? 'Semua pekerjaan' : 'Pekerjaan saya';

  const rows = (tasks || []).map(task => {
    const progress = Math.max(0, Math.min(100, Number(task.progress_percent) || 0));
    const statusLabels = {
      pending: 'Belum selesai',
      in_review: 'Menunggu pemeriksaan Direktur',
      approved: 'Disetujui',
      rejected: 'Perlu diperbaiki'
    };
    const status = task.archived_at ? 'archived' : ['pending', 'in_review', 'approved', 'rejected'].includes(task.status) ? task.status : 'pending';
    const verificationActions = canVerify && status === 'in_review'
      ? `<div class="inline-actions task-verification-actions">
          <button class="mini-btn success" data-task-action="approved" data-task-id="${Number(task.id)}" data-task-bonus="${Number(task.bonus_amount || 0)}">Setujui hasil</button>
          <button class="mini-btn danger" data-task-action="rejected" data-task-id="${Number(task.id)}">Minta perbaikan</button>
        </div>`
      : '';
    const progressForm = !canVerify && !['approved', 'in_review', 'archived'].includes(status)
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
          <label>
            <span>Foto bukti update (wajib, 1–4 foto)</span>
            <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" capture="environment" multiple required data-task-progress-photos />
            <small class="field-help">Ambil foto atau pilih dari galeri. Foto dikompres otomatis, maksimal 1 MB per foto.</small>
          </label>
          <div class="task-photo-preview" data-task-photo-preview aria-live="polite"></div>
          <button class="primary-btn small" type="submit">Kirim update pekerjaan</button>
        </form>`
      : '';
    const reviewNote = !canVerify && status === 'in_review'
      ? '<p class="task-waiting-review">“Menunggu pemeriksaan Direktur” berarti progres 100% beserta hasil dan foto bukti sudah dikirim. Hanya Direktur yang dapat menyetujui hasil atau meminta perbaikan. Update baru dapat dikirim setelah keputusan.</p>'
      : '';
    const directorActions = isDirector ? `
      <div class="inline-actions">
        ${task.archived_at
          ? `<button class="mini-btn success" type="button" data-task-archive="restore" data-task-id="${Number(task.id)}">Pulihkan</button>`
          : `<button class="mini-btn" type="button" data-edit-task="${Number(task.id)}">Edit</button>
             <button class="mini-btn danger" type="button" data-task-archive="archive" data-task-id="${Number(task.id)}">Arsipkan</button>`}
      </div>
    ` : '';

    return `
      <article class="task-card">
        <div class="task-card-heading">
          <div>
            <h4>${escapeHtml(task.title)}</h4>
            ${canVerify ? `<p class="task-assignee">Ditugaskan kepada ${escapeHtml(task.assignee_name || '-')}</p>` : ''}
          </div>
          <span class="tag ${status}">${status === 'archived' ? 'Diarsipkan' : statusLabels[status]}</span>
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
          ${['approved', 'rejected'].includes(status) && task.verifier_name ? `<span>Keputusan oleh: <strong>${escapeHtml(task.verifier_name)} · Direktur</strong></span>` : ''}
          ${canVerify ? `<span>Bonus tugas: <strong>${formatCurrency(task.bonus_amount ?? 0)}</strong></span>` : ''}
        </div>
        <details class="task-history">
          <summary data-task-history="${Number(task.id)}">Lihat riwayat progres</summary>
          <div class="task-history-list" data-task-updates="${Number(task.id)}"><span class="field-help">Buka untuk memuat riwayat.</span></div>
        </details>
        ${progressForm}
        ${reviewNote}
        ${verificationActions}
        ${directorActions}
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
  const isDirector = state.user?.role === 'DIREKTUR';
  const rows = (documents || []).map(doc => `
    <div class="table-row">
      <span>${escapeHtml(doc.title)}${doc.archived_at ? ' · Diarsipkan' : ''}</span>
      <span>${escapeHtml(doc.category)}</span>
      <span>${escapeHtml(doc.uploaded_by_name || '-')}</span>
      <span>${doc.archived_at ? 'File tersimpan' : doc.has_file ? `<a href="/api/documents/${Number(doc.id)}/download" target="_blank" rel="noreferrer">Buka file</a>` : 'Tanpa file'}</span>
      ${isDirector ? `<span class="inline-actions">
        ${doc.archived_at
          ? `<button class="mini-btn" type="button" data-restore-document="${Number(doc.id)}">Pulihkan</button>`
          : `<button class="mini-btn" type="button" data-edit-document="${Number(doc.id)}">Edit</button>
             <button class="mini-btn danger" type="button" data-archive-document="${Number(doc.id)}">Arsipkan</button>`}
      </span>` : ''}
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
  const canEdit = state.user?.role === 'DIREKTUR';
  const tableRows = (rows || []).map(row => `
    <div class="table-row">
      <span>${escapeHtml(row.title)}</span>
      <span>${escapeHtml(row.assignee_name || '-')}</span>
      <span>${canEdit
        ? `<input type="number" min="0" step="0.01" value="${Number(row.bonus_amount || 0)}" data-bonus-amount="${Number(row.id)}" aria-label="Nominal bonus ${escapeHtml(row.title)}" />`
        : formatCurrency(row.bonus_amount || 0)}</span>
      <span><span class="tag ${row.status || 'pending'}">${row.status || 'pending'}</span></span>
      ${canEdit ? `<span><button class="mini-btn" type="button" data-save-bonus="${Number(row.id)}">Simpan bonus</button></span>` : ''}
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
  const isDirector = state.user?.role === 'DIREKTUR';
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
    const directorActions = isDirector && !['converted_to_po', 'cancelled'].includes(request.status) ? `
      <span class="inline-actions">
        <button class="mini-btn" type="button" data-edit-request="${Number(request.id)}">Edit PR</button>
        <button class="mini-btn danger" type="button" data-cancel-request="${Number(request.id)}">Batalkan PR</button>
      </span>
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
        ${directorActions}
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
    const isDirector = state.user?.role === 'DIREKTUR';
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
        ${isDirector && quotation.status !== 'selected' && !activeOrder ? `
          <details class="quotation-entry">
            <summary>Edit penawaran</summary>
            <form class="transaction-form" data-quotation-edit-form data-quotation-id="${Number(quotation.id)}">
              <div class="form-grid">
                <label><span>Supplier</span><select name="supplier_id" required>
                  ${state.procurement.suppliers.filter((supplier) => supplier.is_active).map((supplier) => `<option value="${Number(supplier.id)}" ${Number(supplier.id) === Number(quotation.supplier_id) ? 'selected' : ''}>${escapeHtml(supplier.supplier_code)} · ${escapeHtml(supplier.company_name)}</option>`).join('')}
                </select></label>
                <label><span>Nomor penawaran</span><input name="supplier_quote_number" maxlength="100" value="${escapeHtml(quotation.supplier_quote_number || '')}" /></label>
                <label><span>Berlaku sampai</span><input name="valid_until" type="date" value="${escapeHtml(quotation.valid_until ? String(quotation.valid_until).slice(0, 10) : '')}" /></label>
              </div>
              <div class="procurement-lines">${(quotation.items || []).map((item) => `
                <label class="quotation-price-line"><span>${escapeHtml(item.item_name)} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</span>
                  <input data-quote-price="${Number(item.request_item_id)}" type="number" min="0" step="0.01" value="${escapeHtml(item.unit_price)}" required />
                </label>`).join('')}
              </div>
              <label><span>Catatan penawaran</span><textarea name="notes" rows="2" maxlength="1000">${escapeHtml(quotation.notes || '')}</textarea></label>
              <button class="mini-btn success" type="submit">Simpan Perubahan Penawaran</button>
            </form>
          </details>
        ` : ''}
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
        ${isDirector && ['pending_approval', 'issued'].includes(order.status) ? `<button class="mini-btn danger" type="button" data-cancel-order="${Number(order.id)}">Batalkan PO</button>` : ''}
      </article>
    `;
  }).join('');
  document.getElementById('purchaseOrdersTable').innerHTML = rows || '<p>Belum ada Purchase Order.</p>';
}

function getAllowedViews(role) {
  const map = {
    DIREKTUR: ['dashboard', 'finance', 'inventory', 'procurement', 'documents', 'fieldMonitoring', 'bonus', 'tasks', 'users', 'audit'],
    MANAGER: ['dashboard', 'finance', 'inventory', 'procurement', 'fieldMonitoring', 'bonus', 'tasks'],
    KOMISARIS: ['dashboard', 'finance', 'inventory', 'procurement', 'fieldMonitoring', 'bonus', 'tasks'],
    KARYAWAN: ['dashboard', 'procurement', 'fieldMonitoring', 'bonus', 'tasks']
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
  const canUploadFieldReport = ['DIREKTUR', 'KARYAWAN'].includes(role);

  document.querySelectorAll('[data-finance-write]').forEach((section) => {
    section.hidden = !['DIREKTUR', 'MANAGER'].includes(role);
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
  document.getElementById('companyDashboardContent').classList.toggle('hidden', !['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(role));
  document.getElementById('employeeDashboardNote').classList.toggle('hidden', ['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(role));

  if (financeView) {
    financeView.style.display = allowed.includes('finance') ? 'block' : 'none';
  }

  if (transactionForm) {
    transactionForm.querySelectorAll('input, select, textarea, button').forEach((element) => {
      element.disabled = !['DIREKTUR', 'MANAGER'].includes(role);
    });
  }

  if (documentForm) {
    documentForm.querySelectorAll('input, textarea, button').forEach((element) => {
      element.disabled = !allowed.includes('documents');
    });
  }

  document.getElementById('fieldUploadPanel').hidden = !canUploadFieldReport;
  document.getElementById('fieldRevisionPanel').classList.toggle('hidden', role !== 'KARYAWAN');
  document.getElementById('fieldReportExport').classList.toggle('hidden', !['DIREKTUR', 'KOMISARIS'].includes(role));
  document.getElementById('toggleFieldArchive').classList.toggle('hidden', !isDirector);
  document.querySelectorAll('[data-field-tab="dashboard"]').forEach((tab) => {
    tab.hidden = role === 'KARYAWAN';
  });
  document.querySelectorAll('[data-field-manager-reference]').forEach((field) => {
    field.hidden = !['DIREKTUR', 'MANAGER'].includes(role);
  });

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
    fieldMonitoring: 'FIELD MONITORING',
    bonus: 'Bonus',
    tasks: 'Pekerjaan',
    users: 'Pengguna',
    audit: 'Audit'
  }[safeView];

  state.currentView = safeView;
  if (safeView === 'fieldMonitoring') {
    setFieldTab(state.fieldTab || (role === 'KARYAWAN' ? 'activity' : 'dashboard'));
  }
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
      ? data.error || 'Ukuran file atau request terlalu besar. Kompres file lalu coba kembali.'
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

function formatFieldDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function fieldStatusLabel(status) {
  return {
    pending: 'Menunggu Pemeriksaan',
    reviewed: 'Sudah Diperiksa',
    needs_revision: 'Perlu Perbaikan'
  }[status] || status;
}

function renderFieldReferences() {
  const refs = state.fieldReferences;
  if (!refs) return;
  const categorySelect = document.querySelector('#fieldReportForm [name="category"]');
  const filterCategory = document.querySelector('#fieldMonitoringFilter [name="category"]');
  const selectedFilterCategory = filterCategory.value;
  const selectedUploader = document.querySelector('#fieldMonitoringFilter [name="uploader"]').value;
  categorySelect.innerHTML = '<option value="">Pilih kategori</option>' + refs.categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  filterCategory.innerHTML = '<option value="">Semua kategori</option>' + refs.categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  filterCategory.value = selectedFilterCategory;
  document.querySelector('#fieldReportForm [name="task_id"]').innerHTML = '<option value="">Tidak dikaitkan</option>' + refs.tasks
    .map((task) => `<option value="${Number(task.id)}">${escapeHtml(task.title)} · ${escapeHtml(task.status)}</option>`).join('');
  document.querySelector('#fieldReportForm [name="inventory_item_id"]').innerHTML = '<option value="">Tidak dikaitkan</option>' + refs.inventoryItems
    .map((item) => `<option value="${Number(item.id)}">${escapeHtml(item.sku)} · ${escapeHtml(item.name)}</option>`).join('');
  document.querySelector('#fieldReportForm [name="warehouse_id"]').innerHTML = '<option value="">Tidak dikaitkan</option>' + refs.warehouses
    .map((warehouse) => `<option value="${Number(warehouse.id)}">${escapeHtml(warehouse.name)}</option>`).join('');
  document.querySelector('#fieldReportForm [name="purchase_request_id"]').innerHTML = '<option value="">Tidak dikaitkan</option>' + refs.purchaseRequests
    .map((request) => `<option value="${Number(request.id)}">${escapeHtml(request.request_number)} · ${escapeHtml(request.category)}</option>`).join('');
  const monthSelect = document.querySelector('#fieldMonitoringFilter [name="month"]');
  monthSelect.innerHTML = '<option value="">Semua bulan</option>' + Array.from({ length: 12 }, (_, index) =>
    `<option value="${index + 1}">${new Date(2026, index, 1).toLocaleDateString('id-ID', { month: 'long' })}</option>`
  ).join('');
  document.querySelector('#fieldMonitoringFilter [name="uploader"]').innerHTML = '<option value="">Semua karyawan</option>' + [...new Map(
    state.fieldReports.map((report) => [String(report.uploader_id), report.uploader_name])
  )].map(([id, name]) => `<option value="${Number(id)}">${escapeHtml(name)}</option>`).join('');
  document.querySelector('#fieldMonitoringFilter [name="uploader"]').value = selectedUploader;
}

function renderFieldDashboard(data) {
  const totals = data?.totals || {};
  const cards = [
    ['Total dokumentasi', totals.total || 0],
    ['Dokumentasi hari ini', totals.today || 0],
    ['Dokumentasi minggu ini', totals.this_week || 0],
    ['Dokumentasi bulan ini', totals.this_month || 0],
    ['Menunggu pemeriksaan', totals.pending_review || 0],
    ['Perlu perbaikan', totals.needs_revision || 0]
  ];
  document.getElementById('fieldMonitoringSummary').innerHTML = cards.map(([label, value]) => `
    <div class="summary-card"><span class="label">${escapeHtml(label)}</span><p class="value">${Number(value).toLocaleString('id-ID')}</p></div>
  `).join('');
  document.getElementById('fieldCategorySummary').innerHTML = (data?.categories || []).map((item) => `
    <div class="field-breakdown-row"><span>${escapeHtml(item.category)}</span><strong>${Number(item.count)}</strong></div>
  `).join('') || '<p>Belum ada dokumentasi.</p>';
  document.getElementById('fieldEmployeeSummary').innerHTML = (data?.employees || []).map((item) => `
    <div class="field-breakdown-row"><span>${escapeHtml(item.name)}</span><strong>${Number(item.count)}</strong></div>
  `).join('') || '<p>Belum ada aktivitas karyawan.</p>';
  document.getElementById('fieldRecentActivity').innerHTML = (data?.recent || []).map((report) => `
    <button class="field-activity-row" type="button" data-open-field-report="${Number(report.id)}">
      <span><strong>${escapeHtml(report.title)}</strong><small>${escapeHtml(report.uploader_name)} · ${escapeHtml(report.category)}</small></span>
      <span>${formatFieldDate(report.created_at)} · ${Number(report.photo_count)} foto</span>
    </button>
  `).join('') || '<p>Belum ada aktivitas lapangan.</p>';
  document.getElementById('fieldDashboardRecentGallery').innerHTML = (data?.recent || []).filter((report) => report.first_photo_id).map((report) => `
    <article class="field-dashboard-photo">
      <img src="/api/field-monitoring/photos/${Number(report.first_photo_id)}/preview" loading="lazy" alt="${escapeHtml(report.title)}" />
      <div><strong>${escapeHtml(report.title)}</strong><span>${escapeHtml(report.uploader_name)} · ${formatFieldDate(report.created_at)}</span></div>
    </article>
  `).join('') || '<p>Belum ada foto terbaru.</p>';
}

function fieldReportCard(report, context = 'activity') {
  const isDirector = state.user?.role === 'DIREKTUR';
  const isManager = state.user?.role === 'MANAGER';
  const isOwner = String(report.uploader_id) === String(state.user?.id);
  const canAct = context === 'activity';
  const firstPhoto = report.photos?.[0];
  const related = [report.task_title, report.inventory_item_name, report.warehouse_name, report.request_number].filter(Boolean).join(' · ');
  const photoButtons = (report.photos || []).slice(0, 4).map((photo, index) => `
    <button class="field-report-thumb" type="button" data-open-field-photo="${Number(photo.id)}" data-report-id="${Number(report.id)}" aria-label="Buka foto ${index + 1}">
      <img src="/api/field-monitoring/photos/${Number(photo.id)}/preview" loading="lazy" alt="${escapeHtml(report.title)}" />
    </button>
  `).join('');
  const history = (report.reviews || []).map((review) => `
    <div class="field-review-entry"><strong>${escapeHtml(fieldStatusLabel(review.status))}</strong><span>${escapeHtml(review.reviewer_name)} · ${formatFieldDate(review.created_at)}</span>${review.note ? `<p>${escapeHtml(review.note)}</p>` : ''}</div>
  `).join('');
  const reviewerActions = canAct && isManager && report.status === 'pending' ? `
    <div class="field-review-actions">
      <label><span>Catatan pemeriksaan (wajib untuk perbaikan)</span><textarea rows="2" maxlength="2000" data-field-review-note="${Number(report.id)}"></textarea></label>
      <div class="inline-actions"><button class="mini-btn success" type="button" data-field-review="reviewed" data-report-id="${Number(report.id)}">Tandai sudah diperiksa</button><button class="mini-btn danger" type="button" data-field-review="needs_revision" data-report-id="${Number(report.id)}">Minta perbaikan</button></div>
    </div>
  ` : '';
  const revisionForm = canAct && isOwner && report.status === 'needs_revision' ? `
    <form class="field-revision-form" data-field-revision="${Number(report.id)}">
      <label><span>Perbaiki keterangan</span><textarea name="description" rows="2" maxlength="2000" required>${escapeHtml(report.description)}</textarea></label>
      <label><span>Foto dokumentasi perbaikan (1–4 foto)</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required /></label>
      <div class="field-revision-preview"></div><button class="mini-btn success" type="submit">Kirim Perbaikan</button>
    </form>
  ` : '';
  const editForm = canAct && isDirector && !report.archived_at ? `
    <details class="field-edit-details"><summary>Edit metadata</summary>
      <form class="field-metadata-form" data-field-metadata="${Number(report.id)}">
        <label><span>Judul</span><input name="title" maxlength="160" required value="${escapeHtml(report.title)}" /></label>
        <label><span>Kategori</span><select name="category" required>${state.fieldReferences.categories.map((category) => `<option value="${escapeHtml(category)}" ${category === report.category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label>
        <label><span>Lokasi</span><input name="location_name" maxlength="200" value="${escapeHtml(report.location_name || '')}" /></label>
        <label><span>Keterangan</span><textarea name="description" rows="2" maxlength="2000">${escapeHtml(report.description || '')}</textarea></label>
        <button class="mini-btn" type="submit">Simpan metadata</button>
      </form>
    </details>
  ` : '';
  return `
    <article class="field-report-card ${context === 'gallery' ? 'gallery-report-card' : ''}" data-field-report="${Number(report.id)}">
      ${firstPhoto ? `<button class="field-report-cover" type="button" data-open-field-photo="${Number(firstPhoto.id)}" data-report-id="${Number(report.id)}"><img src="/api/field-monitoring/photos/${Number(firstPhoto.id)}/preview" loading="lazy" alt="${escapeHtml(report.title)}" /></button>` : ''}
      <div class="field-report-content">
        <div class="field-report-heading"><div><h4>${escapeHtml(report.title)}${report.archived_at ? ' · Diarsipkan' : ''}</h4><span class="field-eyebrow">${escapeHtml(report.category)}</span></div><span class="tag ${report.status === 'reviewed' ? 'approved' : report.status === 'needs_revision' ? 'inactive' : 'pending'}">${escapeHtml(fieldStatusLabel(report.status))}</span></div>
        <p class="field-report-description">${escapeHtml(report.description || 'Tanpa keterangan')}</p>
        <div class="field-report-meta"><span>${escapeHtml(report.uploader_name)} · Upload ${formatFieldDate(report.created_at)}</span><span>${Number(report.photos?.length || 0)} foto</span></div>
        ${(report.photos || []).some((photo) => photo.captured_at) ? `<div class="field-capture-time">Waktu pengambilan (metadata): ${(report.photos || []).filter((photo) => photo.captured_at).map((photo) => formatFieldDate(photo.captured_at)).join(', ')}</div>` : ''}
        ${report.location_name ? `<p class="field-report-reference">Lokasi: ${escapeHtml(report.location_name)}${report.location_lat ? ` (${escapeHtml(report.location_lat)}, ${escapeHtml(report.location_lon)})` : ''}</p>` : ''}
        ${related ? `<p class="field-report-reference">Referensi: ${escapeHtml(related)}</p>` : ''}
        <div class="field-report-thumbnails">${photoButtons}</div>
        ${report.reviewer_name ? `<p class="field-report-reference">Pemeriksa terakhir: ${escapeHtml(report.reviewer_name)} · ${formatFieldDate(report.reviewed_at)}</p>` : ''}
        ${history ? `<details class="field-review-history"><summary>Riwayat pemeriksaan (${report.reviews.length})</summary>${history}</details>` : ''}
        ${context === 'history' && report.revisions?.length ? `<details class="field-review-history"><summary>Riwayat perbaikan (${report.revisions.length})</summary>${report.revisions.map((revision) => `<div class="field-review-entry"><strong>Revisi ${Number(revision.revision_number)}</strong><span>${formatFieldDate(revision.created_at)}</span><p>${escapeHtml(revision.description || 'Tanpa keterangan')}</p></div>`).join('')}</details>` : ''}
        ${context === 'history' && report.changes?.length ? `<details class="field-review-history"><summary>Perubahan metadata (${report.changes.length})</summary>${report.changes.map((change) => `<div class="field-review-entry"><strong>${escapeHtml(change.change_type)}</strong><span>${escapeHtml(change.actor_name)} · ${formatFieldDate(change.created_at)}</span><p>${escapeHtml(JSON.stringify(change.before_data))} → ${escapeHtml(JSON.stringify(change.after_data))}</p></div>`).join('')}</details>` : ''}
        ${reviewerActions}
        ${revisionForm}
        ${editForm}
        <div class="inline-actions field-report-footer">
          ${report.photos?.[0] ? `<a class="mini-btn" href="/api/field-monitoring/photos/${Number(report.photos[0].id)}/download">Unduh foto</a>` : ''}
          ${isDirector && context === 'history' && report.archived_at ? `<button class="mini-btn success" type="button" data-restore-field-report="${Number(report.id)}">Pulihkan dokumentasi</button>` : ''}
          ${isDirector && canAct && !report.archived_at ? `<button class="mini-btn danger" type="button" data-archive-field-report="${Number(report.id)}">Arsipkan dokumentasi</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderFieldReports() {
  const reports = state.fieldReports || [];
  document.getElementById('fieldActivityList').innerHTML = reports.map((report) => fieldReportCard(report)).join('')
    || '<p>Belum ada dokumentasi lapangan.</p>';
  const revisionReports = reports.filter((report) => report.status === 'needs_revision'
    && String(report.uploader_id) === String(state.user?.id));
  document.getElementById('fieldRevisionQueue').innerHTML = revisionReports.map((report) => fieldReportCard(report, 'queue')).join('')
    || '<p>Tidak ada perbaikan yang menunggu.</p>';
  document.getElementById('fieldActivityHint').textContent = state.user?.role === 'KARYAWAN'
    ? 'Anda hanya dapat melihat dokumentasi yang diunggah dari akun Anda.'
    : 'Klik foto untuk melihat ukuran besar dan detail kegiatan.';
  document.getElementById('fieldHistoryList').innerHTML = reports.map((report) => fieldReportCard(report, 'history')).join('')
    || '<p>Belum ada riwayat dokumentasi.</p>';
  renderFieldGallery();
}

function renderFieldGallery() {
  const gallery = document.getElementById('fieldPhotoGallery');
  gallery.className = `field-photo-gallery mode-${state.galleryMode}`;
  let lastGroup = '';
  const parts = [];
  const reports = [...(state.fieldReports || [])];
  if (state.galleryMode === 'timeline') {
    reports.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  }
  if (state.galleryMode === 'category') {
    reports.sort((left, right) => left.category.localeCompare(right.category) || new Date(right.created_at) - new Date(left.created_at));
  }
  for (const report of reports) {
    const group = state.galleryMode === 'timeline'
      ? new Date(report.created_at).toLocaleDateString('id-ID', { dateStyle: 'full' })
      : state.galleryMode === 'category' ? report.category : '';
    if (group && group !== lastGroup) {
      parts.push(`<h3 class="field-gallery-group">${escapeHtml(group)}</h3>`);
      lastGroup = group;
    }
    parts.push(fieldReportCard(report, 'gallery'));
  }
  gallery.innerHTML = parts.join('') || '<p class="panel">Belum ada foto yang cocok dengan filter.</p>';
}

async function loadFieldReports(query = '') {
  const reports = await apiFetch(`/api/field-monitoring/reports${query}`);
  state.fieldReports = reports;
  const exportParams = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  exportParams.delete('history');
  document.getElementById('fieldReportExport').href = `/api/field-monitoring/reports.csv${exportParams.toString() ? `?${exportParams}` : ''}`;
  renderFieldReferences();
  renderFieldReports();
}

async function loadFieldNotifications() {
  const notifications = await apiFetch('/api/field-monitoring/notifications');
  state.fieldNotifications = notifications;
  const unread = notifications.filter((notification) => !notification.read_at);
  document.getElementById('fieldMonitoringNotifications').innerHTML = unread.length
    ? `<div class="field-notification-banner"><strong>${unread.length} notifikasi belum dibaca</strong>${unread.slice(0, 5).map((notification) => `<button type="button" data-read-field-notification="${Number(notification.id)}">${escapeHtml(notification.message)} <span>${formatFieldDate(notification.created_at)}</span></button>`).join('')}</div>`
    : '';
}

async function loadFieldMonitoring(query = '') {
  const errorPanel = document.getElementById('fieldMonitoringLoadError');
  try {
    state.fieldReferences = await apiFetch('/api/field-monitoring/references');
    renderFieldReferences();
    const jobs = [loadFieldReports(query), loadFieldNotifications()];
    if (state.user.role !== 'KARYAWAN') {
      jobs.push(apiFetch('/api/field-monitoring/dashboard').then((data) => {
        state.fieldDashboard = data;
        renderFieldDashboard(data);
      }));
    } else {
      state.fieldDashboard = null;
      document.getElementById('fieldMonitoringSummary').innerHTML = '';
    }
    await Promise.all(jobs);
    errorPanel.hidden = true;
    errorPanel.textContent = '';
  } catch (error) {
    errorPanel.hidden = false;
    errorPanel.textContent = `Field Monitoring gagal dimuat: ${error.message}`;
    throw error;
  }
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
        await Promise.all([loadFinance(), loadInventory(), loadProcurement(), loadDocuments(), loadBonus(), loadUsers(), loadAudit(), loadTasks(), loadFieldMonitoring()]);
      } else {
        const tasks = [loadBonus(), loadTasks()];
        if (getAllowedViews(state.user.role).includes('finance')) tasks.push(loadFinance());
        if (getAllowedViews(state.user.role).includes('inventory')) tasks.push(loadInventory());
        if (getAllowedViews(state.user.role).includes('procurement')) tasks.push(loadProcurement());
        tasks.push(loadFieldMonitoring());
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
  document.getElementById('fieldReportExport').classList.toggle('hidden', !['DIREKTUR', 'KOMISARIS'].includes(state.user?.role));
  state.fieldTab = state.user?.role === 'KARYAWAN' ? 'activity' : 'dashboard';
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

function setFieldTab(tab) {
  state.fieldTab = tab;
  document.querySelectorAll('[data-field-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.fieldTab === tab);
  });
  document.querySelectorAll('[data-field-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.fieldPanel !== tab);
  });
}

function getFieldFilterQuery() {
  const form = document.getElementById('fieldMonitoringFilter');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) {
    if (!value) params.delete(key);
  }
  if (state.fieldHistoryArchived && state.user?.role === 'DIREKTUR') params.set('history', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function readJpegCaptureDate(file) {
  if (file.type !== 'image/jpeg') return null;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const readAscii = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && readAscii(offset + 4, 6) === 'Exif\u0000\u0000') {
      const tiff = offset + 10;
      const littleEndian = readAscii(tiff, 2) === 'II';
      const u16 = (position) => view.getUint16(position, littleEndian);
      const u32 = (position) => view.getUint32(position, littleEndian);
      const ifd0 = tiff + u32(tiff + 4);
      const entryCount = u16(ifd0);
      for (let index = 0; index < entryCount; index += 1) {
        const entry = ifd0 + 2 + index * 12;
        if (u16(entry) !== 0x8769) continue;
        const exifIfd = tiff + u32(entry + 8);
        const exifCount = u16(exifIfd);
        for (let item = 0; item < exifCount; item += 1) {
          const exifEntry = exifIfd + 2 + item * 12;
          if (u16(exifEntry) !== 0x9003) continue;
          const textLength = Math.min(u32(exifEntry + 4), 40);
          const textOffset = tiff + u32(exifEntry + 8);
          const value = readAscii(textOffset, textLength).replace(/\0+$/, '');
          return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null;
        }
      }
    }
    offset += segmentLength + 2;
  }
  return null;
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Foto tidak dapat diproses di browser ini.')), 'image/jpeg', quality);
  });
}

function loadFieldImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, close: () => {}, image });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Foto tidak dapat dibuka di browser ini.'));
    };
    image.src = url;
  });
}

async function prepareFieldPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error(`Format foto "${file.name}" tidak didukung. Pilih JPG, PNG, atau WebP.`);
  }
  const capturedAt = await readJpegCaptureDate(file).catch(() => null);
  const bitmap = await loadFieldImage(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap.image || bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await canvasBlob(canvas, 0.78);
  if (blob.size > 1024 * 1024) blob = await canvasBlob(canvas, 0.64);
  if (blob.size > 1024 * 1024) {
    const reduced = document.createElement('canvas');
    const secondScale = 1200 / Math.max(canvas.width, canvas.height);
    reduced.width = Math.max(1, Math.round(canvas.width * secondScale));
    reduced.height = Math.max(1, Math.round(canvas.height * secondScale));
    reduced.getContext('2d').drawImage(canvas, 0, 0, reduced.width, reduced.height);
    blob = await canvasBlob(reduced, 0.62);
  }
  if (blob.size > 1024 * 1024) throw new Error(`Foto "${file.name}" tetap lebih dari 1 MB setelah kompresi.`);
  const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'foto-lapangan';
  return { file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }), capturedAt };
}

async function addFieldPhotos(files, previewTarget) {
  const additions = [...files];
  if (state.fieldPhotos.length + additions.length > 4) {
    throw new Error('Maksimal 4 foto untuk satu dokumentasi.');
  }
  for (const file of additions) {
    state.fieldPhotos.push(await prepareFieldPhoto(file));
  }
  renderFieldPhotoPreviews(previewTarget);
}

function renderFieldPhotoPreviews(target = document.getElementById('fieldPhotoPreview')) {
  target.querySelectorAll('img').forEach((image) => {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  });
  target.innerHTML = state.fieldPhotos.map((photo, index) => {
    const url = URL.createObjectURL(photo.file);
    return `<div class="field-preview-item"><img src="${url}" alt="Pratinjau foto ${index + 1}" /><span>${escapeHtml(photo.file.name)} · ${(photo.file.size / 1024).toFixed(0)} KB${photo.capturedAt ? ` · Diambil ${escapeHtml(photo.capturedAt)}` : ''}</span><button type="button" class="mini-btn danger" data-remove-field-photo="${index}">Hapus</button></div>`;
  }).join('');
}

document.querySelectorAll('[data-field-tab]').forEach((button) => {
  button.addEventListener('click', () => setFieldTab(button.dataset.fieldTab));
});

document.getElementById('fieldCameraButton').addEventListener('click', () => document.getElementById('fieldCameraInput').click());
document.getElementById('fieldGalleryButton').addEventListener('click', () => document.getElementById('fieldGalleryInput').click());
for (const input of [document.getElementById('fieldCameraInput'), document.getElementById('fieldGalleryInput')]) {
  input.addEventListener('change', async () => {
    try {
      await addFieldPhotos(input.files, document.getElementById('fieldPhotoPreview'));
    } catch (error) {
      alert(error.message);
    } finally {
      input.value = '';
    }
  });
}

document.getElementById('fieldLocationButton').addEventListener('click', () => {
  const status = document.getElementById('fieldLocationStatus');
  if (!navigator.geolocation) {
    status.textContent = 'Perangkat ini tidak menyediakan lokasi GPS. Foto tetap dapat diunggah.';
    return;
  }
  status.textContent = 'Meminta izin lokasi...';
  navigator.geolocation.getCurrentPosition((position) => {
    document.querySelector('#fieldReportForm [name="latitude"]').value = String(position.coords.latitude);
    document.querySelector('#fieldReportForm [name="longitude"]').value = String(position.coords.longitude);
    status.textContent = `Lokasi GPS ditambahkan (${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}).`;
  }, (error) => {
    status.textContent = error.code === error.PERMISSION_DENIED
      ? 'Izin lokasi tidak diberikan. Foto tetap dapat diunggah.'
      : 'Lokasi tidak tersedia. Foto tetap dapat diunggah.';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});

document.getElementById('fieldReportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.fieldPhotos.length) {
    alert('Pilih atau ambil minimal satu foto.');
    return;
  }
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const data = new FormData(form);
  state.fieldPhotos.forEach((photo) => data.append('photos', photo.file, photo.file.name));
  data.set('photo_captured_at', JSON.stringify(state.fieldPhotos.map((photo) => photo.capturedAt)));
  try {
    await apiFetch('/api/field-monitoring/reports', { method: 'POST', body: data });
    form.reset();
    state.fieldPhotos = [];
    renderFieldPhotoPreviews();
    document.getElementById('fieldLocationStatus').textContent = 'Lokasi GPS opsional, hanya dibagikan jika Anda mengizinkan.';
    await refreshData();
    alert('Dokumentasi berhasil dikirim dan menunggu pemeriksaan.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('fieldMonitoringFilter').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadFieldReports(getFieldFilterQuery());
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('clearFieldFilter').addEventListener('click', async () => {
  document.getElementById('fieldMonitoringFilter').reset();
  state.fieldHistoryArchived = false;
  document.getElementById('toggleFieldArchive').textContent = 'Lihat arsip';
  try {
    await loadFieldReports(getFieldFilterQuery());
  } catch (error) {
    alert(error.message);
  }
});

document.querySelectorAll('[data-gallery-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.galleryMode = button.dataset.galleryMode;
    document.querySelectorAll('[data-gallery-mode]').forEach((modeButton) => {
      modeButton.classList.toggle('active', modeButton === button);
    });
    renderFieldGallery();
  });
});

document.getElementById('toggleFieldArchive').addEventListener('click', async (event) => {
  state.fieldHistoryArchived = !state.fieldHistoryArchived;
  event.currentTarget.textContent = state.fieldHistoryArchived ? 'Sembunyikan arsip' : 'Lihat arsip';
  try {
    await loadFieldReports(getFieldFilterQuery());
  } catch (error) {
    alert(error.message);
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

document.addEventListener('change', async (event) => {
  const form = event.target.closest('[data-field-revision]');
  if (!form || event.target.name !== 'photos') return;
  const preview = form.querySelector('.field-revision-preview');
  preview.querySelectorAll('img').forEach((image) => {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  });
  try {
    const files = [...event.target.files];
    if (files.length > 4) throw new Error('Maksimal 4 foto untuk satu perbaikan.');
    const prepared = await Promise.all(files.map(prepareFieldPhoto));
    form._preparedPhotos = prepared;
    preview.innerHTML = prepared.map((photo) => `<img src="${URL.createObjectURL(photo.file)}" alt="Pratinjau foto perbaikan" />`).join('');
  } catch (error) {
    form._preparedPhotos = [];
    preview.textContent = error.message;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-field-revision]');
  if (form) {
    event.preventDefault();
    const photos = form._preparedPhotos || [];
    if (!photos.length) {
      alert('Pilih minimal satu foto yang valid.');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const data = new FormData(form);
    data.delete('photos');
    photos.forEach((photo) => data.append('photos', photo.file, photo.file.name));
    data.set('photo_captured_at', JSON.stringify(photos.map((photo) => photo.capturedAt)));
    try {
      await apiFetch(`/api/field-monitoring/reports/${Number(form.dataset.fieldRevision)}/revisions`, {
        method: 'POST',
        body: data
      });
      await refreshData();
      alert('Foto perbaikan berhasil dikirim untuk diperiksa kembali.');
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }

  const formMetadata = event.target.closest('[data-field-metadata]');
  if (!formMetadata) return;
  event.preventDefault();
  const button = formMetadata.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(formMetadata).entries());
    await apiFetch(`/api/field-monitoring/reports/${Number(formMetadata.dataset.fieldMetadata)}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const fieldTabButton = event.target.closest('[data-open-field-tab]');
  if (fieldTabButton) {
    setCurrentView('fieldMonitoring');
    setFieldTab(fieldTabButton.dataset.openFieldTab);
    return;
  }
  const removeFieldPhotoButton = event.target.closest('[data-remove-field-photo]');
  if (removeFieldPhotoButton) {
    state.fieldPhotos.splice(Number(removeFieldPhotoButton.dataset.removeFieldPhoto), 1);
    renderFieldPhotoPreviews();
    return;
  }
  const reviewButton = event.target.closest('[data-field-review]');
  if (reviewButton) {
    const reportId = Number(reviewButton.dataset.reportId);
    const note = document.querySelector(`[data-field-review-note="${reportId}"]`)?.value.trim() || '';
    const status = reviewButton.dataset.fieldReview;
    if (status === 'needs_revision' && note.length < 3) {
      alert('Catatan perbaikan wajib diisi minimal 3 karakter.');
      return;
    }
    reviewButton.disabled = true;
    try {
      await apiFetch(`/api/field-monitoring/reports/${reportId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note })
      });
      await refreshData();
      alert(status === 'reviewed' ? 'Dokumentasi ditandai sudah diperiksa.' : 'Catatan perbaikan dikirim kepada karyawan.');
    } catch (error) {
      alert(error.message);
    } finally {
      reviewButton.disabled = false;
    }
    return;
  }
  const archiveFieldReportButton = event.target.closest('[data-archive-field-report]');
  const restoreFieldReportButton = event.target.closest('[data-restore-field-report]');
  if (archiveFieldReportButton || restoreFieldReportButton) {
    const button = archiveFieldReportButton || restoreFieldReportButton;
    const reportId = Number(button.dataset.archiveFieldReport || button.dataset.restoreFieldReport);
    const action = archiveFieldReportButton ? 'archive' : 'restore';
    if (action === 'archive' && !window.confirm('Arsipkan dokumentasi ini? Bukti foto tetap tersimpan dan dapat dipulihkan Direktur.')) return;
    button.disabled = true;
    try {
      await apiFetch(`/api/field-monitoring/reports/${reportId}/${action}`, { method: 'POST' });
      await loadFieldReports(getFieldFilterQuery());
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }
  const notificationButton = event.target.closest('[data-read-field-notification]');
  if (notificationButton) {
    try {
      await apiFetch(`/api/field-monitoring/notifications/${Number(notificationButton.dataset.readFieldNotification)}/read`, {
        method: 'POST'
      });
      await loadFieldNotifications();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const openPhotoButton = event.target.closest('[data-open-field-photo]');
  if (openPhotoButton) {
    const report = state.fieldReports.find((item) => Number(item.id) === Number(openPhotoButton.dataset.reportId));
    const photoId = Number(openPhotoButton.dataset.openFieldPhoto);
    if (!report) return;
    const photos = report.photos || [];
    let zoom = 1;
    const renderModalPhoto = (selectedPhotoId) => {
      const selectedPhoto = photos.find((photo) => Number(photo.id) === selectedPhotoId) || photos[0];
      document.getElementById('fieldPhotoDialogContent').innerHTML = `
        <div class="field-photo-dialog-header"><div><h2>${escapeHtml(report.title)}</h2><p>${escapeHtml(report.uploader_name)} · ${escapeHtml(report.category)}</p></div><button class="indicator-dialog-close" type="button" data-close-field-photo aria-label="Tutup">×</button></div>
        <div class="field-photo-large-wrap"><img class="field-photo-large" src="/api/field-monitoring/photos/${Number(selectedPhoto.id)}/preview" alt="${escapeHtml(report.title)}" style="transform:scale(${zoom})" /></div>
        <div class="inline-actions field-photo-tools"><button class="mini-btn" type="button" data-photo-zoom="-">Perkecil</button><button class="mini-btn" type="button" data-photo-zoom="+">Perbesar</button><a class="mini-btn" href="/api/field-monitoring/photos/${Number(selectedPhoto.id)}/download">Unduh foto</a></div>
        <div class="field-photo-details"><strong>Diunggah</strong><span>${formatFieldDate(report.created_at)}</span><strong>Lokasi</strong><span>${escapeHtml(report.location_name || 'Tidak tersedia')}${report.location_lat ? ` · ${escapeHtml(report.location_lat)}, ${escapeHtml(report.location_lon)}` : ''}</span><strong>Waktu pengambilan</strong><span>${selectedPhoto.captured_at ? formatFieldDate(selectedPhoto.captured_at) : 'Metadata tidak tersedia; waktu pengambilan belum dikonfirmasi'}</span><strong>Keterangan</strong><span>${escapeHtml(report.description || 'Tanpa keterangan')}</span><strong>Status</strong><span>${escapeHtml(fieldStatusLabel(report.status))}</span></div>
        ${photos.length > 1 ? `<div class="field-dialog-thumbnails">${photos.map((photo) => `<button type="button" data-dialog-photo="${Number(photo.id)}" class="${Number(photo.id) === Number(selectedPhoto.id) ? 'active' : ''}"><img src="/api/field-monitoring/photos/${Number(photo.id)}/preview" alt="Foto lain dari aktivitas" /></button>`).join('')}</div>` : ''}
      `;
    };
    renderModalPhoto(photoId);
    const dialog = document.getElementById('fieldPhotoDialog');
    dialog.showModal();
    dialog.onClickHandler = (clickEvent) => {
      if (clickEvent.target.closest('[data-close-field-photo]')) dialog.close();
      const zoomButton = clickEvent.target.closest('[data-photo-zoom]');
      if (zoomButton) {
        zoom = Math.max(0.5, Math.min(3, zoom + (zoomButton.dataset.photoZoom === '+' ? 0.25 : -0.25)));
        const image = dialog.querySelector('.field-photo-large');
        if (image) image.style.transform = `scale(${zoom})`;
      }
      const otherPhoto = clickEvent.target.closest('[data-dialog-photo]');
      if (otherPhoto) renderModalPhoto(Number(otherPhoto.dataset.dialogPhoto));
    };
    dialog.addEventListener('click', dialog.onClickHandler, { once: false });
    dialog.addEventListener('close', () => {
      dialog.removeEventListener('click', dialog.onClickHandler);
      dialog.onClickHandler = null;
    }, { once: true });
    return;
  }
  const openReportButton = event.target.closest('[data-open-field-report]');
  if (openReportButton) {
    setFieldTab('gallery');
    document.querySelector(`[data-field-report="${Number(openReportButton.dataset.openFieldReport)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

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
              <div class="task-history-photos">${(update.photos || []).map((photo) => `
                <a href="/api/tasks/progress-photos/${Number(photo.id)}/preview" target="_blank" rel="noreferrer">
                  <img src="/api/tasks/progress-photos/${Number(photo.id)}/preview" loading="lazy" alt="Foto bukti progres ${Number(update.progress_percent)}%" />
                </a>
              `).join('')}</div>
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

document.addEventListener('change', async (event) => {
  const photoInput = event.target.closest('[data-task-progress-photos]');
  if (!photoInput) return;
  const form = photoInput.closest('[data-progress-form]');
  const preview = form?.querySelector('[data-task-photo-preview]');
  if (!form || !preview) return;
  preview.querySelectorAll('[data-task-local-photo]').forEach((image) => URL.revokeObjectURL(image.src));
  form._preparedPhotos = [];
  form._preparedSources = [...photoInput.files];
  if (!photoInput.files.length) {
    preview.textContent = '';
    return;
  }
  if (photoInput.files.length > 4) {
    preview.textContent = 'Maksimal 4 foto bukti untuk setiap update.';
    return;
  }
  preview.textContent = 'Menyiapkan foto bukti...';
  try {
    const prepared = await Promise.all([...photoInput.files].map(prepareFieldPhoto));
    form._preparedPhotos = prepared;
    preview.innerHTML = prepared.map((photo) => `
      <img data-task-local-photo src="${URL.createObjectURL(photo.file)}" alt="Pratinjau foto bukti pekerjaan" />
    `).join('');
  } catch (error) {
    preview.textContent = error.message;
  }
});

document.addEventListener('submit', async (event) => {
  const progressForm = event.target.closest('[data-progress-form]');
  if (!progressForm) return;
  event.preventDefault();
  const submitButton = progressForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const photoInput = progressForm.querySelector('[data-task-progress-photos]');
    const selectedFiles = [...(photoInput?.files || [])];
    if (!selectedFiles.length || selectedFiles.length > 4) {
      throw new Error('Lampirkan 1–4 foto bukti untuk setiap update pekerjaan.');
    }
    let prepared = progressForm._preparedPhotos;
    const sameFiles = progressForm._preparedSources
      && progressForm._preparedSources.length === selectedFiles.length
      && progressForm._preparedSources.every((file, index) => file === selectedFiles[index]);
    if (!sameFiles || !prepared?.length) {
      prepared = await Promise.all(selectedFiles.map(prepareFieldPhoto));
    }
    const formData = new FormData(progressForm);
    formData.delete('photos');
    prepared.forEach((photo) => formData.append('photos', photo.file, photo.file.name));
    await apiFetch(`/api/tasks/${progressForm.dataset.taskId}/progress`, {
      method: 'POST',
      body: formData
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
  const quotationEditForm = event.target.closest('[data-quotation-edit-form]');
  if (!quotationForm && !quotationEditForm) return;
  event.preventDefault();
  const form = quotationForm || quotationEditForm;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = Object.fromEntries(new FormData(form).entries());
  values.items = [...form.querySelectorAll('[data-quote-price]')].map((input) => ({
    request_item_id: Number(input.dataset.quotePrice),
    unit_price: input.value
  }));
  try {
    await apiFetch(
      quotationEditForm
        ? `/api/procurement/quotations/${Number(quotationEditForm.dataset.quotationId)}`
        : `/api/procurement/requests/${Number(quotationForm.dataset.requestId)}/quotations`,
      {
      method: quotationEditForm ? 'PATCH' : 'POST',
      body: JSON.stringify(values)
      }
    );
    await refreshData();
    alert(quotationEditForm ? 'Penawaran supplier berhasil diperbarui.' : 'Penawaran supplier berhasil dicatat.');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

const transactionForm = document.getElementById('transactionForm');
const transactionDateInput = transactionForm.elements.date;
const resetTransactionForm = () => {
  transactionForm.reset();
  transactionForm.elements.transaction_id.value = '';
  document.getElementById('transactionFormHeading').textContent = 'Input Transaksi';
  transactionForm.querySelector('button[type="submit"]').textContent = 'Simpan Catatan';
  document.getElementById('cancelTransactionEdit').hidden = true;
  setTransactionDateToday();
};
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
  const transactionId = form.elements.transaction_id.value;
  formData.delete('transaction_id');
  formData.set('category', form.querySelector('.transaction-quick-grid [name="category"]').value);
  formData.set('project_name', form.querySelector('.transaction-quick-grid [name="project_name"]').value);
  if (!form.querySelector('[name="attachment"]').files.length) formData.delete('attachment');
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const result = await apiFetch(
      transactionId ? `/api/transactions/${Number(transactionId)}` : '/api/transactions',
      {
      method: transactionId ? 'PATCH' : 'POST',
      body: formData
      }
    );
    resetTransactionForm();
    await refreshData();
    if (result.warning) alert(result.warning);
    else if (transactionId) alert('Transaksi berhasil diperbarui.');
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById('cancelTransactionEdit').addEventListener('click', resetTransactionForm);

document.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-transaction]');
  if (editButton) {
    const transaction = state.transactions.find(
      (entry) => Number(entry.id) === Number(editButton.dataset.editTransaction)
    );
    if (!transaction) return;
    transactionForm.elements.transaction_id.value = String(transaction.id);
    transactionForm.elements.type.value = transaction.type;
    transactionForm.elements.date.value = String(transaction.date).slice(0, 10);
    transactionForm.querySelectorAll('[name="category"]').forEach((input) => {
      input.value = transaction.category || '';
    });
    transactionForm.querySelectorAll('[name="project_name"]').forEach((input) => {
      input.value = transaction.project_name || '';
    });
    transactionForm.elements.description.value = transaction.description || '';
    transactionForm.elements.amount.value = transaction.amount;
    transactionForm.elements.payment_method.value = transaction.payment_method || '';
    transactionForm.elements.counterparty.value = transaction.counterparty || '';
    transactionForm.elements.attachment.value = '';
    document.getElementById('transactionFormHeading').textContent = `Edit Transaksi #${transaction.id}`;
    transactionForm.querySelector('button[type="submit"]').textContent = 'Simpan Perubahan';
    document.getElementById('cancelTransactionEdit').hidden = false;
    transactionForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const restoreButton = event.target.closest('[data-restore-transaction]');
  if (restoreButton) {
    restoreButton.disabled = true;
    try {
      await apiFetch(`/api/transactions/${Number(restoreButton.dataset.restoreTransaction)}/restore`, {
        method: 'POST'
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      restoreButton.disabled = false;
    }
    return;
  }

  const deleteButton = event.target.closest('[data-delete-transaction]');
  if (!deleteButton) return;
  if (!window.confirm('Arsipkan transaksi ini? Data dan lampiran tetap tersimpan dan dapat dipulihkan Direktur.')) return;
  deleteButton.disabled = true;
  try {
    const result = await apiFetch(`/api/transactions/${Number(deleteButton.dataset.deleteTransaction)}`, {
      method: 'DELETE'
    });
    if (transactionForm.elements.transaction_id.value === deleteButton.dataset.deleteTransaction) {
      resetTransactionForm();
    }
    await refreshData();
    if (result.warning) alert(result.warning);
  } catch (error) {
    alert(error.message);
  } finally {
    deleteButton.disabled = false;
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
  const requestId = values.request_id;
  delete values.request_id;
  values.items = [...purchaseRequestItems.querySelectorAll('[data-request-line]')].map((row) => ({
    item_name: row.querySelector('[data-line-name]').value,
    quantity: row.querySelector('[data-line-quantity]').value,
    unit: row.querySelector('[data-line-unit]').value,
    estimated_unit_price: row.querySelector('[data-line-price]').value
  }));
  try {
    const result = await apiFetch(
      requestId ? `/api/procurement/requests/${Number(requestId)}` : '/api/procurement/requests',
      {
      method: requestId ? 'PATCH' : 'POST',
      body: JSON.stringify(values)
      }
    );
    form.reset();
    form.elements.request_id.value = '';
    document.getElementById('purchaseRequestSubmit').textContent = 'Ajukan PR';
    document.getElementById('cancelPurchaseRequestEdit').hidden = true;
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
    alert(requestId ? 'PR diperbarui dan dikembalikan ke status menunggu persetujuan.' : `PR ${result.request_number} berhasil diajukan.`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelPurchaseRequestEdit').addEventListener('click', () => {
  const form = document.getElementById('purchaseRequestForm');
  form.reset();
  form.elements.request_id.value = '';
  purchaseRequestItems.innerHTML = `
    <div class="procurement-line" data-request-line>
      <label><span>Nama barang</span><input data-line-name maxlength="160" required /></label>
      <label><span>Jumlah</span><input data-line-quantity type="number" min="0.000001" step="0.000001" required /></label>
      <label><span>Satuan</span><input data-line-unit maxlength="20" placeholder="Kg / unit..." required /></label>
      <label><span>Harga estimasi per satuan</span><input data-line-price type="number" min="0" step="0.01" value="0" required /></label>
      <button class="mini-btn danger" type="button" data-remove-request-line hidden>Hapus</button>
    </div>
  `;
  document.getElementById('purchaseRequestSubmit').textContent = 'Ajukan PR';
  document.getElementById('cancelPurchaseRequestEdit').hidden = true;
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
  const editRequestButton = event.target.closest('[data-edit-request]');
  if (editRequestButton) {
    const request = state.procurement?.requests.find((entry) => Number(entry.id) === Number(editRequestButton.dataset.editRequest));
    if (!request) return;
    const form = document.getElementById('purchaseRequestForm');
    form.elements.request_id.value = String(request.id);
    form.elements.division.value = request.division || '';
    form.elements.category.value = request.category || '';
    form.elements.urgency.value = request.urgency || 'normal';
    form.elements.needed_by.value = request.needed_by ? String(request.needed_by).slice(0, 10) : '';
    form.elements.project_name.value = request.project_name || '';
    form.elements.reason.value = request.reason || '';
    purchaseRequestItems.innerHTML = (request.items || []).map((item, index) => `
      <div class="procurement-line" data-request-line>
        <label><span>Nama barang</span><input data-line-name maxlength="160" required value="${escapeHtml(item.item_name)}" /></label>
        <label><span>Jumlah</span><input data-line-quantity type="number" min="0.000001" step="0.000001" required value="${escapeHtml(item.quantity)}" /></label>
        <label><span>Satuan</span><input data-line-unit maxlength="20" required value="${escapeHtml(item.unit)}" /></label>
        <label><span>Harga estimasi per satuan</span><input data-line-price type="number" min="0" step="0.01" required value="${escapeHtml(item.estimated_unit_price)}" /></label>
        <button class="mini-btn danger" type="button" data-remove-request-line ${index === 0 ? 'hidden' : ''}>Hapus</button>
      </div>
    `).join('');
    document.getElementById('purchaseRequestSubmit').textContent = 'Simpan Perubahan PR';
    document.getElementById('cancelPurchaseRequestEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const cancelRequestButton = event.target.closest('[data-cancel-request]');
  if (cancelRequestButton) {
    if (!window.confirm('Batalkan PR ini? Riwayat dan barang PR tetap tersimpan.')) return;
    cancelRequestButton.disabled = true;
    try {
      await apiFetch(`/api/procurement/requests/${Number(cancelRequestButton.dataset.cancelRequest)}/cancel`, {
        method: 'POST'
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      cancelRequestButton.disabled = false;
    }
    return;
  }

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

  const cancelOrderButton = event.target.closest('[data-cancel-order]');
  if (cancelOrderButton) {
    if (!window.confirm('Batalkan PO ini? Riwayat persetujuan akan tetap tersimpan.')) return;
    cancelOrderButton.disabled = true;
    try {
      await apiFetch(`/api/procurement/purchase-orders/${Number(cancelOrderButton.dataset.cancelOrder)}/cancel`, {
        method: 'POST'
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      cancelOrderButton.disabled = false;
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
  const values = Object.fromEntries(new FormData(form).entries());
  const taskId = values.task_id;
  delete values.task_id;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await apiFetch(taskId ? `/api/tasks/${Number(taskId)}` : '/api/tasks', {
      method: taskId ? 'PATCH' : 'POST',
      body: JSON.stringify(values)
    });
    form.reset();
    await refreshData();
    button.textContent = 'Tugaskan pekerjaan';
    document.getElementById('cancelTaskEdit').hidden = true;
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelTaskEdit').addEventListener('click', () => {
  const form = document.getElementById('taskForm');
  form.reset();
  form.elements.task_id.value = '';
  document.getElementById('taskFormSubmit').textContent = 'Tugaskan pekerjaan';
  document.getElementById('cancelTaskEdit').hidden = true;
});

document.addEventListener('click', async (event) => {
  const editTaskButton = event.target.closest('[data-edit-task]');
  if (editTaskButton) {
    const task = state.tasks.find((entry) => Number(entry.id) === Number(editTaskButton.dataset.editTask));
    if (!task) return;
    const form = document.getElementById('taskForm');
    form.elements.task_id.value = String(task.id);
    form.elements.title.value = task.title;
    form.elements.description.value = task.description || '';
    form.elements.quantity.value = task.quantity;
    form.elements.assignee_id.value = String(task.assignee_id);
    document.getElementById('taskFormSubmit').textContent = 'Simpan Perubahan';
    document.getElementById('cancelTaskEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const archiveTaskButton = event.target.closest('[data-task-archive]');
  if (archiveTaskButton) {
    const archive = archiveTaskButton.dataset.taskArchive === 'archive';
    if (archive && !window.confirm('Arsipkan pekerjaan ini? Riwayat dan bonus tetap tersimpan.')) return;
    archiveTaskButton.disabled = true;
    try {
      await apiFetch(`/api/tasks/${Number(archiveTaskButton.dataset.taskId)}/archive`, {
        method: 'POST',
        body: JSON.stringify({ archived: archive })
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      archiveTaskButton.disabled = false;
    }
    return;
  }

  const saveBonusButton = event.target.closest('[data-save-bonus]');
  if (!saveBonusButton) return;
  const taskId = Number(saveBonusButton.dataset.saveBonus);
  const input = document.querySelector(`[data-bonus-amount="${taskId}"]`);
  saveBonusButton.disabled = true;
  try {
    await apiFetch(`/api/tasks/${taskId}/bonus`, {
      method: 'PATCH',
      body: JSON.stringify({ bonus_amount: input.value })
    });
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    saveBonusButton.disabled = false;
  }
});

document.getElementById('documentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateUploadSize(form)) return;
  const formData = new FormData(form);
  const documentId = form.elements.document_id.value;
  formData.delete('document_id');
  if (!form.elements.attachment.files.length) formData.delete('attachment');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await apiFetch(documentId ? `/api/documents/${Number(documentId)}` : '/api/documents', {
      method: documentId ? 'PATCH' : 'POST',
      body: formData
    });
    form.reset();
    form.elements.document_id.value = '';
    document.getElementById('documentFormSubmit').textContent = 'Simpan Dokumen';
    document.getElementById('cancelDocumentEdit').hidden = true;
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelDocumentEdit').addEventListener('click', () => {
  const form = document.getElementById('documentForm');
  form.reset();
  form.elements.document_id.value = '';
  document.getElementById('documentFormSubmit').textContent = 'Simpan Dokumen';
  document.getElementById('cancelDocumentEdit').hidden = true;
});

document.addEventListener('click', async (event) => {
  const editDocumentButton = event.target.closest('[data-edit-document]');
  if (editDocumentButton) {
    const doc = state.documents.find((entry) => Number(entry.id) === Number(editDocumentButton.dataset.editDocument));
    if (!doc) return;
    const form = document.getElementById('documentForm');
    form.elements.document_id.value = String(doc.id);
    form.elements.title.value = doc.title;
    form.elements.category.value = doc.category;
    form.elements.description.value = doc.description || '';
    form.elements.attachment.value = '';
    document.getElementById('documentFormSubmit').textContent = 'Simpan Perubahan';
    document.getElementById('cancelDocumentEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const restoreDocumentButton = event.target.closest('[data-restore-document]');
  if (restoreDocumentButton) {
    restoreDocumentButton.disabled = true;
    try {
      await apiFetch(`/api/documents/${Number(restoreDocumentButton.dataset.restoreDocument)}/restore`, {
        method: 'POST'
      });
      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      restoreDocumentButton.disabled = false;
    }
    return;
  }
  const archiveDocumentButton = event.target.closest('[data-archive-document]');
  if (!archiveDocumentButton) return;
  if (!window.confirm('Arsipkan dokumen ini? Data dan file tetap tersimpan, tetapi tidak muncul pada daftar aktif.')) return;
  archiveDocumentButton.disabled = true;
  try {
    await apiFetch(`/api/documents/${Number(archiveDocumentButton.dataset.archiveDocument)}/archive`, {
      method: 'POST'
    });
    await refreshData();
  } catch (error) {
    alert(error.message);
  } finally {
    archiveDocumentButton.disabled = false;
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
