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
const MAX_UPLOAD_SIZE_BYTES = 3 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES }
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
      attachment_data BYTEA,
      attachment_name TEXT,
      attachment_mime TEXT,
      created_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS attachment_data BYTEA;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS attachment_name TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS attachment_mime TEXT;
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id BIGINT NOT NULL REFERENCES users(id),
      quantity NUMERIC(16, 2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
      progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
      progress_note TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      evidence_path TEXT,
      bonus_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
      created_by BIGINT NOT NULL REFERENCES users(id),
      verified_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT '';
    UPDATE tasks SET progress_percent = 100
    WHERE status IN ('in_review', 'approved') AND progress_percent = 0;
    CREATE TABLE IF NOT EXISTS task_progress_updates (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id),
      progress_percent INTEGER NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
      progress_note TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      file_data BYTEA,
      file_name TEXT,
      file_mime TEXT,
      uploaded_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_name TEXT;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_mime TEXT;
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory_categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE SEQUENCE IF NOT EXISTS inventory_item_sku_seq;
    CREATE TABLE IF NOT EXISTS inventory_items (
      id BIGSERIAL PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE DEFAULT ('BBM-INV-' || nextval('inventory_item_sku_seq')::TEXT),
      name TEXT NOT NULL,
      category_id BIGINT NOT NULL REFERENCES inventory_categories(id),
      description TEXT NOT NULL DEFAULT '',
      base_unit TEXT NOT NULL,
      alternate_unit TEXT,
      conversion_factor NUMERIC(20, 6) CHECK (conversion_factor IS NULL OR conversion_factor > 0),
      min_stock NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
      max_stock NUMERIC(20, 6) CHECK (max_stock IS NULL OR max_stock >= min_stock),
      reference_price NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (reference_price >= 0),
      default_warehouse_id BIGINT REFERENCES warehouses(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (alternate_unit IS NULL AND conversion_factor IS NULL)
        OR (alternate_unit IS NOT NULL AND conversion_factor IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS inventory_balances (
      item_id BIGINT NOT NULL REFERENCES inventory_items(id),
      warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
      on_hand NUMERIC(40, 12) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
      average_cost NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, warehouse_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id BIGSERIAL PRIMARY KEY,
      idempotency_key UUID NOT NULL UNIQUE,
      item_id BIGINT NOT NULL REFERENCES inventory_items(id),
      warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
      movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
      quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      quantity_base NUMERIC(40, 12) NOT NULL CHECK (quantity_base > 0),
      unit_cost_entered NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (unit_cost_entered >= 0),
      unit_cost_base NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (unit_cost_base >= 0),
      balance_after NUMERIC(40, 12) NOT NULL CHECK (balance_after >= 0),
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE SEQUENCE IF NOT EXISTS supplier_code_seq;
    CREATE SEQUENCE IF NOT EXISTS purchase_request_number_seq;
    CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq;
    CREATE TABLE IF NOT EXISTS suppliers (
      id BIGSERIAL PRIMARY KEY,
      supplier_code TEXT NOT NULL UNIQUE DEFAULT ('BBM-SUP-' || nextval('supplier_code_seq')::TEXT),
      company_name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city_province TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      bank_details TEXT NOT NULL DEFAULT '',
      payment_terms TEXT NOT NULL DEFAULT '',
      lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
      notes TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS procurement_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      manager_approval_limit NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (manager_approval_limit >= 0),
      updated_by BIGINT REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO procurement_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id BIGSERIAL PRIMARY KEY,
      request_number TEXT NOT NULL UNIQUE,
      requester_id BIGINT NOT NULL REFERENCES users(id),
      division TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      reason TEXT NOT NULL,
      urgency TEXT NOT NULL CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
      needed_by DATE,
      project_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'converted_to_po', 'cancelled')),
      rejection_reason TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS purchase_request_items (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES purchase_requests(id),
      inventory_item_id BIGINT REFERENCES inventory_items(id),
      item_name TEXT NOT NULL,
      quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      estimated_unit_price NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (estimated_unit_price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS purchase_request_approvals (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES purchase_requests(id),
      approver_id BIGINT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK (decision IN ('under_review', 'approved', 'rejected')),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS supplier_quotations (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES purchase_requests(id),
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
      supplier_quote_number TEXT NOT NULL DEFAULT '',
      valid_until DATE,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'selected', 'not_selected')),
      submitted_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS supplier_quotation_items (
      id BIGSERIAL PRIMARY KEY,
      quotation_id BIGINT NOT NULL REFERENCES supplier_quotations(id),
      request_item_id BIGINT NOT NULL REFERENCES purchase_request_items(id),
      item_name TEXT NOT NULL,
      quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_price NUMERIC(16, 2) NOT NULL CHECK (unit_price >= 0),
      UNIQUE (quotation_id, request_item_id)
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id BIGSERIAL PRIMARY KEY,
      po_number TEXT NOT NULL UNIQUE,
      request_id BIGINT NOT NULL REFERENCES purchase_requests(id),
      quotation_id BIGINT NOT NULL REFERENCES supplier_quotations(id),
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL CHECK (status IN ('pending_approval', 'issued', 'rejected', 'cancelled')),
      created_by BIGINT NOT NULL REFERENCES users(id),
      issued_by BIGINT REFERENCES users(id),
      rejection_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      issued_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id BIGSERIAL PRIMARY KEY,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
      request_item_id BIGINT NOT NULL REFERENCES purchase_request_items(id),
      item_name TEXT NOT NULL,
      quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_price NUMERIC(16, 2) NOT NULL CHECK (unit_price >= 0),
      UNIQUE (purchase_order_id, request_item_id)
    );
    CREATE TABLE IF NOT EXISTS purchase_order_approvals (
      id BIGSERIAL PRIMARY KEY,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
      approver_id BIGINT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK (decision IN ('submitted', 'approved', 'rejected')),
      note TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS task_progress_updates_task_idx ON task_progress_updates(task_id, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS documents_created_idx ON documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS inventory_items_category_idx ON inventory_items(category_id, is_active);
    CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements(item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_idx ON inventory_movements(warehouse_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers(company_name);
    CREATE INDEX IF NOT EXISTS purchase_requests_status_date_idx ON purchase_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS purchase_requests_requester_date_idx ON purchase_requests(requester_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS purchase_request_items_request_idx ON purchase_request_items(request_id);
    CREATE INDEX IF NOT EXISTS purchase_request_approvals_request_idx ON purchase_request_approvals(request_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS supplier_quotations_request_idx ON supplier_quotations(request_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS supplier_quotation_items_quote_idx ON supplier_quotation_items(quotation_id);
    CREATE INDEX IF NOT EXISTS purchase_orders_status_date_idx ON purchase_orders(status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_one_active_per_request_idx
      ON purchase_orders(request_id) WHERE status IN ('pending_approval', 'issued');
    CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON purchase_order_items(purchase_order_id);
    CREATE INDEX IF NOT EXISTS purchase_order_approvals_order_idx ON purchase_order_approvals(purchase_order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS login_rate_limits_reset_idx ON login_rate_limits(reset_at);
    CREATE INDEX IF NOT EXISTS app_sessions_expire_idx ON app_sessions(expire);
  `);

  await pool.query(`
    INSERT INTO inventory_categories (name, description)
    VALUES
      ('RAW MATERIAL', 'Bahan baku produksi'),
      ('SUPPORTING MATERIAL', 'Bahan pendukung produksi'),
      ('FINISHED GOODS', 'Produk jadi'),
      ('SPARE PARTS & CONSUMABLES', 'Suku cadang dan bahan habis pakai')
    ON CONFLICT (name) DO NOTHING;
    INSERT INTO warehouses (name, location)
    VALUES
      ('Gudang bahan baku', ''),
      ('Gudang bahan pendukung', ''),
      ('Gudang produk jadi', ''),
      ('Area penyimpanan produksi', '')
    ON CONFLICT (name) DO NOTHING;
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
  const originalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
  const mimeType = file.mimetype || 'application/octet-stream';
  if (s3 && bucketName) {
    const key = `${prefix}/${crypto.randomUUID()}-${originalName}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: mimeType,
      ContentDisposition: `attachment; filename="${originalName}"`
    }));
    return { key, data: null, name: originalName, mimeType };
  }
  return { key: null, data: file.buffer, name: originalName, mimeType };
}

async function removeUpload(uploadedFile) {
  if (uploadedFile?.key && s3 && bucketName) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadedFile.key }));
  }
}

async function signedDownload(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: key }), { expiresIn: 60 });
}

function sendStoredFile(res, file) {
  if (!file?.data) return res.status(404).json({ error: 'File tidak ditemukan.' });
  const safeName = String(file.name || 'download')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120) || 'download';
  res.set({
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  });
  return res.send(file.data);
}

async function getDashboardData(user) {
  const isDirector = user.role === 'DIREKTUR';
  const canViewFinance = ['DIREKTUR', 'KOMISARIS'].includes(user.role);
  const transactions = canViewFinance
    ? (await pool.query(`
        SELECT t.id, t.type, t.date, t.category, t.project_name, t.description, t.amount,
               t.payment_method, t.counterparty, t.created_by, t.created_at,
               (t.attachment_path IS NOT NULL OR t.attachment_data IS NOT NULL) AS has_attachment,
               u.name AS created_by_name
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

  const taskSummary = {
    assignedTasks: tasks.length,
    inProgressTasks: tasks.filter((task) => task.status === 'pending' || task.status === 'rejected').length,
    waitingTasks: tasks.filter((task) => task.status === 'in_review').length,
    approvedTasks: tasks.filter((task) => task.status === 'approved').length
  };
  const financialSummary = {
    balance: income - expense,
    income,
    expense,
    totalTransactions: transactions.length
  };
  const summary = isDirector
    ? {
        ...financialSummary,
        pendingVerification: tasks.filter((task) => task.status === 'in_review').length,
        approvedTasks: tasks.filter((task) => task.status === 'approved').length,
        totalBonus: tasks.reduce((sum, task) => sum + Number(task.bonus_amount || 0), 0)
      }
    : canViewFinance ? { ...financialSummary, ...taskSummary } : taskSummary;
  const visibleTasks = tasks.slice(0, 12).map((task) => {
    if (isDirector) return task;
    const { bonus_amount, evidence_path, verified_by, verifier_name, ...employeeTask } = task;
    return employeeTask;
  });

  return {
    role: user.role,
    summary,
    transactions: transactions.slice(0, 10),
    tasks: visibleTasks,
    activities,
    monthlySummary: canViewFinance ? monthlySummary : [],
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

app.post('/api/profile/change-pin', requireAuth, asyncRoute(async (req, res) => {
  const { current_pin, new_pin, confirm_pin } = req.body || {};
  const currentPin = String(current_pin || '');
  const newPin = String(new_pin || '');
  const confirmPin = String(confirm_pin || '');
  if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin) || newPin !== confirmPin) {
    return res.status(400).json({ error: 'PIN saat ini harus valid dan PIN baru harus cocok, masing-masing 6 digit.' });
  }
  if (currentPin === newPin) {
    return res.status(400).json({ error: 'PIN baru harus berbeda dari PIN saat ini.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT pin_hash FROM users WHERE id = $1 FOR UPDATE', [req.session.user.id]);
    const user = userResult.rows[0];
    if (!user || !bcrypt.compareSync(currentPin, user.pin_hash)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'PIN saat ini tidak sesuai.' });
    }

    await client.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [
      bcrypt.hashSync(newPin, 12),
      req.session.user.id
    ]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, 'PIN_CHANGED', 'User changed their own PIN.', $2)
    `, [req.session.user.id, req.ip || 'unknown']);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

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

const INVENTORY_VIEW_ROLES = ['DIREKTUR', 'MANAGER', 'KOMISARIS'];
const INVENTORY_WRITE_ROLES = ['DIREKTUR', 'MANAGER'];
function isValidInventoryDecimal(value, maxDecimals = 6) {
  return new RegExp(`^\\d{1,14}(?:\\.\\d{1,${maxDecimals}})?$`).test(String(value ?? ''));
}

function isValidInventoryUnit(value) {
  return /^[A-Z][A-Z0-9 _.-]{0,19}$/.test(value);
}

function normalizeDecimal(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`.replace(/\.$/, '');
}

async function withInventoryAudit(userId, action, details, ip, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    const auditDetails = typeof details === 'function' ? details(result.rows[0]) : details;
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4)
    `, [userId, action, auditDetails, ip || 'unknown']);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/inventory', requireAuth, requireRole(...INVENTORY_VIEW_ROLES), asyncRoute(async (_req, res) => {
  const [categories, warehouses, items, movements, valuation] = await Promise.all([
    pool.query(`
      SELECT id, name, description, is_active, created_at, updated_at
      FROM inventory_categories
      ORDER BY name
    `),
    pool.query(`
      SELECT id, name, location, is_active, created_at, updated_at
      FROM warehouses
      ORDER BY name
    `),
    pool.query(`
      SELECT i.id, i.sku, i.name, i.category_id, c.name AS category_name,
             i.description, i.base_unit, i.alternate_unit, i.conversion_factor,
             i.min_stock, i.max_stock, i.reference_price, i.default_warehouse_id,
             w.name AS default_warehouse_name, i.is_active,
             COALESCE(SUM(b.on_hand), 0)::TEXT AS total_stock,
             COALESCE(SUM(b.on_hand * b.average_cost), 0)::TEXT AS total_value,
             CASE WHEN COALESCE(SUM(b.on_hand), 0) <= i.min_stock THEN TRUE ELSE FALSE END AS is_low_stock,
             i.created_at, i.updated_at
      FROM inventory_items i
      JOIN inventory_categories c ON c.id = i.category_id
      LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
      LEFT JOIN inventory_balances b ON b.item_id = i.id
      GROUP BY i.id, c.name, w.name
      ORDER BY i.name
    `),
    pool.query(`
      SELECT m.id, m.movement_type, m.quantity::TEXT, m.unit, m.quantity_base::TEXT,
             m.unit_cost_base::TEXT, m.balance_after::TEXT, m.reference, m.notes, m.created_at,
             i.sku, i.name AS item_name, w.name AS warehouse_name, u.name AS created_by_name
      FROM inventory_movements m
      JOIN inventory_items i ON i.id = m.item_id
      JOIN warehouses w ON w.id = m.warehouse_id
      JOIN users u ON u.id = m.created_by
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 30
    `),
    pool.query(`
      SELECT COALESCE(SUM(b.on_hand * b.average_cost), 0)::TEXT AS total_value
      FROM inventory_balances b
      JOIN inventory_items i ON i.id = b.item_id
      WHERE i.is_active = TRUE
    `)
  ]);
  const activeItems = items.rows.filter((item) => item.is_active);
  const lowStockItems = activeItems.filter((item) => item.is_low_stock);
  res.json({
    summary: {
      totalItems: activeItems.length,
      lowStockItems: lowStockItems.length,
      outOfStockItems: activeItems.filter((item) => normalizeDecimal(item.total_stock) === '0').length,
      totalInventoryValue: valuation.rows[0].total_value
    },
    categories: categories.rows,
    warehouses: warehouses.rows,
    items: items.rows,
    movements: movements.rows
  });
}));

app.post('/api/inventory/categories', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  if (name.length < 2 || name.length > 80 || description.length > 500) {
    return res.status(400).json({ error: 'Nama kategori (2-80 karakter) dan deskripsi yang valid wajib diisi.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'INVENTORY_CATEGORY_CREATED',
    `Created category ${name}.`,
    req.ip,
    (client) => client.query(`
      INSERT INTO inventory_categories (name, description, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [name, description, req.session.user.id])
  );
  res.status(201).json(result.rows[0]);
}));

app.patch('/api/inventory/categories/:id', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const categoryId = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const isActive = req.body?.is_active;
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0
    || name.length < 2 || name.length > 80 || description.length > 500 || typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'Nama, deskripsi, dan status kategori tidak valid.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'INVENTORY_CATEGORY_UPDATED',
    `Updated category #${categoryId}.`,
    req.ip,
    async (client) => {
      const updated = await client.query(`
        UPDATE inventory_categories
        SET name = $1, description = $2, is_active = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, name, description, is_active, updated_at
      `, [name, description, isActive, categoryId]);
      if (!updated.rowCount) {
        const error = new Error('Kategori tidak ditemukan.');
        error.status = 404;
        throw error;
      }
      return updated;
    }
  );
  res.json(result.rows[0]);
}));

app.post('/api/inventory/warehouses', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const location = String(req.body?.location || '').trim();
  if (name.length < 2 || name.length > 100 || location.length > 250) {
    return res.status(400).json({ error: 'Nama gudang dan lokasi yang valid wajib diisi.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'INVENTORY_WAREHOUSE_CREATED',
    `Created warehouse ${name}.`,
    req.ip,
    (client) => client.query(`
      INSERT INTO warehouses (name, location, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, name, location, is_active, created_at, updated_at
    `, [name, location, req.session.user.id])
  );
  res.status(201).json(result.rows[0]);
}));

app.patch('/api/inventory/warehouses/:id', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const warehouseId = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const location = String(req.body?.location || '').trim();
  const isActive = req.body?.is_active;
  if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0
    || name.length < 2 || name.length > 100 || location.length > 250 || typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'Nama, lokasi, dan status gudang tidak valid.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT id FROM warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Gudang tidak ditemukan.' });
    }
    if (!isActive) {
      const stock = await client.query(
        'SELECT EXISTS (SELECT 1 FROM inventory_balances WHERE warehouse_id = $1 AND on_hand > 0) AS has_stock',
        [warehouseId]
      );
      if (stock.rows[0].has_stock) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Gudang masih memiliki stok dan tidak dapat dinonaktifkan.' });
      }
    }
    const result = await client.query(`
      UPDATE warehouses
      SET name = $1, location = $2, is_active = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING id, name, location, is_active, updated_at
    `, [name, location, isActive, warehouseId]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, 'INVENTORY_WAREHOUSE_UPDATED', $2, $3)
    `, [req.session.user.id, `Updated warehouse #${warehouseId}.`, req.ip || 'unknown']);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/inventory/items', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const baseUnit = String(body.base_unit || '').trim().toUpperCase();
  const alternateUnit = String(body.alternate_unit || '').trim().toUpperCase() || null;
  const minStock = String(body.min_stock ?? '0');
  const maxStock = body.max_stock === '' || body.max_stock == null ? null : String(body.max_stock);
  const referencePrice = String(body.reference_price ?? '0');
  const conversionFactor = body.conversion_factor === '' || body.conversion_factor == null
    ? null
    : String(body.conversion_factor);
  if (
    name.length < 2 || name.length > 120 || description.length > 1000
    || !isValidInventoryUnit(baseUnit)
    || (alternateUnit && (!isValidInventoryUnit(alternateUnit) || alternateUnit === baseUnit))
    || !isValidInventoryDecimal(minStock)
    || (maxStock !== null && !isValidInventoryDecimal(maxStock))
    || !isValidInventoryDecimal(referencePrice, 2)
    || (alternateUnit && (!conversionFactor || !isValidInventoryDecimal(conversionFactor) || Number(conversionFactor) <= 0))
    || (!alternateUnit && conversionFactor !== null)
  ) {
    return res.status(400).json({ error: 'Data barang tidak valid. Periksa nama, satuan, konversi, stok minimum, dan harga.' });
  }
  if (maxStock !== null) {
    const stockLimits = await pool.query(
      'SELECT $1::NUMERIC >= $2::NUMERIC AS valid',
      [maxStock, minStock]
    );
    if (!stockLimits.rows[0].valid) {
      return res.status(400).json({ error: 'Stok maksimum tidak boleh kurang dari stok minimum.' });
    }
  }
  const categoryId = Number(body.category_id);
  const defaultWarehouseId = body.default_warehouse_id ? Number(body.default_warehouse_id) : null;
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0
    || (defaultWarehouseId !== null && (!Number.isSafeInteger(defaultWarehouseId) || defaultWarehouseId <= 0))) {
    return res.status(400).json({ error: 'Kategori atau gudang bawaan tidak valid.' });
  }
  const category = await pool.query(
    'SELECT id FROM inventory_categories WHERE id = $1 AND is_active = TRUE',
    [categoryId]
  );
  if (!category.rowCount) return res.status(400).json({ error: 'Kategori tidak ditemukan atau nonaktif.' });
  if (defaultWarehouseId !== null) {
    const warehouse = await pool.query(
      'SELECT id FROM warehouses WHERE id = $1 AND is_active = TRUE',
      [defaultWarehouseId]
    );
    if (!warehouse.rowCount) return res.status(400).json({ error: 'Gudang bawaan tidak ditemukan atau nonaktif.' });
  }

  const result = await withInventoryAudit(
    req.session.user.id,
    'INVENTORY_ITEM_CREATED',
    (row) => `Created inventory item ${row.sku}.`,
    req.ip,
    (client) => client.query(`
    INSERT INTO inventory_items (
      name, category_id, description, base_unit, alternate_unit, conversion_factor,
      min_stock, max_stock, reference_price, default_warehouse_id, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::NUMERIC, $8::NUMERIC, $9::NUMERIC, $10, $11)
    RETURNING id, sku, name, category_id, description, base_unit, alternate_unit,
              conversion_factor, min_stock, max_stock, reference_price, default_warehouse_id,
              is_active, created_at, updated_at
  `, [
    name, categoryId, description, baseUnit, alternateUnit, conversionFactor,
    minStock, maxStock, referencePrice, defaultWarehouseId, req.session.user.id
    ])
  );
  res.status(201).json(result.rows[0]);
}));

app.patch('/api/inventory/items/:id', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const itemId = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const minStock = String(req.body?.min_stock ?? '');
  const maxStock = req.body?.max_stock === '' || req.body?.max_stock == null
    ? null
    : String(req.body.max_stock);
  const referencePrice = String(req.body?.reference_price ?? '');
  const isActive = req.body?.is_active;
  const categoryId = Number(req.body?.category_id);
  const defaultWarehouseId = req.body?.default_warehouse_id ? Number(req.body.default_warehouse_id) : null;
  if (
    !Number.isSafeInteger(itemId) || itemId <= 0
    || name.length < 2 || name.length > 120 || description.length > 1000
    || !isValidInventoryDecimal(minStock)
    || (maxStock !== null && !isValidInventoryDecimal(maxStock))
    || !isValidInventoryDecimal(referencePrice, 2)
    || typeof isActive !== 'boolean'
    || !Number.isSafeInteger(categoryId) || categoryId <= 0
    || (defaultWarehouseId !== null && (!Number.isSafeInteger(defaultWarehouseId) || defaultWarehouseId <= 0))
  ) {
    return res.status(400).json({ error: 'Data barang tidak valid.' });
  }
  const category = await pool.query(
    'SELECT id FROM inventory_categories WHERE id = $1 AND is_active = TRUE',
    [categoryId]
  );
  if (!category.rowCount) return res.status(400).json({ error: 'Kategori tidak ditemukan atau nonaktif.' });
  if (defaultWarehouseId !== null) {
    const warehouse = await pool.query(
      'SELECT id FROM warehouses WHERE id = $1 AND is_active = TRUE',
      [defaultWarehouseId]
    );
    if (!warehouse.rowCount) return res.status(400).json({ error: 'Gudang bawaan tidak ditemukan atau nonaktif.' });
  }
  if (maxStock !== null) {
    const stockLimits = await pool.query(
      'SELECT $1::NUMERIC >= $2::NUMERIC AS valid',
      [maxStock, minStock]
    );
    if (!stockLimits.rows[0].valid) {
      return res.status(400).json({ error: 'Stok maksimum tidak boleh kurang dari stok minimum.' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT id, sku FROM inventory_items WHERE id = $1 FOR UPDATE',
      [itemId]
    );
    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Barang tidak ditemukan.' });
    }
    if (!isActive) {
      const stock = await client.query(
        'SELECT EXISTS (SELECT 1 FROM inventory_balances WHERE item_id = $1 AND on_hand > 0) AS has_stock',
        [itemId]
      );
      if (stock.rows[0].has_stock) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Barang masih memiliki stok dan tidak dapat dinonaktifkan.' });
      }
    }
    const result = await client.query(`
      UPDATE inventory_items
      SET name = $1, description = $2, category_id = $3, default_warehouse_id = $4,
          min_stock = $5::NUMERIC, max_stock = $6::NUMERIC,
          reference_price = $7::NUMERIC, is_active = $8, updated_at = NOW()
      WHERE id = $9
      RETURNING id, sku, name, description, category_id, default_warehouse_id,
                min_stock, max_stock, reference_price, is_active, updated_at
    `, [name, description, categoryId, defaultWarehouseId, minStock, maxStock, referencePrice, isActive, itemId]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, 'INVENTORY_ITEM_UPDATED', $2, $3)
    `, [req.session.user.id, `Updated inventory item ${result.rows[0].sku}.`, req.ip || 'unknown']);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/inventory/movements', requireAuth, requireRole(...INVENTORY_WRITE_ROLES), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const movementType = String(body.movement_type || '').toUpperCase();
  const idempotencyKey = String(body.idempotency_key || '');
  const itemId = Number(body.item_id);
  const warehouseId = Number(body.warehouse_id);
  const quantity = String(body.quantity ?? '');
  const unit = String(body.unit || '').trim().toUpperCase();
  const unitCost = String(body.unit_cost ?? '0');
  const reference = String(body.reference || '').trim();
  const notes = String(body.notes || '').trim();
  if (
    !['IN', 'OUT'].includes(movementType)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    || !Number.isSafeInteger(itemId) || itemId <= 0
    || !Number.isSafeInteger(warehouseId) || warehouseId <= 0
    || !isValidInventoryDecimal(quantity, 6) || Number(quantity) <= 0
    || !isValidInventoryDecimal(unitCost, 2)
    || (movementType === 'OUT' && normalizeDecimal(unitCost) !== '0')
    || reference.length > 120 || notes.length > 1000
  ) {
    return res.status(400).json({ error: 'Data mutasi stok tidak valid.' });
  }

  const client = await pool.connect();
  const matchesMovement = (movement) => (
    String(movement.created_by) === String(req.session.user.id)
    && movement.movement_type === movementType
    && String(movement.item_id) === String(itemId)
    && String(movement.warehouse_id) === String(warehouseId)
    && normalizeDecimal(movement.quantity) === normalizeDecimal(quantity)
    && movement.unit === unit
    && normalizeDecimal(movement.unit_cost_entered) === normalizeDecimal(unitCost)
    && movement.reference === reference
    && movement.notes === notes
  );
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT * FROM inventory_movements WHERE idempotency_key = $1 FOR UPDATE',
      [idempotencyKey]
    );
    if (existing.rowCount) {
      if (!matchesMovement(existing.rows[0])) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Kunci permintaan sudah digunakan untuk transaksi berbeda.' });
      }
      await client.query('COMMIT');
      return res.json({
        success: true,
        duplicate: true,
        id: existing.rows[0].id,
        balance_after: existing.rows[0].balance_after
      });
    }

    const itemResult = await client.query(`
      SELECT id, base_unit, alternate_unit, conversion_factor::TEXT
      FROM inventory_items
      WHERE id = $1 AND is_active = TRUE
      FOR SHARE
    `, [itemId]);
    if (!itemResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Barang tidak ditemukan atau nonaktif.' });
    }
    const item = itemResult.rows[0];
    let conversionFactor = '1';
    if (unit === item.base_unit) {
      conversionFactor = '1';
    } else if (unit === item.alternate_unit && item.conversion_factor) {
      conversionFactor = item.conversion_factor;
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Satuan mutasi tidak sesuai dengan satuan barang.' });
    }
    const warehouse = await client.query(
      'SELECT id FROM warehouses WHERE id = $1 AND is_active = TRUE FOR SHARE',
      [warehouseId]
    );
    if (!warehouse.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Gudang tidak ditemukan atau nonaktif.' });
    }
    const quantityResult = await client.query(
      'SELECT ($1::NUMERIC * $2::NUMERIC)::TEXT AS quantity_base',
      [quantity, conversionFactor]
    );
    const quantityBase = quantityResult.rows[0].quantity_base;
    await client.query(`
      INSERT INTO inventory_balances (item_id, warehouse_id)
      VALUES ($1, $2)
      ON CONFLICT (item_id, warehouse_id) DO NOTHING
    `, [itemId, warehouseId]);
    const balanceResult = await client.query(`
      SELECT on_hand::TEXT, average_cost::TEXT
      FROM inventory_balances
      WHERE item_id = $1 AND warehouse_id = $2
      FOR UPDATE
    `, [itemId, warehouseId]);
    const balance = balanceResult.rows[0];
    let unitCostBase;
    if (movementType === 'IN') {
      const costResult = await client.query(
        'SELECT ($1::NUMERIC / $2::NUMERIC)::NUMERIC(20, 6)::TEXT AS unit_cost_base',
        [unitCost, conversionFactor]
      );
      unitCostBase = costResult.rows[0].unit_cost_base;
      const updatedBalance = await client.query(`
        UPDATE inventory_balances
        SET on_hand = on_hand + $1::NUMERIC,
            average_cost = CASE
              WHEN on_hand + $1::NUMERIC = 0 THEN $2::NUMERIC
              ELSE ((on_hand * average_cost) + ($1::NUMERIC * $2::NUMERIC))
                   / (on_hand + $1::NUMERIC)
            END,
            updated_at = NOW()
        WHERE item_id = $3 AND warehouse_id = $4
        RETURNING on_hand::TEXT
      `, [quantityBase, unitCostBase, itemId, warehouseId]);
      balance.on_hand = updatedBalance.rows[0].on_hand;
    } else {
      const sufficient = await client.query(
        'SELECT on_hand >= $1::NUMERIC AS sufficient FROM inventory_balances WHERE item_id = $2 AND warehouse_id = $3',
        [quantityBase, itemId, warehouseId]
      );
      if (!sufficient.rows[0].sufficient) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Stok tidak mencukupi. Pengeluaran dibatalkan.' });
      }
      unitCostBase = balance.average_cost;
      const updatedBalance = await client.query(`
        UPDATE inventory_balances
        SET on_hand = on_hand - $1::NUMERIC, updated_at = NOW()
        WHERE item_id = $2 AND warehouse_id = $3
        RETURNING on_hand::TEXT
      `, [quantityBase, itemId, warehouseId]);
      balance.on_hand = updatedBalance.rows[0].on_hand;
    }

    const movement = await client.query(`
      INSERT INTO inventory_movements (
        idempotency_key, item_id, warehouse_id, movement_type, quantity, unit,
        quantity_base, unit_cost_entered, unit_cost_base, balance_after, reference, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5::NUMERIC, $6, $7::NUMERIC, $8::NUMERIC,
              $9::NUMERIC, $10::NUMERIC, $11, $12, $13)
      RETURNING id, balance_after::TEXT
    `, [
      idempotencyKey, itemId, warehouseId, movementType, quantity, unit,
      quantityBase, unitCost, unitCostBase, balance.on_hand, reference, notes, req.session.user.id
    ]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4)
    `, [
      req.session.user.id,
      `INVENTORY_STOCK_${movementType}`,
      `${movementType} ${quantity} ${unit} of item #${itemId} at warehouse #${warehouseId}.`,
      req.ip || 'unknown'
    ]);
    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      id: movement.rows[0].id,
      balance_after: movement.rows[0].balance_after
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      const duplicate = await pool.query(
        'SELECT * FROM inventory_movements WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (duplicate.rowCount && matchesMovement(duplicate.rows[0])) {
        return res.json({
          success: true,
          duplicate: true,
          id: duplicate.rows[0].id,
          balance_after: duplicate.rows[0].balance_after
        });
      }
      if (duplicate.rowCount) {
        return res.status(409).json({ error: 'Kunci permintaan sudah digunakan untuk transaksi berbeda.' });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}));

const PROCUREMENT_VIEW_ROLES = ['DIREKTUR', 'MANAGER', 'KOMISARIS', 'KARYAWAN'];
const PROCUREMENT_WRITE_ROLES = ['DIREKTUR', 'MANAGER', 'KARYAWAN'];
const PROCUREMENT_APPROVER_ROLES = ['DIREKTUR', 'MANAGER'];

app.get('/api/procurement', requireAuth, requireRole(...PROCUREMENT_VIEW_ROLES), asyncRoute(async (req, res) => {
  const isDirector = req.session.user.role === 'DIREKTUR';
  const canReview = ['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(req.session.user.role);
  const [suppliers, requests, settings, quotations, purchaseOrders] = await Promise.all([
    pool.query(`
      SELECT id, supplier_code, company_name, contact_name, phone, whatsapp, email, address,
             city_province, category, tax_id, ${isDirector ? 'bank_details' : "''::TEXT AS bank_details"},
             payment_terms, lead_time_days, notes, is_active, created_at, updated_at
      FROM suppliers
      ORDER BY company_name
    `),
    pool.query(`
      SELECT pr.id, pr.requester_id, pr.request_number, pr.division, pr.category, pr.reason, pr.urgency,
             pr.needed_by, pr.project_name, pr.status, pr.rejection_reason,
             pr.created_at, pr.updated_at, pr.reviewed_at,
             u.name AS requester_name, u.role AS requester_role,
             COALESCE(lines.items, '[]'::JSON) AS items,
             COALESCE(lines.total, 0)::TEXT AS total_estimate,
             COALESCE(approvals.history, '[]'::JSON) AS approval_history
      FROM purchase_requests pr
      JOIN users u ON u.id = pr.requester_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'id', pri.id,
          'inventory_item_id', pri.inventory_item_id,
          'item_name', pri.item_name,
          'quantity', pri.quantity::TEXT,
          'unit', pri.unit,
          'estimated_unit_price', pri.estimated_unit_price::TEXT,
          'line_total', (pri.quantity * pri.estimated_unit_price)::TEXT
        ) ORDER BY pri.id) AS items,
        SUM(pri.quantity * pri.estimated_unit_price) AS total
        FROM purchase_request_items pri
        WHERE pri.request_id = pr.id
      ) lines ON TRUE
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'decision', pra.decision,
          'note', pra.note,
          'approver_name', approver.name,
          'created_at', pra.created_at
        ) ORDER BY pra.created_at DESC, pra.id DESC) AS history
        FROM purchase_request_approvals pra
        JOIN users approver ON approver.id = pra.approver_id
        WHERE pra.request_id = pr.id
      ) approvals ON TRUE
      WHERE ($1::BOOLEAN OR pr.requester_id = $2)
      ORDER BY pr.created_at DESC, pr.id DESC
      LIMIT 200
    `, [['DIREKTUR', 'MANAGER', 'KOMISARIS'].includes(req.session.user.role), req.session.user.id]),
    pool.query('SELECT manager_approval_limit::TEXT FROM procurement_settings WHERE id = 1'),
    pool.query(`
      SELECT q.id, q.request_id, q.supplier_id, q.supplier_quote_number, q.valid_until,
             q.notes, q.status, q.created_at, q.updated_at, s.company_name, s.supplier_code,
             pr.request_number,
             COALESCE(lines.items, '[]'::JSON) AS items,
             COALESCE(lines.total, 0)::TEXT AS total
      FROM supplier_quotations q
      JOIN suppliers s ON s.id = q.supplier_id
      JOIN purchase_requests pr ON pr.id = q.request_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'request_item_id', qi.request_item_id,
          'item_name', qi.item_name,
          'quantity', qi.quantity::TEXT,
          'unit', qi.unit,
          'unit_price', qi.unit_price::TEXT,
          'line_total', (qi.quantity * qi.unit_price)::TEXT
        ) ORDER BY qi.id) AS items,
        SUM(qi.quantity * qi.unit_price) AS total
        FROM supplier_quotation_items qi
        WHERE qi.quotation_id = q.id
      ) lines ON TRUE
      WHERE $1::BOOLEAN
      ORDER BY q.request_id, lines.total ASC NULLS LAST, q.created_at DESC, q.id DESC
      LIMIT 500
    `, [canReview]),
    pool.query(`
      SELECT po.id, po.po_number, po.request_id, po.quotation_id, po.supplier_id,
             po.status, po.created_by, po.issued_by, po.rejection_reason,
             po.created_at, po.updated_at, po.issued_at,
             s.company_name, s.supplier_code, pr.request_number, creator.name AS creator_name,
             issuer.name AS issuer_name,
             COALESCE(lines.items, '[]'::JSON) AS items,
             COALESCE(lines.total, 0)::TEXT AS total,
             COALESCE(history.entries, '[]'::JSON) AS approval_history
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_requests pr ON pr.id = po.request_id
      JOIN users creator ON creator.id = po.created_by
      LEFT JOIN users issuer ON issuer.id = po.issued_by
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'item_name', poi.item_name,
          'quantity', poi.quantity::TEXT,
          'unit', poi.unit,
          'unit_price', poi.unit_price::TEXT,
          'line_total', (poi.quantity * poi.unit_price)::TEXT
        ) ORDER BY poi.id) AS items,
        SUM(poi.quantity * poi.unit_price) AS total
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ) lines ON TRUE
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'decision', poa.decision,
          'note', poa.note,
          'approver_name', approver.name,
          'created_at', poa.created_at
        ) ORDER BY poa.created_at DESC, poa.id DESC) AS entries
        FROM purchase_order_approvals poa
        JOIN users approver ON approver.id = poa.approver_id
        WHERE poa.purchase_order_id = po.id
      ) history ON TRUE
      WHERE $1::BOOLEAN
      ORDER BY po.created_at DESC, po.id DESC
      LIMIT 500
    `, [canReview])
  ]);
  res.json({
    suppliers: suppliers.rows,
    requests: requests.rows,
    quotations: quotations.rows,
    purchaseOrders: purchaseOrders.rows,
    managerApprovalLimit: isDirector ? (settings.rows[0]?.manager_approval_limit || '0') : null
  });
}));

app.post('/api/procurement/suppliers', requireAuth, requireRole('DIREKTUR', 'MANAGER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const companyName = String(body.company_name || '').trim();
  const contactName = String(body.contact_name || '').trim();
  const phone = String(body.phone || '').trim();
  const whatsapp = String(body.whatsapp || '').trim();
  const email = String(body.email || '').trim();
  const address = String(body.address || '').trim();
  const cityProvince = String(body.city_province || '').trim();
  const category = String(body.category || '').trim();
  const taxId = String(body.tax_id || '').trim();
  const bankDetails = req.session.user.role === 'DIREKTUR' ? String(body.bank_details || '').trim() : '';
  const paymentTerms = String(body.payment_terms || '').trim();
  const notes = String(body.notes || '').trim();
  const leadTime = body.lead_time_days === '' || body.lead_time_days == null ? null : Number(body.lead_time_days);
  if (
    companyName.length < 2 || companyName.length > 160
    || contactName.length > 120 || phone.length > 40 || whatsapp.length > 40
    || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || address.length > 500 || cityProvince.length > 120 || category.length > 120
    || taxId.length > 40 || bankDetails.length > 500 || paymentTerms.length > 160
    || (leadTime !== null && (!Number.isInteger(leadTime) || leadTime < 0 || leadTime > 3650))
    || notes.length > 1000
  ) {
    return res.status(400).json({ error: 'Data supplier tidak valid. Periksa nama, email, dan batas panjang setiap kolom.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'SUPPLIER_CREATED',
    `Created supplier ${companyName}.`,
    req.ip,
    (client) => client.query(`
      INSERT INTO suppliers (
        company_name, contact_name, phone, whatsapp, email, address, city_province,
        category, tax_id, bank_details, payment_terms, lead_time_days, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, supplier_code, company_name, contact_name, phone, whatsapp, email,
                address, city_province, category, tax_id, bank_details, payment_terms,
                lead_time_days, notes, is_active, created_at, updated_at
    `, [
      companyName, contactName, phone, whatsapp, email, address, cityProvince, category,
      taxId, bankDetails, paymentTerms, leadTime, notes, req.session.user.id
    ])
  );
  res.status(201).json(result.rows[0]);
}));

app.patch('/api/procurement/suppliers/:id', requireAuth, requireRole('DIREKTUR', 'MANAGER'), asyncRoute(async (req, res) => {
  const supplierId = Number(req.params.id);
  const body = req.body || {};
  const companyName = String(body.company_name || '').trim();
  const contactName = String(body.contact_name || '').trim();
  const phone = String(body.phone || '').trim();
  const whatsapp = String(body.whatsapp || '').trim();
  const email = String(body.email || '').trim();
  const address = String(body.address || '').trim();
  const cityProvince = String(body.city_province || '').trim();
  const category = String(body.category || '').trim();
  const taxId = String(body.tax_id || '').trim();
  const bankDetails = req.session.user.role === 'DIREKTUR' ? String(body.bank_details || '').trim() : null;
  const paymentTerms = String(body.payment_terms || '').trim();
  const notes = String(body.notes || '').trim();
  const leadTime = body.lead_time_days === '' || body.lead_time_days == null ? null : Number(body.lead_time_days);
  const isActive = body.is_active;
  if (
    !Number.isSafeInteger(supplierId) || supplierId <= 0
    || companyName.length < 2 || companyName.length > 160
    || contactName.length > 120 || phone.length > 40 || whatsapp.length > 40
    || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || address.length > 500 || cityProvince.length > 120 || category.length > 120
    || taxId.length > 40 || (bankDetails !== null && bankDetails.length > 500)
    || paymentTerms.length > 160
    || (leadTime !== null && (!Number.isInteger(leadTime) || leadTime < 0 || leadTime > 3650))
    || notes.length > 1000 || typeof isActive !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Data supplier tidak valid.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'SUPPLIER_UPDATED',
    `Updated supplier #${supplierId}.`,
    req.ip,
    async (client) => {
      const updated = await client.query(`
        UPDATE suppliers
        SET company_name = $1, contact_name = $2, phone = $3, whatsapp = $4, email = $5,
            address = $6, city_province = $7, category = $8, tax_id = $9,
            bank_details = CASE WHEN $10::TEXT IS NULL THEN bank_details ELSE $10 END,
            payment_terms = $11, lead_time_days = $12, notes = $13,
            is_active = $14, updated_at = NOW()
        WHERE id = $15
        RETURNING id, supplier_code, company_name, contact_name, phone, whatsapp, email,
                  address, city_province, category, tax_id, bank_details, payment_terms,
                  lead_time_days, notes, is_active, updated_at
      `, [
        companyName, contactName, phone, whatsapp, email, address, cityProvince, category,
        taxId, bankDetails, paymentTerms, leadTime, notes, isActive, supplierId
      ]);
      if (!updated.rowCount) {
        const error = new Error('Supplier tidak ditemukan.');
        error.status = 404;
        throw error;
      }
      return updated;
    }
  );
  if (req.session.user.role !== 'DIREKTUR') delete result.rows[0].bank_details;
  res.json(result.rows[0]);
}));

app.put('/api/procurement/settings/manager-approval-limit', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const value = String(req.body?.manager_approval_limit ?? '');
  if (!isValidInventoryDecimal(value, 2)) {
    return res.status(400).json({ error: 'Batas approval Manager harus berupa nominal Rupiah nol atau lebih.' });
  }
  const result = await withInventoryAudit(
    req.session.user.id,
    'PROCUREMENT_APPROVAL_LIMIT_UPDATED',
    `Updated Manager approval limit to Rp${value}.`,
    req.ip,
    (client) => client.query(`
      UPDATE procurement_settings
      SET manager_approval_limit = $1::NUMERIC, updated_by = $2, updated_at = NOW()
      WHERE id = 1
      RETURNING manager_approval_limit::TEXT
    `, [value, req.session.user.id])
  );
  res.json({ manager_approval_limit: result.rows[0].manager_approval_limit });
}));

app.post('/api/procurement/requests', requireAuth, requireRole(...PROCUREMENT_WRITE_ROLES), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const division = String(body.division || '').trim();
  const category = String(body.category || '').trim();
  const reason = String(body.reason || '').trim();
  const urgency = String(body.urgency || 'normal');
  const projectName = String(body.project_name || '').trim();
  const neededBy = body.needed_by ? String(body.needed_by) : null;
  const items = body.items;
  if (
    division.length > 120 || category.length < 2 || category.length > 120
    || reason.length < 3 || reason.length > 1500
    || !['low', 'normal', 'high', 'urgent'].includes(urgency)
    || projectName.length > 160
    || (neededBy && !isValidIsoDate(neededBy))
    || !Array.isArray(items) || items.length < 1 || items.length > 30
  ) {
    return res.status(400).json({ error: 'Data PR tidak lengkap atau tidak valid.' });
  }
  const normalizedItems = [];
  for (const item of items) {
    const itemName = String(item?.item_name || '').trim();
    const unit = String(item?.unit || '').trim().toUpperCase();
    const quantity = String(item?.quantity ?? '');
    const estimatedUnitPrice = String(item?.estimated_unit_price ?? '0');
    const inventoryItemId = item?.inventory_item_id ? Number(item.inventory_item_id) : null;
    if (
      itemName.length < 2 || itemName.length > 160
      || !isValidInventoryUnit(unit)
      || !isValidInventoryDecimal(quantity) || normalizeDecimal(quantity) === '0'
      || !isValidInventoryDecimal(estimatedUnitPrice, 2)
      || (inventoryItemId !== null && (!Number.isSafeInteger(inventoryItemId) || inventoryItemId <= 0))
    ) {
      return res.status(400).json({ error: 'Setiap barang PR wajib memiliki nama, satuan, jumlah, dan estimasi harga yang valid.' });
    }
    normalizedItems.push({ itemName, unit, quantity, estimatedUnitPrice, inventoryItemId });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numberResult = await client.query(`
      SELECT 'PR-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' ||
             LPAD(nextval('purchase_request_number_seq')::TEXT, 6, '0') AS request_number
    `);
    const request = await client.query(`
      INSERT INTO purchase_requests (
        request_number, requester_id, division, category, reason, urgency, needed_by,
        project_name, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::DATE, $8, 'submitted')
      RETURNING id, request_number
    `, [
      numberResult.rows[0].request_number, req.session.user.id, division,
      category, reason, urgency, neededBy, projectName
    ]);
    for (const item of normalizedItems) {
      if (item.inventoryItemId !== null) {
        const inventoryItem = await client.query(`
          SELECT name, base_unit, alternate_unit
          FROM inventory_items
          WHERE id = $1 AND is_active = TRUE
        `, [item.inventoryItemId]);
        if (!inventoryItem.rowCount
          || ![inventoryItem.rows[0].base_unit, inventoryItem.rows[0].alternate_unit].includes(item.unit)) {
          const error = new Error('Barang inventory yang dipilih nonaktif atau satuannya tidak sesuai.');
          error.status = 400;
          throw error;
        }
      }
      await client.query(`
        INSERT INTO purchase_request_items (
          request_id, inventory_item_id, item_name, quantity, unit, estimated_unit_price
        )
        VALUES ($1, $2, $3, $4::NUMERIC, $5, $6::NUMERIC)
      `, [
        request.rows[0].id, item.inventoryItemId, item.itemName,
        item.quantity, item.unit, item.estimatedUnitPrice
      ]);
    }
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, 'PURCHASE_REQUEST_SUBMITTED', $2, $3)
    `, [req.session.user.id, `Submitted purchase request ${request.rows[0].request_number}.`, req.ip || 'unknown']);
    await client.query('COMMIT');
    res.status(201).json({ success: true, id: request.rows[0].id, request_number: request.rows[0].request_number });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/procurement/requests/:id/decision', requireAuth, requireRole(...PROCUREMENT_APPROVER_ROLES), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const decision = String(req.body?.decision || '');
  const note = String(req.body?.note || '').trim();
  if (!Number.isSafeInteger(requestId) || requestId <= 0
    || !['under_review', 'approved', 'rejected'].includes(decision)
    || note.length > 1000
    || (decision === 'rejected' && note.length < 3)) {
    return res.status(400).json({ error: 'Keputusan tidak valid. Penolakan harus menyertakan alasan.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query(`
      SELECT pr.id, pr.requester_id, pr.status
      FROM purchase_requests pr
      WHERE pr.id = $1
      FOR UPDATE
    `, [requestId]);
    if (!request.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PR tidak ditemukan.' });
    }
    const record = request.rows[0];
    if (String(record.requester_id) === String(req.session.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Anda tidak dapat menyetujui atau meninjau PR yang Anda buat sendiri.' });
    }
    if (!['submitted', 'under_review'].includes(record.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'PR ini sudah diproses dan tidak dapat diubah lagi.' });
    }
    if (req.session.user.role === 'MANAGER' && decision === 'approved') {
      const estimate = await client.query(`
        SELECT COALESCE(SUM(quantity * estimated_unit_price), 0)::TEXT AS total_estimate
        FROM purchase_request_items
        WHERE request_id = $1
      `, [requestId]);
      const settings = await client.query(
        'SELECT manager_approval_limit::TEXT FROM procurement_settings WHERE id = 1 FOR SHARE'
      );
      const limit = settings.rows[0]?.manager_approval_limit || '0';
      const withinLimit = await client.query(
        'SELECT $1::NUMERIC <= $2::NUMERIC AND $2::NUMERIC > 0 AS valid',
        [estimate.rows[0].total_estimate, limit]
      );
      if (!withinLimit.rows[0].valid) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Nilai PR melebihi batas persetujuan Manager. Minta Direktur memeriksa PR ini.' });
      }
    }
    if (decision === 'under_review') {
      await client.query(`
        UPDATE purchase_requests SET status = 'under_review', updated_at = NOW()
        WHERE id = $1
      `, [requestId]);
    } else {
      await client.query(`
        UPDATE purchase_requests
        SET status = $1, rejection_reason = $2, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $3
      `, [decision, decision === 'rejected' ? note : '', requestId]);
    }
    await client.query(`
      INSERT INTO purchase_request_approvals (request_id, approver_id, decision, note)
      VALUES ($1, $2, $3, $4)
    `, [requestId, req.session.user.id, decision, note]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4)
    `, [
      req.session.user.id,
      `PURCHASE_REQUEST_${decision.toUpperCase()}`,
      `${decision} purchase request #${requestId}${note ? `: ${note}` : ''}`,
      req.ip || 'unknown'
    ]);
    await client.query('COMMIT');
    res.json({ success: true, status: decision });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/procurement/requests/:id/quotations', requireAuth, requireRole('DIREKTUR', 'MANAGER'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const supplierId = Number(req.body?.supplier_id);
  const quoteNumber = String(req.body?.supplier_quote_number || '').trim();
  const validUntil = req.body?.valid_until ? String(req.body.valid_until) : null;
  const notes = String(req.body?.notes || '').trim();
  const items = req.body?.items;
  if (!Number.isSafeInteger(requestId) || requestId <= 0
    || !Number.isSafeInteger(supplierId) || supplierId <= 0
    || quoteNumber.length > 100 || (validUntil && !isValidIsoDate(validUntil))
    || notes.length > 1000 || !Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ error: 'Data penawaran tidak lengkap atau tidak valid.' });
  }
  const normalizedItems = [];
  const seenItemIds = new Set();
  for (const item of items) {
    const requestItemId = Number(item?.request_item_id);
    const unitPrice = String(item?.unit_price ?? '');
    if (!Number.isSafeInteger(requestItemId) || requestItemId <= 0
      || seenItemIds.has(requestItemId) || !isValidInventoryDecimal(unitPrice, 2)) {
      return res.status(400).json({ error: 'Barang atau harga penawaran tidak valid.' });
    }
    seenItemIds.add(requestItemId);
    normalizedItems.push({ requestItemId, unitPrice });
  }

  const result = await withInventoryAudit(
    req.session.user.id,
    'SUPPLIER_QUOTATION_CREATED',
    `Recorded a supplier quotation for purchase request #${requestId}.`,
    req.ip,
    async (client) => {
      const request = await client.query(`
        SELECT status FROM purchase_requests WHERE id = $1 FOR UPDATE
      `, [requestId]);
      if (!request.rowCount) {
        const error = new Error('PR tidak ditemukan.');
        error.status = 404;
        throw error;
      }
      if (request.rows[0].status !== 'approved') {
        const error = new Error('Penawaran hanya dapat dicatat untuk PR yang sudah disetujui dan belum menjadi PO.');
        error.status = 409;
        throw error;
      }
      const activeOrder = await client.query(`
        SELECT id FROM purchase_orders
        WHERE request_id = $1 AND status IN ('pending_approval', 'issued')
      `, [requestId]);
      if (activeOrder.rowCount) {
        const error = new Error('PR ini sudah memiliki PO aktif.');
        error.status = 409;
        throw error;
      }
      const supplier = await client.query(`
        SELECT id FROM suppliers WHERE id = $1 AND is_active = TRUE FOR SHARE
      `, [supplierId]);
      if (!supplier.rowCount) {
        const error = new Error('Supplier tidak ditemukan atau sedang nonaktif.');
        error.status = 400;
        throw error;
      }
      const requestedItems = await client.query(`
        SELECT id, item_name, quantity::TEXT, unit
        FROM purchase_request_items
        WHERE request_id = $1
        ORDER BY id
        FOR SHARE
      `, [requestId]);
      if (requestedItems.rowCount !== normalizedItems.length
        || requestedItems.rows.some((requestedItem) => !seenItemIds.has(Number(requestedItem.id)))) {
        const error = new Error('Penawaran harus mengisi harga untuk seluruh barang pada PR.');
        error.status = 400;
        throw error;
      }
      const quotation = await client.query(`
        INSERT INTO supplier_quotations (
          request_id, supplier_id, supplier_quote_number, valid_until, notes, submitted_by
        )
        VALUES ($1, $2, $3, $4::DATE, $5, $6)
        RETURNING id
      `, [requestId, supplierId, quoteNumber, validUntil, notes, req.session.user.id]);
      const itemById = new Map(requestedItems.rows.map((item) => [Number(item.id), item]));
      for (const quoteItem of normalizedItems) {
        const requestedItem = itemById.get(quoteItem.requestItemId);
        await client.query(`
          INSERT INTO supplier_quotation_items (
            quotation_id, request_item_id, item_name, quantity, unit, unit_price
          )
          VALUES ($1, $2, $3, $4::NUMERIC, $5, $6::NUMERIC)
        `, [
          quotation.rows[0].id, requestedItem.id, requestedItem.item_name,
          requestedItem.quantity, requestedItem.unit, quoteItem.unitPrice
        ]);
      }
      return quotation;
    }
  );
  res.status(201).json({ success: true, id: result.rows[0].id });
}));

app.post('/api/procurement/requests/:id/purchase-orders', requireAuth, requireRole('DIREKTUR', 'MANAGER'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const quotationId = Number(req.body?.quotation_id);
  if (!Number.isSafeInteger(requestId) || requestId <= 0
    || !Number.isSafeInteger(quotationId) || quotationId <= 0) {
    return res.status(400).json({ error: 'PR atau penawaran tidak valid.' });
  }
  const isDirector = req.session.user.role === 'DIREKTUR';
  const result = await withInventoryAudit(
    req.session.user.id,
    'PURCHASE_ORDER_CREATED',
    (order) => `Created purchase order ${order.po_number} with status ${order.status}.`,
    req.ip,
    async (client) => {
      const request = await client.query(`
        SELECT status FROM purchase_requests WHERE id = $1 FOR UPDATE
      `, [requestId]);
      if (!request.rowCount) {
        const error = new Error('PR tidak ditemukan.');
        error.status = 404;
        throw error;
      }
      if (request.rows[0].status !== 'approved') {
        const error = new Error('PO hanya dapat dibuat dari PR yang sudah disetujui dan belum menjadi PO.');
        error.status = 409;
        throw error;
      }
      const existingOrder = await client.query(`
        SELECT id FROM purchase_orders
        WHERE request_id = $1 AND status IN ('pending_approval', 'issued')
      `, [requestId]);
      if (existingOrder.rowCount) {
        const error = new Error('PR ini sudah memiliki PO aktif.');
        error.status = 409;
        throw error;
      }
      const quotation = await client.query(`
        SELECT q.id, q.supplier_id, q.status, q.valid_until, s.is_active AS supplier_is_active
        FROM supplier_quotations q
        JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.id = $1 AND q.request_id = $2
          AND (q.valid_until IS NULL OR q.valid_until >= CURRENT_DATE)
        FOR UPDATE
      `, [quotationId, requestId]);
      if (!quotation.rowCount || quotation.rows[0].status !== 'available'
        || !quotation.rows[0].supplier_is_active) {
        const error = new Error('Penawaran tidak tersedia, sudah kedaluwarsa, atau bukan milik PR ini.');
        error.status = 409;
        throw error;
      }
      const total = await client.query(`
        SELECT COALESCE(SUM(quantity * unit_price), 0)::TEXT AS total
        FROM supplier_quotation_items WHERE quotation_id = $1
      `, [quotationId]);
      if (req.session.user.role === 'MANAGER') {
        const settings = await client.query(`
          SELECT manager_approval_limit::TEXT FROM procurement_settings WHERE id = 1 FOR SHARE
        `);
        const limit = settings.rows[0]?.manager_approval_limit || '0';
        const withinLimit = await client.query(
          'SELECT $1::NUMERIC <= $2::NUMERIC AND $2::NUMERIC > 0 AS valid',
          [total.rows[0].total, limit]
        );
        if (!withinLimit.rows[0].valid) {
          const error = new Error('Nilai PO melebihi batas pembuatan PO Manager. Minta Direktur membuat PO.');
          error.status = 403;
          throw error;
        }
      }
      const number = await client.query(`
        SELECT 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' ||
               LPAD(nextval('purchase_order_number_seq')::TEXT, 6, '0') AS po_number
      `);
      const status = isDirector ? 'issued' : 'pending_approval';
      const order = await client.query(`
        INSERT INTO purchase_orders (
          po_number, request_id, quotation_id, supplier_id, status, created_by, issued_by, issued_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 = 'issued' THEN NOW() ELSE NULL END)
        RETURNING id, po_number, status
      `, [
        number.rows[0].po_number, requestId, quotationId, quotation.rows[0].supplier_id,
        status, req.session.user.id, isDirector ? req.session.user.id : null
      ]);
      await client.query(`
        INSERT INTO purchase_order_items (
          purchase_order_id, request_item_id, item_name, quantity, unit, unit_price
        )
        SELECT $1, request_item_id, item_name, quantity, unit, unit_price
        FROM supplier_quotation_items
        WHERE quotation_id = $2
      `, [order.rows[0].id, quotationId]);
      await client.query(`
        UPDATE supplier_quotations SET status = 'selected', updated_at = NOW()
        WHERE id = $1
      `, [quotationId]);
      await client.query(`
        UPDATE supplier_quotations SET status = 'not_selected', updated_at = NOW()
        WHERE request_id = $1 AND id <> $2 AND status = 'available'
      `, [requestId, quotationId]);
      if (isDirector) {
        await client.query(`
          UPDATE purchase_requests SET status = 'converted_to_po', updated_at = NOW()
          WHERE id = $1
        `, [requestId]);
      }
      await client.query(`
        INSERT INTO purchase_order_approvals (purchase_order_id, approver_id, decision, note)
        VALUES ($1, $2, $3, $4)
      `, [
        order.rows[0].id, req.session.user.id, isDirector ? 'approved' : 'submitted',
        isDirector ? 'PO diterbitkan oleh Direktur.' : ''
      ]);
      return order;
    }
  );
  res.status(201).json({
    success: true,
    id: result.rows[0].id,
    po_number: result.rows[0].po_number,
    status: result.rows[0].status
  });
}));

app.post('/api/procurement/purchase-orders/:id/decision', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const orderId = Number(req.params.id);
  const decision = String(req.body?.decision || '');
  const note = String(req.body?.note || '').trim();
  if (!Number.isSafeInteger(orderId) || orderId <= 0
    || !['approved', 'rejected'].includes(decision) || note.length > 1000
    || (decision === 'rejected' && note.length < 3)) {
    return res.status(400).json({ error: 'Keputusan PO tidak valid. Penolakan harus menyertakan alasan.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query(`
      SELECT id, request_id, quotation_id, status, created_by, po_number
      FROM purchase_orders WHERE id = $1 FOR UPDATE
    `, [orderId]);
    if (!order.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PO tidak ditemukan.' });
    }
    const record = order.rows[0];
    if (record.status !== 'pending_approval') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'PO ini sudah diproses.' });
    }
    if (String(record.created_by) === String(req.session.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Pembuat PO tidak dapat menyetujui PO yang sama.' });
    }
    if (decision === 'approved') {
      await client.query(`
        UPDATE purchase_orders
        SET status = 'issued', issued_by = $1, issued_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `, [req.session.user.id, orderId]);
      await client.query(`
        UPDATE purchase_requests SET status = 'converted_to_po', updated_at = NOW()
        WHERE id = $1 AND status = 'approved'
      `, [record.request_id]);
    } else {
      await client.query(`
        UPDATE purchase_orders
        SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
        WHERE id = $2
      `, [note, orderId]);
      await client.query(`
        UPDATE supplier_quotations SET status = 'available', updated_at = NOW()
        WHERE request_id = $1
      `, [record.request_id]);
    }
    await client.query(`
      INSERT INTO purchase_order_approvals (purchase_order_id, approver_id, decision, note)
      VALUES ($1, $2, $3, $4)
    `, [orderId, req.session.user.id, decision, note]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4)
    `, [
      req.session.user.id,
      `PURCHASE_ORDER_${decision.toUpperCase()}`,
      `${decision} purchase order ${record.po_number}${note ? `: ${note}` : ''}`,
      req.ip || 'unknown'
    ]);
    await client.query('COMMIT');
    res.json({ success: true, status: decision === 'approved' ? 'issued' : 'rejected' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/documents', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT d.id, d.title, d.category, d.description, d.file_path,
           (d.file_path IS NOT NULL OR d.file_data IS NOT NULL) AS has_file,
           d.uploaded_by, d.created_at, u.name AS uploaded_by_name
    FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by
    ORDER BY d.created_at DESC
  `);
  res.json(result.rows);
}));

app.post('/api/documents', requireAuth, requireRole('DIREKTUR'), upload.single('attachment'), asyncRoute(async (req, res) => {
  const { title, category, description } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'Judul dan kategori dokumen wajib diisi.' });
  const uploadedFile = await storeUpload(req.file, 'documents');
  let created;
  try {
    created = await pool.query(`
      INSERT INTO documents (title, category, description, file_path, file_data, file_name, file_mime, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      String(title).trim(), String(category).trim(), description || '',
      uploadedFile?.key || null, uploadedFile?.data || null, uploadedFile?.name || null,
      uploadedFile?.mimeType || null, req.session.user.id
    ]);
  } catch (error) {
    await removeUpload(uploadedFile);
    throw error;
  }
  await logAudit(req.session.user.id, 'DOCUMENT_UPLOADED', `Uploaded document #${created.rows[0].id}: ${title}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/documents/:id/download', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT file_path, file_data, file_name, file_mime FROM documents WHERE id = $1',
    [req.params.id]
  );
  const file = result.rows[0];
  if (!file) return res.status(404).json({ error: 'File dokumen tidak ditemukan.' });
  if (file.file_path) return res.redirect(await signedDownload(file.file_path));
  return sendStoredFile(res, {
    data: file.file_data,
    name: file.file_name,
    mimeType: file.file_mime
  });
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

app.get('/api/transactions', requireAuth, requireRole('DIREKTUR', 'KOMISARIS'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT t.id, t.type, t.date, t.category, t.project_name, t.description, t.amount,
           t.payment_method, t.counterparty, t.attachment_path,
           (t.attachment_path IS NOT NULL OR t.attachment_data IS NOT NULL) AS has_attachment,
           t.created_by, t.created_at, u.name AS created_by_name
    FROM transactions t
    LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.date DESC, t.id DESC
  `);
  res.json(result.rows);
}));

app.post('/api/transactions', requireAuth, requireRole('DIREKTUR'), upload.single('attachment'), asyncRoute(async (req, res) => {
  const { type, date, category, project_name, description, amount, payment_method, counterparty } = req.body || {};
  const numericAmount = Number(amount);
  if (!['income', 'expense'].includes(type) || !isValidIsoDate(date) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Jenis, tanggal, dan nominal yang valid wajib diisi.' });
  }

  const uploadedFile = await storeUpload(req.file, 'transactions');
  let created;
  try {
    created = await pool.query(`
      INSERT INTO transactions (
        type, date, category, project_name, description, amount, payment_method,
        counterparty, attachment_path, attachment_data, attachment_name, attachment_mime, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      type, date, String(category || 'Umum').trim() || 'Umum',
      String(project_name || 'Umum').trim() || 'Umum', String(description || ''),
      numericAmount, String(payment_method || 'Transfer'), String(counterparty || 'Internal'),
      uploadedFile?.key || null, uploadedFile?.data || null, uploadedFile?.name || null,
      uploadedFile?.mimeType || null, req.session.user.id
    ]);
  } catch (error) {
    await removeUpload(uploadedFile);
    throw error;
  }
  await logAudit(req.session.user.id, 'TRANSACTION_CREATED', `Added ${type} transaction #${created.rows[0].id}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/transactions/:id/attachment', requireAuth, requireRole('DIREKTUR', 'KOMISARIS'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT attachment_path, attachment_data, attachment_name, attachment_mime FROM transactions WHERE id = $1',
    [req.params.id]
  );
  const file = result.rows[0];
  if (!file) return res.status(404).json({ error: 'Lampiran tidak ditemukan.' });
  if (file.attachment_path) return res.redirect(await signedDownload(file.attachment_path));
  return sendStoredFile(res, {
    data: file.attachment_data,
    name: file.attachment_name,
    mimeType: file.attachment_mime
  });
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
          SELECT t.id, t.title, t.description, t.assignee_id, t.quantity, t.status,
                 t.progress_percent, t.progress_note, t.result, t.created_at, t.updated_at,
                 u.name AS assignee_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.assignee_id = $1
          ORDER BY t.created_at DESC
      `, [req.session.user.id]);
  res.json(result.rows);
}));

app.get('/api/tasks/:id/updates', requireAuth, asyncRoute(async (req, res) => {
  const taskResult = await pool.query('SELECT assignee_id FROM tasks WHERE id = $1', [req.params.id]);
  const task = taskResult.rows[0];
  if (!task || (req.session.user.role !== 'DIREKTUR' && String(task.assignee_id) !== String(req.session.user.id))) {
    return res.status(404).json({ error: 'Pekerjaan tidak ditemukan.' });
  }
  const updates = await pool.query(`
    SELECT p.id, p.progress_percent, p.progress_note, p.result, p.submitted_at, u.name AS user_name
    FROM task_progress_updates p
    JOIN users u ON u.id = p.user_id
    WHERE p.task_id = $1
    ORDER BY p.submitted_at DESC
    LIMIT 50
  `, [req.params.id]);
  res.json(updates.rows);
}));

app.post('/api/tasks/:id/progress', requireAuth, asyncRoute(async (req, res) => {
  const { progress_percent, progress_note, result } = req.body || {};
  const progress = Number(progress_percent);
  const note = String(progress_note || '').trim();
  const outcome = String(result || '').trim();
  if (!Number.isInteger(progress) || progress < 0 || progress > 100 || !note || note.length > 2000 || outcome.length > 3000) {
    return res.status(400).json({ error: 'Isi progres 0–100%, uraian progres (maks. 2.000 karakter), dan hasil (maks. 3.000 karakter) dengan benar.' });
  }
  if (progress === 100 && !outcome) {
    return res.status(400).json({ error: 'Hasil pekerjaan wajib diisi saat progres mencapai 100%.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(`
      UPDATE tasks
      SET progress_percent = $1, progress_note = $2, result = $3,
          status = CASE WHEN $1 = 100 THEN 'in_review' ELSE 'pending' END,
          updated_at = NOW()
      WHERE id = $4 AND assignee_id = $5 AND status <> 'approved'
      RETURNING id
    `, [progress, note, outcome, req.params.id, req.session.user.id]);
    if (!updated.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pekerjaan tidak ditemukan atau sudah disetujui.' });
    }
    await client.query(`
      INSERT INTO task_progress_updates (task_id, user_id, progress_percent, progress_note, result)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.params.id, req.session.user.id, progress, note, outcome]);
    await client.query(`
      INSERT INTO audit_logs (user_id, action, details, ip_address)
      VALUES ($1, 'TASK_PROGRESS_UPDATED', $2, $3)
    `, [req.session.user.id, `Updated task #${req.params.id} progress to ${progress}%.`, req.ip || 'unknown']);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/tasks', requireAuth, requireRole('DIREKTUR'), asyncRoute(async (req, res) => {
  const { title, description, quantity, assignee_id } = req.body || {};
  const cleanTitle = String(title || '').trim();
  const cleanDescription = String(description || '').trim();
  const numericQuantity = Number(quantity);
  const assigneeId = Number(assignee_id);
  if (!cleanTitle || cleanTitle.length > 160 || cleanDescription.length > 3000 ||
      !Number.isFinite(numericQuantity) || numericQuantity <= 0 ||
      !Number.isSafeInteger(assigneeId) || assigneeId <= 0) {
    return res.status(400).json({ error: 'Judul, target hasil, dan karyawan yang ditugaskan wajib diisi dengan benar.' });
  }
  const assignee = await pool.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'KARYAWAN' AND status = 'active'",
    [assigneeId]
  );
  if (!assignee.rows[0]) return res.status(400).json({ error: 'Karyawan yang dipilih tidak aktif atau tidak ditemukan.' });
  const created = await pool.query(`
    INSERT INTO tasks (title, description, assignee_id, quantity, status, bonus_amount, created_by)
    VALUES ($1, $2, $3, $4, 'pending', 0, $5)
    RETURNING id
  `, [cleanTitle, cleanDescription, assigneeId, numericQuantity, req.session.user.id]);
  await logAudit(req.session.user.id, 'TASK_CREATED', `Created task #${created.rows[0].id} for employee #${assigneeId}: ${cleanTitle}`, req.ip);
  res.status(201).json({ success: true, id: created.rows[0].id });
}));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'CV Banten Bangkit Maju',
    fileStorageAvailable: true,
    fileStorageMode: s3 && bucketName ? 'r2' : 'neon'
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
  if (error.code === '23505' && ['inventory_categories_name_key', 'warehouses_name_key'].includes(error.constraint)) {
    return res.status(409).json({ error: 'Nama kategori atau gudang tersebut sudah digunakan.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file maksimal 3 MB. Kompres file lalu coba kembali.' : 'Upload file tidak valid.'
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
