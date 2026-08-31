// app.js — front-end logic for the Church Member Directory
// No build step, no framework — just fetch() calls against the small
// REST API in server.js.

const state = {
  members: [],
  total: 0,
  page: 1,
  pageSize: 20,
  sort: 'full_name',
  dir: 'asc',
  editingId: null,
};

const partnerState = {
  partners: [],
  total: 0,
  page: 1,
  pageSize: 20,
  sort: 'submitted_at',
  dir: 'desc',
  editingId: null,
};

let currentUserName = '';
let currentUserRole = '';
let currentUserId = null;
let currentUsername = '';
let pendingDelete = null; // { type: 'member' | 'partner', id, name }
let staffUsers = [];

const SORT_LABELS = {
  full_name: 'Name',
  phone: 'Phone',
  email: 'Email',
  marital_status: 'Marital status',
};

const PARTNER_SORT_LABELS = {
  full_name: 'Name',
  phone: 'Phone',
  partnership_category: 'Category',
  status: 'Status',
  submitted_at: 'Submitted',
};

// ---- Element references --------------------------------------------------
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');
const directoryContent = document.getElementById('directoryContent');
const memberCount = document.getElementById('memberCount');
const searchInput = document.getElementById('searchInput');
const exportBtn = document.getElementById('exportBtn');
const form = document.getElementById('memberForm');
const formTitle = document.getElementById('formTitle');
const formError = document.getElementById('formError');
const cancelBtn = document.getElementById('cancelBtn');
const activityContent = document.getElementById('activityContent');
const whoami = document.getElementById('whoami');
const logoutBtn = document.getElementById('logoutBtn');
const staffTab = document.getElementById('staffTab');
const staffContent = document.getElementById('staffContent');
const staffForm = document.getElementById('staffForm');
const staffFormError = document.getElementById('staffFormError');
const staffFormSuccess = document.getElementById('staffFormSuccess');
const staffSubmitBtn = document.getElementById('staffSubmitBtn');

const changeUsernameBtn = document.getElementById('changeUsernameBtn');
const usernameOverlay = document.getElementById('usernameOverlay');
const usernameForm = document.getElementById('usernameForm');
const usernameError = document.getElementById('usernameError');
const usernameCancel = document.getElementById('usernameCancel');

const changePasswordBtn = document.getElementById('changePasswordBtn');
const passwordOverlay = document.getElementById('passwordOverlay');
const passwordForm = document.getElementById('passwordForm');
const passwordError = document.getElementById('passwordError');
const passwordCancel = document.getElementById('passwordCancel');

const resetPasswordOverlay = document.getElementById('resetPasswordOverlay');
const resetPasswordForm = document.getElementById('resetPasswordForm');
const resetPasswordError = document.getElementById('resetPasswordError');
const resetPasswordName = document.getElementById('resetPasswordName');
const resetPasswordCancel = document.getElementById('resetPasswordCancel');
let resetPasswordUserId = null;

const paginationBar = document.getElementById('paginationBar');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageLabel = document.getElementById('pageLabel');

const partnersContent = document.getElementById('partnersContent');
const partnerCount = document.getElementById('partnerCount');
const partnerSearchInput = document.getElementById('partnerSearchInput');
const partnerExportBtn = document.getElementById('partnerExportBtn');
const partnerPaginationBar = document.getElementById('partnerPaginationBar');
const partnerPrevPageBtn = document.getElementById('partnerPrevPageBtn');
const partnerNextPageBtn = document.getElementById('partnerNextPageBtn');
const partnerPageLabel = document.getElementById('partnerPageLabel');
const partnerReadonlyGrid = document.getElementById('partnerReadonlyGrid');
const partnerPrayerText = document.getElementById('partnerPrayerText');
const partnerWhyText = document.getElementById('partnerWhyText');
const partnerEditForm = document.getElementById('partnerEditForm');
const partnerCancelBtn = document.getElementById('partnerCancelBtn');

const heroPartners = document.getElementById('heroPartners');
const heroNote = document.getElementById('heroNote');
const statusRollup = document.getElementById('statusRollup');
const overviewActivity = document.getElementById('overviewActivity');

const overlay = document.getElementById('confirmOverlay');
const confirmName = document.getElementById('confirmName');
const confirmContext = document.getElementById('confirmContext');
const confirmDelete = document.getElementById('confirmDelete');
const confirmCancel = document.getElementById('confirmCancel');

// ---- Auth helpers -----------------------------------------------------------
// If a request comes back unauthorized (e.g. the session expired), bounce
// back to the login screen instead of leaving the page looking broken.
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  return res;
}

async function loadWhoAmI() {
  try {
    const res = await apiFetch('/api/me');
    const me = await res.json();
    currentUserName = me.name;
    currentUserRole = me.role;
    currentUserId = me.id;
    currentUsername = me.username;
    whoami.textContent = `Signed in as ${me.name}${me.role === 'admin' ? ' (Admin)' : ''}`;
    staffTab.hidden = me.role !== 'admin';
  } catch {
    // apiFetch already redirects on 401
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---- Tab / view switching --------------------------------------------------
function showView(name, activeTab) {
  const tabName = activeTab || name;
  tabs.forEach((t) => {
    const active = t.dataset.view === tabName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  views.forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));

  if (name === 'activity') loadActivity();
  if (name === 'partners') loadPartners();
  if (name === 'overview') loadDashboard();
  if (name === 'directory' && !state.members.length) loadMembers();
  if (name === 'staff') loadStaff();
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.view === 'form' && state.editingId === null) {
      resetForm(); // fresh "Add Member" form when clicking the tab directly
    }
    showView(tab.dataset.view);
  });
});

// ---- Shared helpers ---------------------------------------------------------
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  if (isNaN(date)) return d;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  const date = new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z');
  if (isNaN(date)) return d;
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================================================
// MEMBERS (Directory)
// =============================================================================

async function loadMembers() {
  const params = new URLSearchParams({
    sort: state.sort,
    dir: state.dir,
    page: state.page,
    pageSize: state.pageSize,
  });
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());

  const res = await apiFetch(`/api/members?${params.toString()}`);
  const body = await res.json();
  state.members = body.data;
  state.total = body.total;
  renderDirectory();
}

function updateExportLink() {
  const q = searchInput.value.trim();
  exportBtn.href = q ? `/api/export?q=${encodeURIComponent(q)}` : '/api/export';
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadMembers();
    updateExportLink();
  }, 200);
});

prevPageBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadMembers();
  }
});

nextPageBtn.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page < totalPages) {
    state.page += 1;
    loadMembers();
  }
});

function setSort(column) {
  if (state.sort === column) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = column;
    state.dir = 'asc';
  }
  state.page = 1;
  loadMembers();
}

function sortIndicator(column, sort, dir) {
  if (sort !== column) return '';
  return dir === 'asc' ? ' ▲' : ' ▼';
}

function renderDirectory() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  memberCount.textContent = `${state.total} member${state.total === 1 ? '' : 's'}`;

  if (state.total === 0) {
    directoryContent.innerHTML = `
      <div class="empty-state">
        <strong>No members yet</strong>
        Use the "Add Member" tab to start building your directory.
      </div>`;
    paginationBar.hidden = true;
    return;
  }

  const rows = state.members.map(memberRowHTML).join('');
  const cards = state.members.map(memberCardHTML).join('');

  const sortableHeader = (column) =>
    `<th><button type="button" class="sort-btn" data-sort="${column}">${SORT_LABELS[column]}${sortIndicator(column, state.sort, state.dir)}</button></th>`;

  directoryContent.innerHTML = `
    <table class="member-table">
      <thead>
        <tr>
          ${sortableHeader('full_name')}
          ${sortableHeader('phone')}
          ${sortableHeader('email')}
          ${sortableHeader('marital_status')}
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="member-cards">${cards}</div>
  `;

  directoryContent.querySelectorAll('[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => setSort(btn.dataset.sort))
  );
  directoryContent.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => startEdit(Number(btn.dataset.edit)))
  );
  directoryContent.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', () => askDeleteMember(Number(btn.dataset.delete)))
  );

  paginationBar.hidden = totalPages <= 1;
  pageLabel.textContent = `Page ${state.page} of ${totalPages}`;
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = state.page >= totalPages;
}

function memberRowHTML(m) {
  return `
    <tr>
      <td>
        <div class="member-name">${escapeHTML(m.full_name)}</div>
        <div class="member-sub">${m.date_of_birth ? 'Born ' + formatDate(m.date_of_birth) : ''}</div>
      </td>
      <td>${escapeHTML(m.phone || '—')}</td>
      <td>${escapeHTML(m.email || '—')}</td>
      <td>${escapeHTML(m.marital_status || '—')}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit="${m.id}">Edit</button>
          <button class="icon-btn danger" data-delete="${m.id}">Remove</button>
        </div>
      </td>
    </tr>`;
}

function memberCardHTML(m) {
  return `
    <div class="member-card">
      <div class="member-name">${escapeHTML(m.full_name)}</div>
      <div class="member-sub">${escapeHTML(m.phone || '—')} · ${escapeHTML(m.email || '—')}</div>
      <div class="member-sub">${escapeHTML(m.marital_status || '—')}</div>
      <div class="row-actions">
        <button class="icon-btn" data-edit="${m.id}">Edit</button>
        <button class="icon-btn danger" data-delete="${m.id}">Remove</button>
      </div>
    </div>`;
}

// ---- Add / Edit member form -----------------------------------------------------
function resetForm() {
  form.reset();
  form.elements['id'].value = '';
  state.editingId = null;
  formTitle.textContent = 'Add a Member';
  formError.hidden = true;
}

function startEdit(id) {
  const member = state.members.find((m) => m.id === id);
  if (!member) return;
  state.editingId = id;
  formTitle.textContent = 'Edit Member';
  formError.hidden = true;

  form.elements['id'].value = member.id;
  form.elements['full_name'].value = member.full_name || '';
  form.elements['gender'].value = member.gender || '';
  form.elements['date_of_birth'].value = member.date_of_birth || '';
  form.elements['marital_status'].value = member.marital_status || '';
  form.elements['phone'].value = member.phone || '';
  form.elements['email'].value = member.email || '';
  form.elements['member_since'].value = member.member_since || '';
  form.elements['address'].value = member.address || '';

  showView('form');
}

cancelBtn.addEventListener('click', () => {
  resetForm();
  showView('directory');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const data = Object.fromEntries(new FormData(form).entries());
  const id = data.id;
  delete data.id;

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/members/${id}` : '/api/members';

  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    formError.textContent = (body.errors && body.errors.join(' ')) || 'Something went wrong. Please try again.';
    formError.hidden = false;
    return;
  }

  resetForm();
  showView('directory');
  loadMembers();
});

function askDeleteMember(id) {
  const member = state.members.find((m) => m.id === id);
  if (!member) return;
  pendingDelete = { type: 'member', id, name: member.full_name };
  confirmName.textContent = member.full_name;
  confirmContext.textContent = 'the directory';
  overlay.hidden = false;
}

// =============================================================================
// PARTNERS (Kingdom Partnership registrations)
// =============================================================================

async function loadPartners() {
  const params = new URLSearchParams({
    sort: partnerState.sort,
    dir: partnerState.dir,
    page: partnerState.page,
    pageSize: partnerState.pageSize,
  });
  if (partnerSearchInput.value.trim()) params.set('q', partnerSearchInput.value.trim());

  const res = await apiFetch(`/api/partners?${params.toString()}`);
  const body = await res.json();
  partnerState.partners = body.data;
  partnerState.total = body.total;
  renderPartners();
}

function updatePartnerExportLink() {
  const q = partnerSearchInput.value.trim();
  partnerExportBtn.href = q ? `/api/partners/export?q=${encodeURIComponent(q)}` : '/api/partners/export';
}

let partnerSearchTimer;
partnerSearchInput.addEventListener('input', () => {
  clearTimeout(partnerSearchTimer);
  partnerSearchTimer = setTimeout(() => {
    partnerState.page = 1;
    loadPartners();
    updatePartnerExportLink();
  }, 200);
});

partnerPrevPageBtn.addEventListener('click', () => {
  if (partnerState.page > 1) {
    partnerState.page -= 1;
    loadPartners();
  }
});

partnerNextPageBtn.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(partnerState.total / partnerState.pageSize));
  if (partnerState.page < totalPages) {
    partnerState.page += 1;
    loadPartners();
  }
});

function setPartnerSort(column) {
  if (partnerState.sort === column) {
    partnerState.dir = partnerState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    partnerState.sort = column;
    partnerState.dir = 'asc';
  }
  partnerState.page = 1;
  loadPartners();
}

// Status color never travels alone — each badge carries an icon and the
// status word, so the state survives color-blindness and grayscale print.
const STATUS_ICONS = {
  Active: '✓',
  Inactive: '○',
  Suspended: '⨯',
  Upgraded: '↑',
  Downgraded: '↓',
};

function statusBadgeHTML(status) {
  if (!status) {
    return '<span class="status-badge status-none"><span class="status-icon" aria-hidden="true">–</span>Not set</span>';
  }
  const cls = 'status-' + status.toLowerCase();
  const icon = STATUS_ICONS[status] || '•';
  return `<span class="status-badge ${cls}"><span class="status-icon" aria-hidden="true">${icon}</span>${escapeHTML(status)}</span>`;
}

function renderPartners() {
  const totalPages = Math.max(1, Math.ceil(partnerState.total / partnerState.pageSize));
  partnerCount.textContent = `${partnerState.total} partner${partnerState.total === 1 ? '' : 's'}`;

  if (partnerState.total === 0) {
    partnersContent.innerHTML = `
      <div class="empty-state">
        <strong>No registrations yet</strong>
        Submissions from the public registration form will appear here.
      </div>`;
    partnerPaginationBar.hidden = true;
    return;
  }

  const rows = partnerState.partners.map(partnerRowHTML).join('');
  const cards = partnerState.partners.map(partnerCardHTML).join('');

  const sortableHeader = (column) =>
    `<th><button type="button" class="sort-btn" data-sort="${column}">${PARTNER_SORT_LABELS[column]}${sortIndicator(column, partnerState.sort, partnerState.dir)}</button></th>`;

  partnersContent.innerHTML = `
    <table class="member-table">
      <thead>
        <tr>
          ${sortableHeader('full_name')}
          ${sortableHeader('phone')}
          ${sortableHeader('partnership_category')}
          ${sortableHeader('status')}
          ${sortableHeader('submitted_at')}
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="member-cards">${cards}</div>
  `;

  partnersContent.querySelectorAll('[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => setPartnerSort(btn.dataset.sort))
  );
  partnersContent.querySelectorAll('[data-review]').forEach((btn) =>
    btn.addEventListener('click', () => openPartnerEdit(Number(btn.dataset.review)))
  );
  partnersContent.querySelectorAll('[data-delete-partner]').forEach((btn) =>
    btn.addEventListener('click', () => askDeletePartner(Number(btn.dataset.deletePartner)))
  );

  partnerPaginationBar.hidden = totalPages <= 1;
  partnerPageLabel.textContent = `Page ${partnerState.page} of ${totalPages}`;
  partnerPrevPageBtn.disabled = partnerState.page <= 1;
  partnerNextPageBtn.disabled = partnerState.page >= totalPages;
}

function partnerRowHTML(p) {
  return `
    <tr>
      <td>
        <div class="member-name">${escapeHTML(p.full_name)}</div>
      </td>
      <td>${escapeHTML(p.phone || '—')}</td>
      <td>${escapeHTML(p.partnership_category || '—')}</td>
      <td>${statusBadgeHTML(p.status)}</td>
      <td>${formatDateTime(p.submitted_at)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-review="${p.id}">Review</button>
          <button class="icon-btn danger" data-delete-partner="${p.id}">Remove</button>
        </div>
      </td>
    </tr>`;
}

function partnerCardHTML(p) {
  return `
    <div class="member-card">
      <div class="member-name">${escapeHTML(p.full_name)}</div>
      <div class="member-sub">${escapeHTML(p.phone || '—')} · ${escapeHTML(p.partnership_category || '—')}</div>
      <div class="member-sub">${statusBadgeHTML(p.status)} · ${formatDateTime(p.submitted_at)}</div>
      <div class="row-actions">
        <button class="icon-btn" data-review="${p.id}">Review</button>
        <button class="icon-btn danger" data-delete-partner="${p.id}">Remove</button>
      </div>
    </div>`;
}

// ---- Partner review / edit form -----------------------------------------------
function openPartnerEdit(id) {
  const p = partnerState.partners.find((x) => x.id === id);
  if (!p) return;
  partnerState.editingId = id;

  partnerReadonlyGrid.innerHTML = [
    ['Date of birth', p.date_of_birth ? formatDate(p.date_of_birth) : '—'],
    ['Gender', p.gender || '—'],
    ['Nationality', p.nationality || '—'],
    ['Town/City', p.town_city || '—'],
    ['Residential address', p.residential_address || '—'],
    ['Phone', p.phone || '—'],
    ['WhatsApp', p.whatsapp || '—'],
    ['Email', p.email || '—'],
    ['Occupation/Business', p.occupation || '—'],
    ['Church (if different)', p.church_if_different || '—'],
    ['Partnership category chosen', p.partnership_category || '—'],
    ['Monthly amount', p.monthly_amount ? `K${p.monthly_amount}` : '—'],
    ['Payment method', p.payment_method === 'Other' ? `Other: ${p.payment_method_other || ''}` : (p.payment_method || '—')],
    ['Signature', p.signature || '—'],
  ].map(([label, value]) => `<div><span>${label}</span>${escapeHTML(String(value))}</div>`).join('');

  partnerPrayerText.textContent = p.prayer_requests || '—';
  partnerWhyText.textContent = p.why_partner || '—';

  const f = partnerEditForm.elements;
  f['id'].value = p.id;
  f['partner_id_code'].value = p.partner_id_code || '';
  f['category_assigned'].value = p.category_assigned || '';
  f['date_registered'].value = p.date_registered || '';
  f['registered_by'].value = p.registered_by || currentUserName;
  f['receipt_number'].value = p.receipt_number || '';
  f['remarks'].value = p.remarks || '';
  f['status'].value = p.status || '';
  f['status_date'].value = p.status_date || '';
  f['authorized_officer'].value = p.authorized_officer || currentUserName;

  showView('partner-edit', 'partners');
}

partnerCancelBtn.addEventListener('click', () => {
  showView('partners');
});

partnerEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(partnerEditForm).entries());
  const id = data.id;
  delete data.id;

  const res = await apiFetch(`/api/partners/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) return; // errors here are unlikely since this form has no required fields

  showView('partners');
  loadPartners();
});

function askDeletePartner(id) {
  const p = partnerState.partners.find((x) => x.id === id);
  if (!p) return;
  pendingDelete = { type: 'partner', id, name: p.full_name };
  confirmName.textContent = p.full_name;
  confirmContext.textContent = 'partner records';
  overlay.hidden = false;
}

// =============================================================================
// Shared delete confirmation (members + partners)
// =============================================================================

confirmCancel.addEventListener('click', () => {
  overlay.hidden = true;
  pendingDelete = null;
});

confirmDelete.addEventListener('click', async () => {
  if (!pendingDelete) return;
  if (pendingDelete.type === 'member') {
    await apiFetch(`/api/members/${pendingDelete.id}`, { method: 'DELETE' });
    overlay.hidden = true;
    pendingDelete = null;
    loadMembers();
  } else if (pendingDelete.type === 'partner') {
    await apiFetch(`/api/partners/${pendingDelete.id}`, { method: 'DELETE' });
    overlay.hidden = true;
    pendingDelete = null;
    loadPartners();
  }
});

// =============================================================================
// Activity log
// =============================================================================
const ACTION_LABELS = { added: 'added', updated: 'updated', removed: 'removed', registered: 'registered as a Kingdom Partner' };
const ACTIVITY_DOT_CLASSES = { registered: 'added', login: 'login', logout: 'logout' };

// Login/logout events have no member record to reference, so they get their
// own sentence instead of trying to force them through the "did X to Y"
// template every other action uses.
function activityLineHTML(log) {
  const who = `<strong>${escapeHTML(log.performed_by || 'Someone')}</strong>`;
  if (log.action === 'login') return `${who} signed in`;
  if (log.action === 'logout') return `${who} signed out`;
  return `${who} ${ACTION_LABELS[log.action] || log.action} <strong>${escapeHTML(log.member_name || 'a record')}</strong>`;
}

function activityListHTML(logs) {
  return `
    <ul class="activity-list">
      ${logs.map((log) => `
        <li>
          <span class="activity-dot activity-${ACTIVITY_DOT_CLASSES[log.action] || log.action}"></span>
          <span>${activityLineHTML(log)}</span>
          <span class="activity-time">${formatDateTime(log.created_at)}</span>
        </li>
      `).join('')}
    </ul>`;
}

const ACTIVITY_EMPTY = '<div class="empty-state"><strong>No activity yet</strong>Actions will show up here as members and partners are added, edited, or removed.</div>';

async function loadActivity() {
  activityContent.innerHTML = '<p class="panel-sub">Loading…</p>';
  try {
    const res = await apiFetch('/api/activity-log?limit=50');
    const logs = await res.json();
    activityContent.innerHTML = logs.length ? activityListHTML(logs) : ACTIVITY_EMPTY;
  } catch {
    // apiFetch already redirects on 401
  }
}

// =============================================================================
// OVERVIEW dashboard
// =============================================================================

// The partnership tiers are an ORDERED scale, so they take a one-hue ordinal
// ramp — the reader sees the tier order in the color itself. Nominal
// categories (towns) get a single hue instead, because bar length already
// carries the value.
const TIER_ORDER = ['Blue', 'Bronze', 'Silver', 'Gold', 'Star/Diamond'];
const TIER_COLORS = {
  Blue: 'var(--tier-1)',
  Bronze: 'var(--tier-2)',
  Silver: 'var(--tier-3)',
  Gold: 'var(--tier-4)',
  'Star/Diamond': 'var(--tier-5)',
};

const GENDER_COLORS = {
  Male: 'var(--series-1)',
  Female: 'var(--series-2)',
  'Not stated': 'var(--series-3)',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(key, long) {
  const [year, month] = key.split('-');
  const name = MONTH_NAMES[Number(month) - 1] || key;
  return long ? `${name} ${year}` : name;
}

// Each chart card keeps both renderings and swaps between them, so no value
// is ever reachable only by hovering.
const chartRenderers = {};

function renderChartCard(name) {
  const card = document.querySelector(`[data-chart="${name}"]`);
  if (!card) return;
  const renderer = chartRenderers[name];
  if (!renderer) return;

  const body = card.querySelector('.chart-body');
  const showingTable = card.dataset.view === 'table';

  body.innerHTML = '';
  if (showingTable) {
    body.innerHTML = renderer.table();
  } else {
    renderer.chart(body);
    const legendHTML = renderer.legend ? renderer.legend() : '';
    if (legendHTML) body.insertAdjacentHTML('beforeend', legendHTML);
  }

  const toggle = card.querySelector('[data-toggle-view]');
  if (toggle) toggle.textContent = showingTable ? 'Chart' : 'Table';
}

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle-view]');
  if (!toggle) return;
  const card = toggle.closest('[data-chart]');
  if (!card) return;
  card.dataset.view = card.dataset.view === 'table' ? 'chart' : 'table';
  renderChartCard(card.dataset.chart);
});

// Charts are drawn at their container's pixel width, so a resize has to
// redraw them rather than let the browser scale the type.
let resizeTimer;
let lastChartWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastChartWidth) return;
  lastChartWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    Object.keys(chartRenderers).forEach(renderChartCard);
  }, 180);
});

let dashboardLoaded = false;

async function loadDashboard() {
  // On a refetch, hold the previous render at reduced opacity rather than
  // flashing skeletons and jumping the layout.
  if (dashboardLoaded) {
    document.querySelectorAll('.chart-body').forEach((b) => b.classList.add('is-stale'));
  }

  let stats;
  try {
    const res = await apiFetch('/api/stats');
    stats = await res.json();
  } catch {
    return; // apiFetch already redirects on 401
  }

  document.querySelectorAll('.chart-body').forEach((b) => b.classList.remove('is-stale'));
  renderDashboard(stats);
  dashboardLoaded = true;
}

function renderDashboard(stats) {
  const t = stats.totals;

  // ---- Hero figure -------------------------------------------------------
  UI.countUp(heroPartners, t.partners);
  heroNote.textContent = t.partnersThisMonth
    ? `${t.partnersThisMonth} registered so far this month.`
    : 'No new registrations yet this month.';

  // ---- Stat tiles --------------------------------------------------------
  const townCount = Number(t.towns) || 0;

  setTile('tileMembers', t.members);
  setTile('tileNewPartners', t.partnersThisMonth);
  setTile('tilePending', t.pendingReview);
  setTile('tileTowns', townCount);

  document.getElementById('tileMembersDelta').innerHTML = t.membersThisMonth
    ? `<strong>+${t.membersThisMonth}</strong> added this month`
    : 'No change this month';
  document.getElementById('tileMembersDelta').classList.toggle('is-up', t.membersThisMonth > 0);

  document.getElementById('tileNewPartnersSpark').innerHTML =
    Charts.sparkline(stats.monthly.map((m) => m.count));

  document.getElementById('tilePendingNote').textContent = t.pendingReview
    ? 'Registrations with no status set'
    : 'Every registration has a status';

  document.getElementById('tileTownsNote').textContent = townCount
    ? 'Distinct towns and cities'
    : 'No towns recorded yet';

  // ---- Growth over time (single series, so no legend) --------------------
  const points = stats.monthly.map((m) => ({
    label: monthLabel(m.month),
    fullLabel: monthLabel(m.month, true),
    value: m.count,
  }));

  chartRenderers.growth = {
    chart: (body) => Charts.line(body, {
      points,
      unit: 'registrations',
      ariaLabel: 'Partner registrations per month over the last twelve months',
    }),
    table: () => Charts.table(
      ['Month', 'Registrations'],
      stats.monthly.map((m) => [monthLabel(m.month, true), UI.formatNumber(m.count)])
    ),
  };

  // ---- Partnership levels (ordinal ramp) ---------------------------------
  const tierRows = TIER_ORDER
    .map((tier) => {
      const found = stats.byCategory.find((c) => c.label === tier);
      return { label: tier, value: found ? Number(found.count) : 0, color: TIER_COLORS[tier] };
    })
    .filter((r) => r.value > 0);

  const notStated = stats.byCategory.find((c) => c.label === 'Not stated');
  if (notStated) {
    tierRows.push({ label: 'Not stated', value: Number(notStated.count), color: 'var(--axis)' });
  }

  chartRenderers.tiers = {
    chart: (body) => Charts.bars(body, {
      rows: tierRows,
      gutter: 110,
      unit: 'partners',
      ariaLabel: 'Partners by partnership level',
    }),
    table: () => Charts.table(
      ['Level', 'Partners'],
      tierRows.map((r) => [r.label, UI.formatNumber(r.value)])
    ),
  };

  // ---- Top towns (nominal — one hue for every bar) -----------------------
  const townRows = stats.topTowns.map((row) => ({ label: row.label, value: Number(row.count) }));

  chartRenderers.towns = {
    chart: (body) => Charts.bars(body, {
      rows: townRows,
      gutter: 130,
      unit: 'partners',
      ariaLabel: 'Partners by town or city',
    }),
    table: () => Charts.table(
      ['Town / City', 'Partners'],
      townRows.map((r) => [r.label, UI.formatNumber(r.value)])
    ),
  };

  // ---- Gender split (part-to-whole, categorical) -------------------------
  const genderOrder = ['Male', 'Female', 'Not stated'];
  const genderSegments = genderOrder
    .map((label) => {
      const found = stats.byGender.find((g) => g.label === label);
      return { label, value: found ? Number(found.count) : 0, color: GENDER_COLORS[label] };
    })
    .filter((s) => s.value > 0);

  chartRenderers.gender = {
    chart: (body) => Charts.stacked(body, {
      segments: genderSegments,
      key: 'gender',
      ariaLabel: 'Partners by gender',
    }),
    legend: () => Charts.legend(genderSegments),
    table: () => Charts.table(
      ['Gender', 'Partners'],
      genderSegments.map((s) => [s.label, UI.formatNumber(s.value)])
    ),
  };

  ['growth', 'tiers', 'towns', 'gender'].forEach(renderChartCard);

  // ---- Status roll-up ----------------------------------------------------
  const statusOrder = ['Active', 'Upgraded', 'Downgraded', 'Inactive', 'Suspended', 'Not set'];
  const statuses = statusOrder
    .map((label) => stats.byStatus.find((s) => s.label === label))
    .filter(Boolean);

  statusRollup.innerHTML = statuses.length
    ? statuses.map((s) => `
        <span class="status-rollup-item">
          ${statusBadgeHTML(s.label === 'Not set' ? '' : s.label)}
          <span class="status-rollup-count">${UI.formatNumber(s.count)}</span>
        </span>`).join('')
    : '<p class="panel-sub" style="margin:0;">No registrations yet.</p>';

  loadOverviewActivity();
}

function setTile(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('skeleton', 'skeleton-value');
  UI.countUp(el, value);
}

async function loadOverviewActivity() {
  try {
    const res = await apiFetch('/api/activity-log?limit=5');
    const logs = await res.json();
    overviewActivity.innerHTML = logs.length ? activityListHTML(logs) : ACTIVITY_EMPTY;
  } catch {
    // apiFetch already redirects on 401
  }
}

// =============================================================================
// Change my own username
// =============================================================================

changeUsernameBtn.addEventListener('click', () => {
  usernameForm.reset();
  usernameForm.elements['full_name'].value = currentUserName;
  usernameForm.elements['username'].value = currentUsername;
  usernameError.hidden = true;
  usernameOverlay.hidden = false;
});

usernameCancel.addEventListener('click', () => {
  usernameOverlay.hidden = true;
});

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  usernameError.hidden = true;

  const data = Object.fromEntries(new FormData(usernameForm).entries());
  const res = await apiFetch('/api/me/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    usernameError.textContent = body.error || 'Could not update your account.';
    usernameError.hidden = false;
    return;
  }

  const me = await res.json();
  currentUserName = me.name;
  currentUsername = me.username;
  whoami.textContent = `Signed in as ${me.name}${me.role === 'admin' ? ' (Admin)' : ''}`;
  usernameOverlay.hidden = true;
});

// =============================================================================
// Change my own password
// =============================================================================

changePasswordBtn.addEventListener('click', () => {
  passwordForm.reset();
  passwordError.hidden = true;
  passwordOverlay.hidden = false;
});

passwordCancel.addEventListener('click', () => {
  passwordOverlay.hidden = true;
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passwordError.hidden = true;

  const data = Object.fromEntries(new FormData(passwordForm).entries());
  const res = await apiFetch('/api/me/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    passwordError.textContent = body.error || 'Could not change your password.';
    passwordError.hidden = false;
    return;
  }

  passwordOverlay.hidden = true;
});

// =============================================================================
// STAFF ACCOUNTS (admin only)
// =============================================================================

async function loadStaff() {
  staffContent.innerHTML = '<p class="panel-sub">Loading…</p>';
  try {
    const res = await apiFetch('/api/users');
    staffUsers = await res.json();
    renderStaff();
  } catch {
    // apiFetch already redirects on 401
  }
}

function roleLabel(role) {
  return role === 'admin' ? 'Admin' : 'Data entry';
}

function renderStaff() {
  if (!staffUsers.length) {
    staffContent.innerHTML = '<div class="empty-state"><strong>No staff accounts yet</strong>Use the form above to create the first one.</div>';
    return;
  }

  const rows = staffUsers.map((u) => `
    <tr>
      <td>
        <div class="member-name">${escapeHTML(u.full_name)}</div>
        <div class="member-sub">@${escapeHTML(u.username)}</div>
      </td>
      <td>
        <select data-role-select="${u.id}" ${u.id === currentUserId ? 'disabled' : ''}>
          <option value="data-entry" ${u.role === 'data-entry' ? 'selected' : ''}>Data entry</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>${u.active
        ? '<span class="status-badge status-active"><span class="status-icon" aria-hidden="true">✓</span>Active</span>'
        : '<span class="status-badge status-inactive"><span class="status-icon" aria-hidden="true">○</span>Inactive</span>'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-reset-password="${u.id}" data-name="${escapeHTML(u.full_name)}">Reset password</button>
          <button class="icon-btn ${u.active ? 'danger' : ''}" data-toggle-active="${u.id}" ${u.id === currentUserId ? 'disabled' : ''}>${u.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </td>
    </tr>`).join('');

  staffContent.innerHTML = `
    <table class="member-table">
      <thead>
        <tr><th>Staff member</th><th>Role</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  staffContent.querySelectorAll('[data-role-select]').forEach((sel) => {
    sel.addEventListener('change', () => updateStaffUser(Number(sel.dataset.roleSelect), { role: sel.value }));
  });
  staffContent.querySelectorAll('[data-toggle-active]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = staffUsers.find((u) => u.id === Number(btn.dataset.toggleActive));
      if (user) updateStaffUser(user.id, { active: !user.active });
    });
  });
  staffContent.querySelectorAll('[data-reset-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      resetPasswordUserId = Number(btn.dataset.resetPassword);
      resetPasswordName.textContent = btn.dataset.name;
      resetPasswordForm.reset();
      resetPasswordError.hidden = true;
      resetPasswordOverlay.hidden = false;
    });
  });
}

async function updateStaffUser(id, patch) {
  const res = await apiFetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert(body.error || 'Could not update that staff account.');
  }
  loadStaff();
}

staffForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  staffFormError.hidden = true;
  staffFormSuccess.hidden = true;

  // Guards against the "taken" error you'd get from clicking twice while
  // the first request is still in flight.
  staffSubmitBtn.disabled = true;

  const data = Object.fromEntries(new FormData(staffForm).entries());

  let res;
  try {
    res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } finally {
    staffSubmitBtn.disabled = false;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    staffFormError.textContent = (body.errors && body.errors.join(' ')) || 'Could not create that account.';
    staffFormError.hidden = false;
    return;
  }

  staffFormSuccess.textContent = `"${data.full_name}" was created — they can now sign in with the username and password you set.`;
  staffFormSuccess.hidden = false;
  staffForm.reset();
  loadStaff();
});

resetPasswordCancel.addEventListener('click', () => {
  resetPasswordOverlay.hidden = true;
  resetPasswordUserId = null;
});

resetPasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetPasswordError.hidden = true;

  const data = Object.fromEntries(new FormData(resetPasswordForm).entries());
  const res = await apiFetch(`/api/users/${resetPasswordUserId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    resetPasswordError.textContent = body.error || 'Could not reset that password.';
    resetPasswordError.hidden = false;
    return;
  }

  resetPasswordOverlay.hidden = true;
  resetPasswordUserId = null;
});

// ---- Init ------------------------------------------------------------------
loadWhoAmI();
loadDashboard();
