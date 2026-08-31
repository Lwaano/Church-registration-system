// server.js
// -----------------------------------------------------------------------
// Simple Express server that:
//  1. Requires each staff member to sign in with their own username and
//     password before any member data can be viewed or changed. Admin
//     accounts can create and manage other staff accounts from the app.
//  2. Serves the front-end (public/ folder).
//  3. Exposes a REST API for member records, sorting/pagination, and the
//     activity log.
//  4. Provides a CSV export you can open directly in Excel.
// -----------------------------------------------------------------------

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // needed for secure cookies behind Render/other proxies
app.use(express.json());

// Security headers (clickjacking, MIME-sniffing, referrer leakage, etc).
// The content-security-policy is left off: the front-end still relies on a
// few inline <script> blocks (the pre-paint theme setter) and inline
// onerror="" handlers on the logo <img> tags, which a locked-down CSP would
// silently break. Tightening this further is a good follow-up, but it means
// moving those inline snippets into the .js files first.
app.use(helmet({ contentSecurityPolicy: false }));

// ---- Sessions -------------------------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET is not set. Using a random value, which means everyone');
  console.warn('will be logged out any time the server restarts. Set SESSION_SECRET in your');
  console.warn('environment for stable sessions (any long random string works).');
}

// Sessions are stored in the same database as everything else, so signing
// in survives server restarts and redeploys instead of everyone being
// logged out every time.
let sessionStore;
if (db.USE_POSTGRES) {
  const PgSession = require('connect-pg-simple')(session);
  sessionStore = new PgSession({ pool: db.pgPool, tableName: 'user_sessions', createTableIfMissing: true });
} else {
  const SqliteStore = require('better-sqlite3-session-store')(session);
  sessionStore = new SqliteStore({ client: db.sqliteDb, expired: { clear: true, intervalMs: 15 * 60 * 1000 } });
}

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: process.env.NODE_ENV === 'production',
  },
}));

// Staff are signed out automatically after this many minutes of no activity
// (no API requests), even though the session cookie itself lasts 7 days.
// Every authenticated request "touches" the session and resets the clock.
const INACTIVITY_TIMEOUT_MS = (Number(process.env.INACTIVITY_TIMEOUT_MINUTES) || 30) * 60 * 1000;

function touchSession(req, res) {
  if (!req.session.user) {
    res.status(401).json({ error: 'Please log in.' });
    return false;
  }
  const now = Date.now();
  if (req.session.lastActivity && now - req.session.lastActivity > INACTIVITY_TIMEOUT_MS) {
    req.session.destroy(() => {});
    res.status(401).json({ error: 'You were signed out due to inactivity. Please sign in again.' });
    return false;
  }
  req.session.lastActivity = now;
  return true;
}

function requireAuth(req, res, next) {
  if (!touchSession(req, res)) return;
  next();
}

function requireAdmin(req, res, next) {
  if (!touchSession(req, res)) return;
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do that.' });
  next();
}

// Brute-force protection on the login form: 10 attempts per 15 minutes per
// IP address, regardless of which username is being tried.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

// ---- Auth routes ----------------------------------------------------------
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !username.trim() || !password) {
    return res.status(400).json({ error: 'Please enter your username and password.' });
  }

  try {
    const user = await db.getUserByUsername(username.trim());
    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Could not sign in. Please try again.' });
      }
      req.session.user = { id: user.id, name: user.full_name, username: user.username, role: user.role };
      req.session.lastActivity = Date.now();
      db.addLogEntry({ action: 'login', member_name: null, performed_by: user.full_name }).catch(console.error);
      res.json(req.session.user);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

app.post('/api/logout', async (req, res) => {
  if (req.session.user) {
    await db.addLogEntry({ action: 'logout', member_name: null, performed_by: req.session.user.name }).catch(console.error);
  }
  req.session.destroy(() => res.status(204).send());
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// Any signed-in user can change their own password.
app.put('/api/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  try {
    const user = await db.getUserById(req.session.user.id);
    if (!user || !(await verifyPassword(currentPassword || '', user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await db.setUserPassword(user.id, await hashPassword(newPassword));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update your password.' });
  }
});

// Any signed-in user can change their own display name and/or username.
// The display name (full_name) is what shows up in the activity log and
// the "Signed in as ..." header; the username is only the login ID.
app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { currentPassword, full_name, username } = req.body;
  if ((!full_name || !full_name.trim()) && (!username || !username.trim())) {
    return res.status(400).json({ error: 'Full name or username is required.' });
  }

  try {
    const user = await db.getUserById(req.session.user.id);
    if (!user || !(await verifyPassword(currentPassword || '', user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (username && username.trim()) {
      const trimmed = username.trim();
      const existing = await db.getUserByUsername(trimmed);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      await db.setUserUsername(user.id, trimmed);
      req.session.user.username = trimmed;
    }

    if (full_name && full_name.trim()) {
      await db.setUserFullName(user.id, full_name.trim());
      req.session.user.name = full_name.trim();
    }

    res.json(req.session.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update your account.' });
  }
});

// ---- Staff account management (admin only) --------------------------------
const STAFF_ROLES = ['admin', 'data-entry'];

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users.map((u) => ({
      id: u.id, full_name: u.full_name, username: u.username,
      role: u.role, active: !!u.active, created_at: u.created_at,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load staff accounts.' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { full_name, username, password, role } = req.body;
  const errors = [];
  if (!full_name || !full_name.trim()) errors.push('Full name is required.');
  if (!username || !username.trim()) errors.push('Username is required.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (role && !STAFF_ROLES.includes(role)) errors.push('Invalid role.');
  if (errors.length) return res.status(400).json({ errors });

  try {
    if (await db.getUserByUsername(username.trim())) {
      return res.status(409).json({ errors: ['That username is already taken.'] });
    }
    const user = await db.createUser({
      full_name: full_name.trim(),
      username: username.trim(),
      password_hash: await hashPassword(password),
      role: role || 'data-entry',
    });
    res.status(201).json({ id: user.id, full_name: user.full_name, username: user.username, role: user.role, active: !!user.active });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create staff account.' });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await db.getUserById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Staff account not found.' });

    const role = req.body.role || existing.role;
    const active = req.body.active === undefined ? !!existing.active : !!req.body.active;
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    // Don't let the last active admin lock everyone (including themselves) out.
    if ((role !== 'admin' || !active) && existing.role === 'admin' && !!existing.active) {
      const admins = (await db.getAllUsers()).filter((u) => u.role === 'admin' && u.active && u.id !== existing.id);
      if (admins.length === 0) {
        return res.status(400).json({ error: 'At least one active admin account must remain.' });
      }
    }

    const user = await db.updateUser(req.params.id, {
      full_name: (req.body.full_name || existing.full_name).trim(),
      role,
      active,
    });

    if (req.body.password) {
      if (req.body.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      await db.setUserPassword(user.id, await hashPassword(req.body.password));
    }

    res.json({ id: user.id, full_name: user.full_name, username: user.username, role: user.role, active: !!user.active });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update staff account.' });
  }
});

// ---- Public stats ---------------------------------------------------------
// Deliberately the ONLY route outside the login wall that touches the
// database for reading. It returns four aggregate counts and nothing else —
// no names, no contacts, no rows — so the landing page can show live numbers
// without exposing anybody's details. Cached briefly so a burst of visitors
// doesn't turn into a burst of queries.
app.get('/api/public/stats', async (req, res) => {
  try {
    const stats = await db.getPublicStats();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      partners: Number(stats.partners) || 0,
      members: Number(stats.members) || 0,
      towns: Number(stats.towns) || 0,
      nations: Number(stats.nations) || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// ---- Dashboard stats (staff only) -----------------------------------------
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    res.json(await db.getDashboardStats());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load dashboard statistics.' });
  }
});

// ---- Validation helper --------------------------------------------------
function validateMember(body) {
  const errors = [];
  if (!body.full_name || body.full_name.trim() === '') {
    errors.push('Full name is required.');
  }
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) {
    errors.push('Email address looks invalid.');
  }
  return errors;
}

// ---- Member routes (all require login) -----------------------------------

// List members — supports search (?q=), sorting (?sort=&dir=), and
// pagination (?page=&pageSize=)
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const { data, total } = await db.getAllMembers({
      search: req.query.q,
      sort: req.query.sort,
      dir: req.query.dir,
      page,
      pageSize,
    });

    res.json({ data, total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load members.' });
  }
});

app.get('/api/export', requireAuth, async (req, res) => {
  try {
    const members = await db.getAllMembersForExport(req.query.q);

    const headers = [
      'Full Name', 'Gender', 'Date of Birth', 'Phone', 'Email',
      'Address', 'Marital Status', 'Member Since', 'Added On',
    ];
    const keys = [
      'full_name', 'gender', 'date_of_birth', 'phone', 'email',
      'address', 'marital_status', 'member_since', 'created_at',
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [headers.join(',')];
    members.forEach((m) => {
      lines.push(keys.map((k) => escapeCsv(m[k])).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="church-members.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate export.');
  }
});

// Recent activity log
app.get('/api/activity-log', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    res.json(await db.getRecentLogs(limit));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load activity log.' });
  }
});

app.get('/api/members/:id', requireAuth, async (req, res) => {
  try {
    const member = await db.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    res.json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load member.' });
  }
});

app.post('/api/members', requireAuth, async (req, res) => {
  const errors = validateMember(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const member = await db.createMember({
      full_name: req.body.full_name.trim(),
      gender: req.body.gender || null,
      date_of_birth: req.body.date_of_birth || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      marital_status: req.body.marital_status || null,
      member_since: req.body.member_since || null,
    });
    await db.addLogEntry({ action: 'added', member_name: member.full_name, performed_by: req.session.user.name });
    res.status(201).json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save member.' });
  }
});

app.put('/api/members/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getMemberById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found.' });

    const errors = validateMember(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const member = await db.updateMember(req.params.id, {
      full_name: req.body.full_name.trim(),
      gender: req.body.gender || null,
      date_of_birth: req.body.date_of_birth || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      marital_status: req.body.marital_status || null,
      member_since: req.body.member_since || null,
    });
    await db.addLogEntry({ action: 'updated', member_name: member.full_name, performed_by: req.session.user.name });
    res.json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update member.' });
  }
});

app.delete('/api/members/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getMemberById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found.' });
    await db.deleteMember(req.params.id);
    await db.addLogEntry({ action: 'removed', member_name: existing.full_name, performed_by: req.session.user.name });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete member.' });
  }
});

// ---- Partner registration (public submission) ------------------------------
const PARTNERSHIP_CATEGORIES = ['Blue', 'Bronze', 'Silver', 'Gold', 'Star/Diamond'];
const PAYMENT_METHODS = ['Mobile Money', 'Bank Deposit/Transfer', 'Cash', 'Standing Order', 'Other'];
const PARTNER_STATUSES = ['Active', 'Inactive', 'Suspended', 'Upgraded', 'Downgraded'];

function validatePartner(body) {
  const errors = [];
  if (!body.full_name || body.full_name.trim() === '') {
    errors.push('Full name is required.');
  }
  if (!body.signature || body.signature.trim() === '') {
    errors.push('Please type your name as your signature.');
  }
  if (!body.declaration_agreed) {
    errors.push('Please confirm the Partner\'s Declaration to submit.');
  }
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) {
    errors.push('Email address looks invalid.');
  }
  return errors;
}

// Public: anyone can submit a partnership registration, no login required.
app.post('/api/partners', async (req, res) => {
  const errors = validatePartner(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const duplicate = await db.findDuplicatePartner({
      full_name: req.body.full_name,
      phone: req.body.phone,
      email: req.body.email,
    });
    if (duplicate) {
      return res.status(409).json({
        errors: ["It looks like you've already registered as a partner. If you need to update your details, please contact the church office."],
      });
    }

    const partner = await db.createPartner({
      full_name: req.body.full_name.trim(),
      date_of_birth: req.body.date_of_birth || null,
      gender: req.body.gender || null,
      nationality: req.body.nationality || null,
      residential_address: req.body.residential_address || null,
      town_city: req.body.town_city || null,
      phone: req.body.phone || null,
      whatsapp: req.body.whatsapp || null,
      email: req.body.email || null,
      occupation: req.body.occupation || null,
      church_if_different: req.body.church_if_different || null,
      partnership_category: req.body.partnership_category || null,
      monthly_amount: req.body.monthly_amount || null,
      payment_method: req.body.payment_method || null,
      payment_method_other: req.body.payment_method_other || null,
      prayer_requests: req.body.prayer_requests || null,
      why_partner: req.body.why_partner || null,
      signature: req.body.signature.trim(),
      declaration_agreed: !!req.body.declaration_agreed,
    });
    await db.addLogEntry({ action: 'registered', member_name: partner.full_name, performed_by: 'Public registration form' });
    res.status(201).json(partner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your registration. Please try again.' });
  }
});

// Everything else about partners is staff-only.
app.get('/api/partners', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const { data, total } = await db.getAllPartners({
      search: req.query.q,
      sort: req.query.sort,
      dir: req.query.dir,
      page,
      pageSize,
    });

    res.json({ data, total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load partner registrations.' });
  }
});

app.get('/api/partners/export', requireAuth, async (req, res) => {
  try {
    const partners = await db.getAllPartnersForExport(req.query.q);

    const headers = [
      'Full Name', 'Date of Birth', 'Gender', 'Nationality', 'Residential Address',
      'Town/City', 'Phone', 'WhatsApp', 'Email', 'Occupation/Business', 'Church (if different)',
      'Partnership Category', 'Monthly Amount', 'Payment Method', 'Payment Method (Other)',
      'Prayer Requests', 'Why I Choose to Partner', 'Signature', 'Submitted At',
      'Partner ID', 'Category Assigned', 'Date Registered', 'Registered By',
      'Receipt Number', 'Remarks', 'Status', 'Status Date', 'Authorized Officer',
    ];
    const keys = [
      'full_name', 'date_of_birth', 'gender', 'nationality', 'residential_address',
      'town_city', 'phone', 'whatsapp', 'email', 'occupation', 'church_if_different',
      'partnership_category', 'monthly_amount', 'payment_method', 'payment_method_other',
      'prayer_requests', 'why_partner', 'signature', 'submitted_at',
      'partner_id_code', 'category_assigned', 'date_registered', 'registered_by',
      'receipt_number', 'remarks', 'status', 'status_date', 'authorized_officer',
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [headers.join(',')];
    partners.forEach((p) => {
      lines.push(keys.map((k) => escapeCsv(p[k])).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kingdom-partners.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate export.');
  }
});

app.get('/api/partners/:id', requireAuth, async (req, res) => {
  try {
    const partner = await db.getPartnerById(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner not found.' });
    res.json(partner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load partner.' });
  }
});

app.put('/api/partners/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getPartnerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Partner not found.' });

    if (req.body.status && !PARTNER_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const partner = await db.updatePartner(req.params.id, {
      ...existing,
      ...req.body,
      declaration_agreed: existing.declaration_agreed, // the declaration itself isn't staff-editable
    });
    await db.addLogEntry({ action: 'updated', member_name: partner.full_name, performed_by: req.session.user.name });
    res.json(partner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update partner.' });
  }
});

app.delete('/api/partners/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.getPartnerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Partner not found.' });
    await db.deletePartner(req.params.id);
    await db.addLogEntry({ action: 'removed', member_name: existing.full_name, performed_by: req.session.user.name });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete partner.' });
  }
});

// ---- Page routes -----------------------------------------------------------
// These are registered BEFORE static file serving so the auth check on
// /app.html can't be bypassed by requesting the file directly.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/app.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// login.html, login.js, partner-registration.html/js, landing.html, and
// style.css are always public. app.html itself is gated above, but its
// supporting app.js only works once logged in anyway (every API call it
// makes requires a session).
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- First-admin bootstrap via environment variables -----------------------
// `npm run create-admin` needs an interactive terminal, which isn't available
// on hosts that don't expose a shell (e.g. Render's free tier). As a
// shell-free alternative: if no staff accounts exist yet and these two
// environment variables are set, create the first admin account on startup.
// Safe to leave the variables in place afterward — this only ever fires
// while the account table is empty, so it does nothing once an account
// exists. Still best practice to remove them from your host's environment
// variables once you've signed in, since a plaintext password sitting in
// your dashboard indefinitely is unnecessary exposure.
async function bootstrapAdminFromEnv() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;

  try {
    if (await db.countUsers() > 0) return;
    if (password.length < 8) {
      console.warn('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters — skipping admin bootstrap.');
      return;
    }
    await db.createUser({
      full_name: 'Admin',
      username,
      password_hash: await hashPassword(password),
      role: 'admin',
    });
    console.log(`Bootstrap admin account "${username}" created from BOOTSTRAP_ADMIN_USERNAME/PASSWORD.`);
  } catch (err) {
    console.error('Could not create the bootstrap admin account:', err.message);
  }
}

bootstrapAdminFromEnv().then(() => {
  app.listen(PORT, () => {
    console.log(`Church Member App running at http://localhost:${PORT}`);
    console.log(`Database: ${db.USE_POSTGRES ? 'PostgreSQL (external, shared)' : 'SQLite (local file, church.db)'}`);
  });
});
