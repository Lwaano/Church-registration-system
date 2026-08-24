// server.js
// -----------------------------------------------------------------------
// Simple Express server that:
//  1. Requires a shared staff password before any member data can be
//     viewed or changed (each person also enters their name, which is
//     used to attribute changes in the activity log).
//  2. Serves the front-end (public/ folder).
//  3. Exposes a REST API for member records, sorting/pagination, and the
//     activity log.
//  4. Provides a CSV export you can open directly in Excel.
// -----------------------------------------------------------------------

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // needed for secure cookies behind Render/other proxies
app.use(express.json());

// ---- Shared password setup --------------------------------------------
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  console.warn('----------------------------------------------------------------');
  console.warn('Warning: APP_PASSWORD is not set. Set it as an environment variable');
  console.warn('so staff have a password to log in with. Example: APP_PASSWORD=letmein');
  console.warn('Until it is set, nobody will be able to log in.');
  console.warn('----------------------------------------------------------------');
}

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---- Sessions -------------------------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET is not set. Using a random value, which means everyone');
  console.warn('will be logged out any time the server restarts. Set SESSION_SECRET in your');
  console.warn('environment for stable sessions (any long random string works).');
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: process.env.NODE_ENV === 'production',
  },
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

// ---- Auth routes ----------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!APP_PASSWORD) {
    return res.status(500).json({ error: 'The app password has not been configured yet. Ask whoever set up the app to set APP_PASSWORD.' });
  }
  if (!password || !safeCompare(password, APP_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  req.session.user = { name: name.trim() };
  res.json({ name: name.trim() });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.status(204).send());
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json(req.session.user);
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

app.listen(PORT, () => {
  console.log(`Church Member App running at http://localhost:${PORT}`);
  console.log(`Database: ${db.USE_POSTGRES ? 'PostgreSQL (external, shared)' : 'SQLite (local file, church.db)'}`);
});
