// db.js
// -----------------------------------------------------------------------
// All database access lives in this one file.
//
//   - No DATABASE_URL set  ->  uses a local SQLite file (church.db).
//                              Zero setup, great for trying things out.
//   - DATABASE_URL set     ->  uses that PostgreSQL database instead.
//                              This is how you move to a shared, external
//                              database that multiple staff/computers can
//                              read and write at the same time.
//
// Every function below returns a Promise, so server.js doesn't need to
// know or care which database is actually active.
// -----------------------------------------------------------------------

require('dotenv').config();

const USE_POSTGRES = !!process.env.DATABASE_URL;

// Columns people are allowed to sort by (whitelisted to prevent SQL injection
// via the ?sort= query parameter).
const SORTABLE_COLUMNS = new Set([
  'full_name', 'phone', 'email', 'marital_status', 'member_since', 'created_at',
]);

function resolveSort(sort, dir) {
  const col = SORTABLE_COLUMNS.has(sort) ? sort : 'full_name';
  const direction = dir === 'desc' ? 'DESC' : 'ASC';
  return { col, direction };
}

let getAllMembers, getMemberById, createMember, updateMember, deleteMember,
    getAllMembersForExport, addLogEntry, getRecentLogs;
let createPartner, getAllPartners, getAllPartnersForExport, getPartnerById,
    updatePartner, deletePartner;
let getPublicStats, getDashboardStats;

// ---- Stats helpers -------------------------------------------------------
// The growth chart always wants twelve labelled buckets, including months
// where nobody registered. The database only returns months that have rows,
// so we build the full run of keys here and fill the gaps with zero.
function lastTwelveMonthKeys(now = new Date()) {
  const keys = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function fillMonthly(rows, keys) {
  const counts = new Map(rows.map((r) => [r.month, Number(r.count)]));
  return keys.map((month) => ({ month, count: counts.get(month) || 0 }));
}

const PARTNER_SORTABLE_COLUMNS = new Set([
  'full_name', 'phone', 'partnership_category', 'status', 'submitted_at',
]);
function resolvePartnerSort(sort, dir) {
  const col = PARTNER_SORTABLE_COLUMNS.has(sort) ? sort : 'submitted_at';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  return { col, direction };
}

if (USE_POSTGRES) {
  // ---------------------- PostgreSQL (shared/hosted) ----------------------
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false }, // required by most hosted Postgres providers
  });

  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id             SERIAL PRIMARY KEY,
      full_name      TEXT NOT NULL,
      gender         TEXT,
      date_of_birth  DATE,
      phone          TEXT,
      email          TEXT,
      address        TEXT,
      marital_status TEXT,
      member_since   DATE,
      created_at     TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id             SERIAL PRIMARY KEY,
      action         TEXT NOT NULL,
      member_name    TEXT,
      performed_by   TEXT,
      created_at     TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS partners (
      id                    SERIAL PRIMARY KEY,
      full_name             TEXT NOT NULL,
      date_of_birth         DATE,
      gender                TEXT,
      nationality           TEXT,
      residential_address   TEXT,
      town_city             TEXT,
      phone                 TEXT,
      whatsapp              TEXT,
      email                 TEXT,
      occupation            TEXT,
      church_if_different   TEXT,
      partnership_category  TEXT,
      monthly_amount        TEXT,
      payment_method        TEXT,
      payment_method_other  TEXT,
      prayer_requests       TEXT,
      why_partner           TEXT,
      signature             TEXT,
      declaration_agreed    BOOLEAN DEFAULT FALSE,
      submitted_at          TIMESTAMP DEFAULT NOW(),
      partner_id_code       TEXT,
      category_assigned     TEXT,
      date_registered       DATE,
      registered_by         TEXT,
      receipt_number        TEXT,
      remarks               TEXT,
      status                TEXT,
      status_date           DATE,
      authorized_officer    TEXT
    )
  `).catch((err) => {
    console.error('Could not reach the Postgres database yet:', err.message);
    console.error('Double-check DATABASE_URL. The server will keep running, but requests will fail until this is fixed.');
  });

  getAllMembers = async ({ search, sort, dir, page = 1, pageSize = 20 } = {}) => {
    await ready;
    const { col, direction } = resolveSort(sort, dir);
    const offset = (Math.max(1, page) - 1) * pageSize;

    let where = '';
    let params = [];
    if (search && search.trim() !== '') {
      where = 'WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1';
      params = [`%${search.trim()}%`];
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM members ${where}`, params);
    const dataRes = await pool.query(
      `SELECT * FROM members ${where} ORDER BY ${col} ${direction} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return { data: dataRes.rows, total: countRes.rows[0].count };
  };

  getAllMembersForExport = async (search) => {
    await ready;
    if (search && search.trim() !== '') {
      const { rows } = await pool.query(
        `SELECT * FROM members WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 ORDER BY full_name ASC`,
        [`%${search.trim()}%`]
      );
      return rows;
    }
    const { rows } = await pool.query('SELECT * FROM members ORDER BY full_name ASC');
    return rows;
  };

  getMemberById = async (id) => {
    await ready;
    const { rows } = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
    return rows[0];
  };

  createMember = async (m) => {
    await ready;
    const { rows } = await pool.query(
      `INSERT INTO members
        (full_name, gender, date_of_birth, phone, email, address, marital_status, member_since)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [m.full_name, m.gender, m.date_of_birth, m.phone, m.email, m.address, m.marital_status, m.member_since]
    );
    return rows[0];
  };

  updateMember = async (id, m) => {
    await ready;
    const { rows } = await pool.query(
      `UPDATE members SET
        full_name=$1, gender=$2, date_of_birth=$3, phone=$4,
        email=$5, address=$6, marital_status=$7, member_since=$8
       WHERE id=$9
       RETURNING *`,
      [m.full_name, m.gender, m.date_of_birth, m.phone, m.email, m.address, m.marital_status, m.member_since, id]
    );
    return rows[0];
  };

  deleteMember = async (id) => {
    await ready;
    await pool.query('DELETE FROM members WHERE id = $1', [id]);
  };

  addLogEntry = async ({ action, member_name, performed_by }) => {
    await ready;
    await pool.query(
      'INSERT INTO activity_log (action, member_name, performed_by) VALUES ($1,$2,$3)',
      [action, member_name, performed_by]
    );
  };

  getRecentLogs = async (limit = 50) => {
    await ready;
    const { rows } = await pool.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows;
  };

  const PARTNER_FIELDS = [
    'full_name', 'date_of_birth', 'gender', 'nationality', 'residential_address',
    'town_city', 'phone', 'whatsapp', 'email', 'occupation', 'church_if_different',
    'partnership_category', 'monthly_amount', 'payment_method', 'payment_method_other',
    'prayer_requests', 'why_partner', 'signature', 'declaration_agreed',
    'partner_id_code', 'category_assigned', 'date_registered', 'registered_by',
    'receipt_number', 'remarks', 'status', 'status_date', 'authorized_officer',
  ];

  createPartner = async (p) => {
    await ready;
    const { rows } = await pool.query(
      `INSERT INTO partners
        (full_name, date_of_birth, gender, nationality, residential_address, town_city,
         phone, whatsapp, email, occupation, church_if_different, partnership_category,
         monthly_amount, payment_method, payment_method_other, prayer_requests,
         why_partner, signature, declaration_agreed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [p.full_name, p.date_of_birth, p.gender, p.nationality, p.residential_address, p.town_city,
       p.phone, p.whatsapp, p.email, p.occupation, p.church_if_different, p.partnership_category,
       p.monthly_amount, p.payment_method, p.payment_method_other, p.prayer_requests,
       p.why_partner, p.signature, p.declaration_agreed]
    );
    return rows[0];
  };

  getAllPartners = async ({ search, sort, dir, page = 1, pageSize = 20 } = {}) => {
    await ready;
    const { col, direction } = resolvePartnerSort(sort, dir);
    const offset = (Math.max(1, page) - 1) * pageSize;

    let where = '';
    let params = [];
    if (search && search.trim() !== '') {
      where = 'WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1';
      params = [`%${search.trim()}%`];
    }

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM partners ${where}`, params);
    const dataRes = await pool.query(
      `SELECT * FROM partners ${where} ORDER BY ${col} ${direction} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    return { data: dataRes.rows, total: countRes.rows[0].count };
  };

  getAllPartnersForExport = async (search) => {
    await ready;
    if (search && search.trim() !== '') {
      const { rows } = await pool.query(
        `SELECT * FROM partners WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 ORDER BY submitted_at DESC`,
        [`%${search.trim()}%`]
      );
      return rows;
    }
    const { rows } = await pool.query('SELECT * FROM partners ORDER BY submitted_at DESC');
    return rows;
  };

  getPartnerById = async (id) => {
    await ready;
    const { rows } = await pool.query('SELECT * FROM partners WHERE id = $1', [id]);
    return rows[0];
  };

  updatePartner = async (id, p) => {
    await ready;
    const setClause = PARTNER_FIELDS.map((f, i) => `${f}=$${i + 1}`).join(', ');
    const values = PARTNER_FIELDS.map((f) => (p[f] === undefined ? null : p[f]));
    const { rows } = await pool.query(
      `UPDATE partners SET ${setClause} WHERE id=$${PARTNER_FIELDS.length + 1} RETURNING *`,
      [...values, id]
    );
    return rows[0];
  };

  deletePartner = async (id) => {
    await ready;
    await pool.query('DELETE FROM partners WHERE id = $1', [id]);
  };

  // Aggregate counts only — safe to serve on the public landing page.
  // Nothing here can identify an individual.
  getPublicStats = async () => {
    await ready;
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM partners) AS partners,
        (SELECT COUNT(*)::int FROM members)  AS members,
        (SELECT COUNT(DISTINCT lower(trim(town_city)))::int FROM partners
           WHERE town_city IS NOT NULL AND trim(town_city) <> '') AS towns,
        (SELECT COUNT(DISTINCT lower(trim(nationality)))::int FROM partners
           WHERE nationality IS NOT NULL AND trim(nationality) <> '') AS nations
    `);
    return rows[0];
  };

  getDashboardStats = async () => {
    await ready;
    const months = lastTwelveMonthKeys();
    const [totals, byCategory, byGender, byStatus, topTowns, monthly] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM members)  AS members,
          (SELECT COUNT(*)::int FROM partners) AS partners,
          (SELECT COUNT(*)::int FROM partners
             WHERE submitted_at >= date_trunc('month', NOW())) AS partners_this_month,
          (SELECT COUNT(*)::int FROM members
             WHERE created_at >= date_trunc('month', NOW()))   AS members_this_month,
          (SELECT COUNT(*)::int FROM partners
             WHERE status IS NULL OR trim(status) = '')        AS pending_review,
          (SELECT COUNT(DISTINCT lower(trim(town_city)))::int FROM partners
             WHERE town_city IS NOT NULL AND trim(town_city) <> '') AS towns
      `),
      pool.query(`SELECT COALESCE(NULLIF(trim(partnership_category), ''), 'Not stated') AS label,
                         COUNT(*)::int AS count FROM partners GROUP BY 1`),
      pool.query(`SELECT COALESCE(NULLIF(trim(gender), ''), 'Not stated') AS label,
                         COUNT(*)::int AS count FROM partners GROUP BY 1`),
      pool.query(`SELECT COALESCE(NULLIF(trim(status), ''), 'Not set') AS label,
                         COUNT(*)::int AS count FROM partners GROUP BY 1`),
      pool.query(`SELECT trim(town_city) AS label, COUNT(*)::int AS count FROM partners
                   WHERE town_city IS NOT NULL AND trim(town_city) <> ''
                   GROUP BY 1 ORDER BY count DESC, label ASC LIMIT 6`),
      pool.query(`SELECT to_char(submitted_at, 'YYYY-MM') AS month, COUNT(*)::int AS count
                    FROM partners
                   WHERE submitted_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
                   GROUP BY 1`),
    ]);

    const t = totals.rows[0];
    return {
      totals: {
        members: t.members,
        partners: t.partners,
        partnersThisMonth: t.partners_this_month,
        membersThisMonth: t.members_this_month,
        pendingReview: t.pending_review,
        towns: t.towns,
      },
      byCategory: byCategory.rows,
      byGender: byGender.rows,
      byStatus: byStatus.rows,
      topTowns: topTowns.rows,
      monthly: fillMonthly(monthly.rows, months),
    };
  };

} else {
  // ---------------------- SQLite (local, default) ----------------------
  const Database = require('better-sqlite3');
  const path = require('path');

  const db = new Database(path.join(__dirname, 'church.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name      TEXT NOT NULL,
      gender         TEXT,
      date_of_birth  TEXT,
      phone          TEXT,
      email          TEXT,
      address        TEXT,
      marital_status TEXT,
      member_since   TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      action         TEXT NOT NULL,
      member_name    TEXT,
      performed_by   TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS partners (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name             TEXT NOT NULL,
      date_of_birth         TEXT,
      gender                TEXT,
      nationality           TEXT,
      residential_address   TEXT,
      town_city             TEXT,
      phone                 TEXT,
      whatsapp              TEXT,
      email                 TEXT,
      occupation            TEXT,
      church_if_different   TEXT,
      partnership_category  TEXT,
      monthly_amount        TEXT,
      payment_method        TEXT,
      payment_method_other  TEXT,
      prayer_requests       TEXT,
      why_partner           TEXT,
      signature             TEXT,
      declaration_agreed    INTEGER DEFAULT 0,
      submitted_at          TEXT DEFAULT (datetime('now')),
      partner_id_code       TEXT,
      category_assigned     TEXT,
      date_registered       TEXT,
      registered_by         TEXT,
      receipt_number        TEXT,
      remarks               TEXT,
      status                TEXT,
      status_date           TEXT,
      authorized_officer    TEXT
    )
  `);

  getAllMembers = async ({ search, sort, dir, page = 1, pageSize = 20 } = {}) => {
    const { col, direction } = resolveSort(sort, dir);
    const offset = (Math.max(1, page) - 1) * pageSize;

    let where = '';
    let params = [];
    if (search && search.trim() !== '') {
      where = 'WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const like = `%${search.trim()}%`;
      params = [like, like, like];
    }

    const total = db.prepare(`SELECT COUNT(*) AS count FROM members ${where}`).get(...params).count;
    const data = db.prepare(
      `SELECT * FROM members ${where} ORDER BY ${col} ${direction} LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    return { data, total };
  };

  getAllMembersForExport = async (search) => {
    if (search && search.trim() !== '') {
      const like = `%${search.trim()}%`;
      return db.prepare(
        `SELECT * FROM members WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY full_name ASC`
      ).all(like, like, like);
    }
    return db.prepare('SELECT * FROM members ORDER BY full_name ASC').all();
  };

  getMemberById = async (id) =>
    db.prepare('SELECT * FROM members WHERE id = ?').get(id);

  createMember = async (m) => {
    const info = db.prepare(`
      INSERT INTO members
        (full_name, gender, date_of_birth, phone, email, address, marital_status, member_since)
      VALUES
        (@full_name, @gender, @date_of_birth, @phone, @email, @address, @marital_status, @member_since)
    `).run(m);
    return getMemberById(info.lastInsertRowid);
  };

  updateMember = async (id, m) => {
    db.prepare(`
      UPDATE members SET
        full_name=@full_name, gender=@gender, date_of_birth=@date_of_birth,
        phone=@phone, email=@email, address=@address,
        marital_status=@marital_status, member_since=@member_since
      WHERE id=@id
    `).run({ ...m, id });
    return getMemberById(id);
  };

  deleteMember = async (id) => {
    db.prepare('DELETE FROM members WHERE id = ?').run(id);
  };

  addLogEntry = async ({ action, member_name, performed_by }) => {
    db.prepare(
      'INSERT INTO activity_log (action, member_name, performed_by) VALUES (?, ?, ?)'
    ).run(action, member_name, performed_by);
  };

  getRecentLogs = async (limit = 50) =>
    db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);

  const PARTNER_FIELDS = [
    'full_name', 'date_of_birth', 'gender', 'nationality', 'residential_address',
    'town_city', 'phone', 'whatsapp', 'email', 'occupation', 'church_if_different',
    'partnership_category', 'monthly_amount', 'payment_method', 'payment_method_other',
    'prayer_requests', 'why_partner', 'signature', 'declaration_agreed',
    'partner_id_code', 'category_assigned', 'date_registered', 'registered_by',
    'receipt_number', 'remarks', 'status', 'status_date', 'authorized_officer',
  ];

  createPartner = async (p) => {
    const info = db.prepare(`
      INSERT INTO partners
        (full_name, date_of_birth, gender, nationality, residential_address, town_city,
         phone, whatsapp, email, occupation, church_if_different, partnership_category,
         monthly_amount, payment_method, payment_method_other, prayer_requests,
         why_partner, signature, declaration_agreed)
      VALUES
        (@full_name, @date_of_birth, @gender, @nationality, @residential_address, @town_city,
         @phone, @whatsapp, @email, @occupation, @church_if_different, @partnership_category,
         @monthly_amount, @payment_method, @payment_method_other, @prayer_requests,
         @why_partner, @signature, @declaration_agreed)
    `).run({ ...p, declaration_agreed: p.declaration_agreed ? 1 : 0 });
    return getPartnerById(info.lastInsertRowid);
  };

  getAllPartners = async ({ search, sort, dir, page = 1, pageSize = 20 } = {}) => {
    const { col, direction } = resolvePartnerSort(sort, dir);
    const offset = (Math.max(1, page) - 1) * pageSize;

    let where = '';
    let params = [];
    if (search && search.trim() !== '') {
      where = 'WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const like = `%${search.trim()}%`;
      params = [like, like, like];
    }

    const total = db.prepare(`SELECT COUNT(*) AS count FROM partners ${where}`).get(...params).count;
    const data = db.prepare(
      `SELECT * FROM partners ${where} ORDER BY ${col} ${direction} LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    return { data, total };
  };

  getAllPartnersForExport = async (search) => {
    if (search && search.trim() !== '') {
      const like = `%${search.trim()}%`;
      return db.prepare(
        `SELECT * FROM partners WHERE full_name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY submitted_at DESC`
      ).all(like, like, like);
    }
    return db.prepare('SELECT * FROM partners ORDER BY submitted_at DESC').all();
  };

  getPartnerById = async (id) =>
    db.prepare('SELECT * FROM partners WHERE id = ?').get(id);

  updatePartner = async (id, p) => {
    const setClause = PARTNER_FIELDS.map((f) => `${f}=@${f}`).join(', ');
    const values = {};
    PARTNER_FIELDS.forEach((f) => {
      values[f] = f === 'declaration_agreed' ? (p[f] ? 1 : 0) : (p[f] === undefined ? null : p[f]);
    });
    db.prepare(`UPDATE partners SET ${setClause} WHERE id=@id`).run({ ...values, id });
    return getPartnerById(id);
  };

  deletePartner = async (id) => {
    db.prepare('DELETE FROM partners WHERE id = ?').run(id);
  };

  // Aggregate counts only — safe to serve on the public landing page.
  // Nothing here can identify an individual.
  getPublicStats = async () => db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM partners) AS partners,
      (SELECT COUNT(*) FROM members)  AS members,
      (SELECT COUNT(DISTINCT lower(trim(town_city))) FROM partners
         WHERE town_city IS NOT NULL AND trim(town_city) <> '') AS towns,
      (SELECT COUNT(DISTINCT lower(trim(nationality))) FROM partners
         WHERE nationality IS NOT NULL AND trim(nationality) <> '') AS nations
  `).get();

  getDashboardStats = async () => {
    const months = lastTwelveMonthKeys();

    const totals = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM members)  AS members,
        (SELECT COUNT(*) FROM partners) AS partners,
        (SELECT COUNT(*) FROM partners
           WHERE submitted_at >= strftime('%Y-%m-01', 'now')) AS partners_this_month,
        (SELECT COUNT(*) FROM members
           WHERE created_at  >= strftime('%Y-%m-01', 'now'))  AS members_this_month,
        (SELECT COUNT(*) FROM partners
           WHERE status IS NULL OR trim(status) = '')         AS pending_review,
        (SELECT COUNT(DISTINCT lower(trim(town_city))) FROM partners
           WHERE town_city IS NOT NULL AND trim(town_city) <> '') AS towns
    `).get();

    const byCategory = db.prepare(`
      SELECT COALESCE(NULLIF(trim(partnership_category), ''), 'Not stated') AS label,
             COUNT(*) AS count FROM partners GROUP BY 1`).all();
    const byGender = db.prepare(`
      SELECT COALESCE(NULLIF(trim(gender), ''), 'Not stated') AS label,
             COUNT(*) AS count FROM partners GROUP BY 1`).all();
    const byStatus = db.prepare(`
      SELECT COALESCE(NULLIF(trim(status), ''), 'Not set') AS label,
             COUNT(*) AS count FROM partners GROUP BY 1`).all();
    const topTowns = db.prepare(`
      SELECT trim(town_city) AS label, COUNT(*) AS count FROM partners
       WHERE town_city IS NOT NULL AND trim(town_city) <> ''
       GROUP BY 1 ORDER BY count DESC, label ASC LIMIT 6`).all();
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', submitted_at) AS month, COUNT(*) AS count
        FROM partners
       WHERE submitted_at >= strftime('%Y-%m-01', 'now', '-11 months')
       GROUP BY 1`).all();

    return {
      totals: {
        members: totals.members,
        partners: totals.partners,
        partnersThisMonth: totals.partners_this_month,
        membersThisMonth: totals.members_this_month,
        pendingReview: totals.pending_review,
        towns: totals.towns,
      },
      byCategory,
      byGender,
      byStatus,
      topTowns,
      monthly: fillMonthly(monthly, months),
    };
  };
}

module.exports = {
  USE_POSTGRES,
  getAllMembers,
  getAllMembersForExport,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  addLogEntry,
  getRecentLogs,
  createPartner,
  getAllPartners,
  getAllPartnersForExport,
  getPartnerById,
  updatePartner,
  deletePartner,
  getPublicStats,
  getDashboardStats,
};
