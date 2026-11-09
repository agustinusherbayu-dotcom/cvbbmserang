const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROLES = ['DIREKTUR', 'MANAGER', 'KOMISARIS', 'KARYAWAN'];
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured for Neon PostgreSQL.');
}

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});

const s3Config = process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ? {
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    }
  : null;
const s3 = s3Config ? new S3Client(s3Config) : null;
const bucketName = process.env.R2_BUCKET_NAME;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('DIREKTUR', 'MANAGER', 'KOMISARIS', 'KARYAWAN')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      date DATE NOT NULL,
      category TEXT NOT NULL,
      project_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),
      payment_method TEXT NOT NULL DEFAULT 'Transfer',
      counterparty TEXT NOT NULL DEFAULT 'Internal',
      attachment_path TEXT,
      created_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id BIGINT NOT NULL REFERENCES users(id),
      quantity NUMERIC(16, 2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
      evidence_path TEXT,
      bonus_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
      created_by BIGINT NOT NULL REFERENCES users(id),
      verified_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      uploaded_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      ip_address TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      reset_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS tasks_assignee_created_idx ON tasks(assignee_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS documents_created_idx ON documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS login_rate_limits_reset_idx ON login_rate_limits(reset_at);
    CREATE INDEX IF NOT EXISTS app_sessions_expire_idx ON app_sessions(expire);
  `);

  const bootstrapPhone = process.env.BBM_ADMIN_PHONE?.trim();
  const bootstrapPin = process.env.BBM_ADMIN_PIN?.trim();
  if (Boolean(bootstrapPhone) !== Boolean(bootstrapPin)) {
    throw new Error('Set BBM_ADMIN_PHONE and BBM_ADMIN_PIN together to bootstrap the first Direktur account.');
  }
  if (bootstrapPin && !/^\d{6}$/.test(bootstrapPin)) {
    throw new Error('BBM_ADMIN_PIN must contain exactly 6 digits.');
  }

  if (bootstrapPhone && bootstrapPin) {
    await pool.query(`
      INSERT INTO users (name, phone, pin_hash, role)
      SELECT $1, $2, $3, 'DIREKTUR'
      WHERE NOT EXISTS (SELECT 1 FROM users)
      ON CONFLICT (phone) DO NOTHING
    `, [
      process.env.BBM_ADMIN_NAME?.trim() || 'Direktur',
      bootstrapPhone,
      bcrypt.hashSync(bootstrapPin, 12)
    ]);
  }
}

let databaseReady;

function ensureDatabaseReady() {
  if (!databaseReady) {
    databaseReady = initializeDatabase().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  return databaseReady;
}

function logAudit(userId, action, details, ip) {
  return pool.query(`
    INSERT INTO audit_logs (user_id, action, details, ip_address)
    VALUES ($1, $2, $3, $4)
  `, [userId || null, action, details || '', ip || 'unknown']);
}

function persistentLoginLimiter(req, res, next) {
  pool.query("DELETE FROM login_rate_limits WHERE reset_at < NOW() - INTERVAL '1 day'")
    .then(() => pool.query(`
    INSERT INTO login_rate_limits (ip_address, attempts, reset_at)
    VALUES ($1, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (ip_address) DO UPDATE
    SET attempts = CASE
          WHEN login_rate_limits.reset_at <= NOW() THEN 1
          ELSE login_rate_limits.attempts + 1
        END,
        reset_at = CASE
          WHEN login_rate_limits.reset_at <= NOW() THEN NOW() + INTERVAL '15 minutes'
          ELSE login_rate_limits.reset_at
        END
    RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - NOW()))))::INTEGER AS retry_after
  `, [req.ip || 'unknown']))
    .then(({ rows }) => {
      const { attempts, retry_after: retryAfter } = rows[0];
      if (attempts > 5) {
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'Terlalu banyak percobaan login. Silakan tunggu beberapa menit sebelum mencoba lagi.',
          retry_after: retryAfter
        });
      }
      next();
    })
    .catch(next);
}

function getUserSafe(user) {
  if (!user) return null;
  const { pin_hash, ...safe } = user;
  return safe;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak untuk role ini.' });
    }
    next();
  };
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function storeUpload(file, prefix) {
  if (!file) return null;
  if (!s3 || !bucketName) {
    const error = new Error('Object storage belum dikonfigurasi.');
    error.status = 503;
    throw error;
  }

  const originalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
  const key = `${prefix}/${crypto.randomUUID()}-${originalName}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${originalName.replace(/["\\]/g, '_')}"`
  }));
  return key;
}

async function removeUpload(key) {
  if (key && s3 && bucketName) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  }
}

async function signedDownload(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: key }), { expiresIn: 60 });
}

async function getDashboardData(user) {
  const isDirector = user.role === 'DIREKTUR';
  const transactions = isDirector
    ? (await pool.query(`
        SELECT t.*, u.name AS created_by_name
        FROM transactions t
        LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.date DESC, t.id DESC
      `)).rows
    : [];
  const tasks = isDirector
    ? (await pool.query(`
        SELECT t.*, u.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        ORDER BY t.created_at DESC
      `)).rows
    : (await pool.query(`
        SELECT t.*, u.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        WHERE t.assignee_id = $1
        ORDER BY t.created_at DESC
      `, [user.id])).rows;
  const activities = isDirector
    ? (await pool.query(`
        SELECT a.*, u.name AS user_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC
        LIMIT 8
      `)).rows
    : [];

  const income = transactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const monthlySummary = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const monthDate = new Date();
    monthDate.setDate(1);
    monthDate.setMonth(monthDate.getMonth() - offset);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const inMonth = transactions.filter((tx) => {
      const date = new Date(tx.date);
      return date >= monthStart && date <= monthEnd;
    });
    monthlySummary.push({
      label: monthDate.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
      income: inMonth.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
      expense: inMonth.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    });
  }

  return {
    role: user.role,
    summary: {
      balance: income - expense,
      income,
      expense,
      totalTransactions: transactions.length,
      pendingVerification: tasks.filter((task) => task.status === 'in_review').length,
      approvedTasks: tasks.filter((task) => task.status === 'approved').length,
      totalBonus: tasks.reduce((sum, task) => sum + Number(task.bonus_amount || 0), 0)
    },
    transactions: transactions.slice(0, 10),
    tasks: tasks.slice(0, 12),
    activities,
    monthlySummary,
    userSummary: {
      completed: tasks.filter((task) => task.status === 'approved').length,
      waiting: tasks.filter((task) => task.status === 'in_review').length,
      personalBonus: tasks.filter((task) => task.status === 'approved')
        .reduce((sum, task) => sum + Number(task.bonus_amount || 0), 0)
    }
  };
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use(asyncRoute(async (_req, _res, next) => {
  await ensureDatabaseReady();
  next();
}));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'app_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60
  }),
  secret: process.env.SESSION_SECRET || 'bbm-local-development-secret-change-before-deploy',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000
  }
}));

app.post('/api/login', persistentLoginLimiter, asyncRoute(async (req, res) => {
  const { phone, pin } = req.body || {};
  const clientIp = req.ip || 'unknown';
  if (!phone || !pin) {
    return res.status(400).json({ error: 'Nomor telepon dan PIN wajib diisi.' });
  }

  const result = await pool.query('SELECT * FROM users WHERE phone = $1', [String(phone).trim()]);
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(String(pin), user.pin_hash)) {
    await logAudit(null, 'LOGIN_FAILED', 'Nomor telepon atau PIN tidak cocok.', clientIp);
    return res.status(401).json({ error: 'Nomor telepon atau PIN salah.' });
  }
  if (user.status !== 'active') {
    await logAudit(user.id, 'LOGIN_BLOCKED', `Blocked login attempt for status: ${user.status}`, clientIp);
    return res.status(403).json({ error: 'Akun Anda sedang non-aktif atau ditangguhkan. Hubungi Direktur.' });
  }

  const safeUser = getUserSafe(user);
  req.session.regenerate((regenerateError) => {
    if (regenerateError) return res.status(500).json({ error: 'Gagal memulai sesi login.' });
    req.session.user = safeUser;
    req.session.save(async (saveError) => {
      if (saveError) return res.status(500).json({ error: 'Gagal menyimpan sesi login.' });
      try {
        await logAudit(user.id, 'LOGIN_SUCCESS', 'User logged in successfully.', clientIp);
        res.json({ success: true, user: req.session.user });
      } catch (auditError) {
        console.error('Failed to record successful login:', auditError);
        res.status(500).json({ error: 'Gagal mencatat aktivitas login.' });
      }
    });
  });
}));

app.post('/api/logout', requireAuth, asyncRoute(async (req, res) => {
  await logAudit(req.session.user.id, 'LOGOUT', 'User logged out successfully.', req.ip || 'unknown');
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Gagal mengakhiri sesi.' });
    res.json({ success: true });
  });
}));

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  res.json(await getDashboardData(req.session.user));
}));

app.get('/api/users', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id, name, phone, role, status, created_at FROM users ORDER BY created_at DESC');
  res.json(result.rows);
}));

app.post('/api/users', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const { name, phone, pin, role, status } = req.body || {};
  if (!name || !phone || !pin) {
    return res.status(400).json({ error: 'Nama, nomor telepon, dan PIN wajib diisi.' });
  }
  const cleanName = String(name).trim();
  const cleanPhone = String(phone).trim();
  const cleanPin = String(pin).trim();
  if (!cleanName || !cleanPhone || !/^\d{6}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'Nama dan nomor telepon wajib diisi; PIN harus 6 digit angka.' });
  }
  const nextRole = role || 'KARYAWAN';
  const nextStatus = status || 'active';
  if (!ROLES.includes(nextRole)) return res.status(400).json({ error: 'Role tidak valid.' });
  if (!['active', 'inactive', 'suspended'].includes(nextStatus)) {
    return res.status(400).json({ error: 'Status tidak valid.' });
  }

  let created;
  try {
    created = await pool.query(`
      INSERT INTO users (name, phone, pin_hash, role, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, phone, role, status, created_at
    `, [cleanName, cleanPhone, bcrypt.hashSync(cleanPin, 12), nextRole, nextStatus]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Nomor telepon sudah terdaftar.' });
    throw error;
  }
  await logAudit(req.session.user.id, 'USER_CREATED', `Created user #${created.rows[0].id} (${cleanName}) role=${nextRole} status=${nextStatus}`, req.ip);
  res.status(201).json({ success: true, user: created.rows[0] });
}));

app.patch('/api/users/:id', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const { id } = req.params;
  const currentUser = req.session.user;
  const found = await pool.query('SELECT id, role, status, name FROM users WHERE id = $1', [id]);
  const targetUser = found.rows[0];
  if (!targetUser) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

  const { name, role, status } = req.body || {};
  const nextName = name ? String(name).trim() : targetUser.name;
  const nextRole = role || targetUser.role;
  const nextStatus = status || targetUser.status;
  if (!nextName) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
  if (!ROLES.includes(nextRole)) return res.status(400).json({ error: 'Role tidak valid.' });
  if (!['active', 'inactive', 'suspended'].includes(nextStatus)) {
    return res.status(400).json({ error: 'Status tidak valid.' });
  }
  if (String(currentUser.id) === String(id) && nextRole !== targetUser.role) {
    return res.status(403).json({ error: 'Anda tidak dapat mengubah role akun Anda sendiri.' });
  }

  const updated = await pool.query(`
    UPDATE users SET name = $1, role = $2, status = $3
    WHERE id = $4
    RETURNING id, name, phone, role, status, created_at
  `, [nextName, nextRole, nextStatus, id]);
  await logAudit(currentUser.id, 'USER_UPDATED', `Updated user #${id} (${nextName}) role=${nextRole} status=${nextStatus}`, req.ip);
  res.json({ success: true, user: updated.rows[0] });
}));

app.get('/api/audit', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT a.*, u.name AS user_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 25
  `);
  res.json(result.rows);
}));

app.get('/api/documents', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT d.*, u.name AS uploaded_by_name
    FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by
    ORDER BY d.created_at DESC
  `);
  res.json(result.rows);
}));

app.post('/api/documents', requireAuth, requireRole('DIREKTUR'), upload.single('attachment'), asyncRoute(async (req, res) => {
  const { title, category, description } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'Judul dan kategori dokumen wajib diisi.' });
  const fileKey = await storeUpload(req.file, 'documents');
  let created;
  try {
    created = await pool.query(`
      INSERT INTO documents (title, category, description, file_path, uploaded_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [String(title).trim(), String(category).trim(), description || '', fileKey, req.session.user.id]);
  } catch (error) {
    await removeUpload(fileKey);
    throw error;
  }
  await logAudit(req.session.user.id, 'DOCUMENT_UPLOADED', `Uploaded document #${created.rows[0].id}: ${title}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/documents/:id/download', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  if (!s3 || !bucketName) return res.status(503).json({ error: 'Object storage belum dikonfigurasi.' });
  const result = await pool.query('SELECT file_path FROM documents WHERE id = $1', [req.params.id]);
  const key = result.rows[0]?.file_path;
  if (!key) return res.status(404).json({ error: 'File dokumen tidak ditemukan.' });
  res.redirect(await signedDownload(key));
}));

app.get('/api/bonus', requireAuth, asyncRoute(async (req, res) => {
  const { role, id } = req.session.user;
  const result = role === 'DIREKTUR'
    ? await pool.query(`
        SELECT t.id, t.title, t.quantity, t.bonus_amount, t.status, t.created_at,
               a.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        ORDER BY t.created_at DESC
      `)
    : await pool.query(`
        SELECT t.id, t.title, t.quantity, t.bonus_amount, t.status, t.created_at,
               a.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        WHERE t.assignee_id = $1
        ORDER BY t.created_at DESC
      `, [id]);
  res.json(result.rows.map((row) => ({
    ...row,
    bonus_status: row.status === 'approved' ? 'approved' : row.status === 'in_review' ? 'in_review' : 'pending'
  })));
}));

app.post('/api/tasks/:id/verify', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const { status, bonus_amount } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status verifikasi tidak valid.' });
  }
  const taskResult = await pool.query('SELECT id, bonus_amount FROM tasks WHERE id = $1', [req.params.id]);
  const task = taskResult.rows[0];
  if (!task) return res.status(404).json({ error: 'Task tidak ditemukan.' });
  const nextBonus = bonus_amount === undefined ? Number(task.bonus_amount || 0) : Number(bonus_amount);
  if (!Number.isFinite(nextBonus) || nextBonus < 0) {
    return res.status(400).json({ error: 'Nilai bonus tidak valid.' });
  }
  await pool.query(`
    UPDATE tasks SET status = $1, bonus_amount = $2, verified_by = $3, updated_at = NOW()
    WHERE id = $4
  `, [status, nextBonus, req.session.user.id, req.params.id]);
  await logAudit(req.session.user.id, 'TASK_VERIFIED', `Task #${req.params.id} set to ${status}.`, req.ip);
  res.json({ success: true });
}));

app.get('/api/transactions', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT t.*, u.name AS created_by_name
    FROM transactions t
    LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.date DESC, t.id DESC
  `);
  res.json(result.rows);
}));

app.post('/api/transactions', requireAuth, requireRole('DIREKTUR'), upload.single('attachment'), asyncRoute(async (req, res) => {
  const { type, date, category, project_name, description, amount, payment_method, counterparty } = req.body || {};
  const numericAmount = Number(amount);
  if (!['income', 'expense'].includes(type) || !isValidIsoDate(date) || !category || !project_name || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Jenis, tanggal, kategori, proyek, dan nominal yang valid wajib diisi.' });
  }

  const fileKey = await storeUpload(req.file, 'transactions');
  let created;
  try {
    created = await pool.query(`
      INSERT INTO transactions (
        type, date, category, project_name, description, amount, payment_method,
        counterparty, attachment_path, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      type, date, String(category).trim(), String(project_name).trim(), String(description || ''),
      numericAmount, String(payment_method || 'Transfer'), String(counterparty || 'Internal'), fileKey, req.session.user.id
    ]);
  } catch (error) {
    await removeUpload(fileKey);
    throw error;
  }
  await logAudit(req.session.user.id, 'TRANSACTION_CREATED', `Added ${type} transaction #${created.rows[0].id}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/transactions/:id/attachment', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  if (!s3 || !bucketName) return res.status(503).json({ error: 'Object storage belum dikonfigurasi.' });
  const result = await pool.query('SELECT attachment_path FROM transactions WHERE id = $1', [req.params.id]);
  const key = result.rows[0]?.attachment_path;
  if (!key) return res.status(404).json({ error: 'Lampiran tidak ditemukan.' });
  res.redirect(await signedDownload(key));
}));

app.get('/api/tasks', requireAuth, asyncRoute(async (req, res) => {
  const isDirector = req.session.user.role === 'DIREKTUR';
  const result = isDirector
    ? await pool.query(`
        SELECT t.*, u.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        ORDER BY t.created_at DESC
      `)
    : await pool.query(`
        SELECT t.*, u.name AS assignee_name, v.name AS verifier_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN users v ON v.id = t.verified_by
        WHERE t.assignee_id = $1
        ORDER BY t.created_at DESC
      `, [req.session.user.id]);
  res.json(result.rows);
}));

app.post('/api/tasks', requireAuth, asyncRoute(async (req, res) => {
  const { title, description, quantity } = req.body || {};
  const numericQuantity = Number(quantity);
  if (!title || !Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    return res.status(400).json({ error: 'Judul dan jumlah pekerjaan yang valid wajib diisi.' });
  }
  const created = await pool.query(`
    INSERT INTO tasks (title, description, assignee_id, quantity, status, bonus_amount, created_by)
    VALUES ($1, $2, $3, $4, 'pending', 0, $3)
    RETURNING id
  `, [String(title).trim(), String(description || ''), req.session.user.id, numericQuantity]);
  await logAudit(req.session.user.id, 'TASK_CREATED', `Created task #${created.rows[0].id}: ${title}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'CV Banten Bangkit Maju',
    fileStorageAvailable: Boolean(s3 && bucketName)
  });
});

app.get('/api/export/excel', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const [transactions, tasks, users] = await Promise.all([
    pool.query(`
      SELECT t.id, t.type, t.date, t.category, t.project_name, t.description, t.amount,
             t.payment_method, t.counterparty, u.name AS created_by_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.date DESC, t.id DESC
    `),
    pool.query(`
      SELECT t.id, t.title, t.description, t.quantity, t.status, t.bonus_amount,
             a.name AS assignee_name, v.name AS verifier_name
      FROM tasks t
      LEFT JOIN users a ON a.id = t.assignee_id
      LEFT JOIN users v ON v.id = t.verified_by
      ORDER BY t.created_at DESC
    `),
    pool.query('SELECT id, name, phone, role, status, created_at FROM users ORDER BY created_at DESC')
  ]);
  const workbook = new ExcelJS.Workbook();
  const txSheet = workbook.addWorksheet('Transaksi');
  txSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Jenis', key: 'type', width: 15 },
    { header: 'Tanggal', key: 'date', width: 15 },
    { header: 'Kategori', key: 'category', width: 20 },
    { header: 'Proyek', key: 'project', width: 30 },
    { header: 'Deskripsi', key: 'description', width: 36 },
    { header: 'Nominal', key: 'amount', width: 18 },
    { header: 'Metode', key: 'payment_method', width: 20 },
    { header: 'Counterparty', key: 'counterparty', width: 25 },
    { header: 'Dibuat Oleh', key: 'created_by', width: 25 }
  ];
  txSheet.addRows(transactions.rows.map((row) => ({
    id: row.id, type: row.type, date: row.date, category: row.category,
    project: row.project_name, description: row.description, amount: Number(row.amount),
    payment_method: row.payment_method, counterparty: row.counterparty, created_by: row.created_by_name
  })));

  const taskSheet = workbook.addWorksheet('Pekerjaan');
  taskSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Judul', key: 'title', width: 30 },
    { header: 'Deskripsi', key: 'description', width: 36 },
    { header: 'Jumlah', key: 'quantity', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Bonus', key: 'bonus', width: 18 },
    { header: 'Assignee', key: 'assignee', width: 25 },
    { header: 'Verifier', key: 'verifier', width: 25 }
  ];
  taskSheet.addRows(tasks.rows.map((row) => ({
    id: row.id, title: row.title, description: row.description, quantity: Number(row.quantity),
    status: row.status, bonus: Number(row.bonus_amount), assignee: row.assignee_name, verifier: row.verifier_name
  })));

  const userSheet = workbook.addWorksheet('Pengguna');
  userSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nama', key: 'name', width: 28 },
    { header: 'Telepon', key: 'phone', width: 20 },
    { header: 'Role', key: 'role', width: 18 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Dibuat Pada', key: 'created_at', width: 25 }
  ];
  userSheet.addRows(users.rows.map((row) => ({
    id: row.id, name: row.name, phone: row.phone, role: row.role, status: row.status, created_at: row.created_at
  })));

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const file = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="bbm-export.xlsx"');
  res.send(Buffer.from(file));
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file maksimal 4 MB.' : 'Upload file tidak valid.'
    });
  }
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Terjadi kesalahan pada server.'
  });
});

if (require.main === module) {
  ensureDatabaseReady().then(() => {
    app.listen(PORT, () => {
      console.log(`BBM Company Management System is running on http://localhost:${PORT}`);
    });
  }).catch((error) => {
    console.error('Failed to initialize BBM app:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
