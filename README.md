# Church Member Directory

A simple, responsive app for collecting and managing basic member demographic
information. Works on phones, tablets, and computers through a normal web
browser — no app-store install needed. Share the link with staff/admins who
need access.

## What's included

- **Public landing page** — a full ministry homepage: hero, live partner
  counters, the five partnership levels, a rotating scripture, and calls to
  action
- **Kingdom Partnership Registration form** — public, no login required, and
  presented as a five-step wizard with a progress bar, inline validation, and
  a draft that is saved in the visitor's own browser as they go; submissions
  are reviewed and managed by staff in a dedicated Partners tab
- **Login screen** — every staff member signs in with their own username and
  password; **Staff accounts** (admin only) creates, deactivates, and manages
  everyone else's accounts, and each person's name is used to credit their
  changes in the activity log
  when logging in as staff these are the super user credentials
  admin : admin
  password : admin1234
- **Security hardening** — HTTP security headers (Helmet), rate-limiting on
  the sign-in form to slow down password guessing, hashed passwords (no
  plaintext passwords are ever stored), and sessions stored in the database
  so nobody is logged out when the server restarts or redeploys
- **Duplicate registration detection** — if the same person (matched on name
  + phone or name + email) submits the partnership form twice, the second
  submission is stopped with a friendly message instead of creating a
  duplicate record
- **Overview dashboard** — the staff landing tab: headline partner count, stat
  tiles, a twelve-month registration trend, partnership-level and town
  breakdowns, a gender split, and a status roll-up. Every chart has a
  table view for reading the exact numbers.
- **Light and dark themes** — a toggle in the header, remembered per browser
- **Directory view** — searchable, sortable, paginated list of members
  (table on desktop, cards on mobile). Click a column heading to sort by it.
- **Add / Edit form** — captures name, gender, date of birth, marital status,
  phone, email, address, and member-since date
- **Activity Log** — shows who signed in and out (with the exact time), and
  who added, edited, or removed each member or partner, most recent first
- **Export to Excel** — a button that downloads all (or filtered/searched)
  members as a `.csv` file, which opens directly in Excel
- **SQLite database** (`church.db`) by default — a single file, no server
  setup required
- **Optional PostgreSQL support** — set one environment variable and the app
  automatically switches to a shared, external database (see below)

## Running it locally

You need [Node.js](https://nodejs.org) (version 18 or newer) installed.

```bash
cd church-member-app
npm install
```

Copy `.env.example` to `.env` and set a session secret:
```
SESSION_SECRET=any-long-random-string
```

Then create your first staff account (you'll be asked for a full name,
username, and password):
```bash
npm run create-admin
```

Then:
```bash
npm start
```

Open **http://localhost:3000** in your browser and sign in with the
username and password you just created. That account has the **admin**
role, so once you're signed in you can create accounts for the rest of
your staff from the **Staff** tab instead of running the script again —
see [Staff accounts and roles](#staff-accounts-and-roles) below.

The first time you run it, a `church.db` file will be created automatically
in the project folder — that's your database. See
[Backing up your data](#backing-up-your-data) below for how to back it up
regularly instead of just occasionally.

## Adding your church logo

Drop your logo image into the `public` folder and name it `logo.png`
(square images work best, e.g. 200×200px). It will appear automatically in
the header — no code changes needed. If no logo file is present, a simple
placeholder icon is shown instead.

To change the church name shown next to the logo, open `public/app.html`
and edit this line:

```html
<h1 id="churchName">Your Church Name</h1>
```

## Deploying so it's reachable by a link

**Recommended: [Render](https://render.com) (free tier to start)**

1. Push this project to a GitHub repository.
2. In Render, choose **New → Web Service** and connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Before creating the service, scroll to **Environment Variables** and add:
   - `SESSION_SECRET` — any long random string (so logins survive restarts)
6. Render will give you a URL like `https://your-church.onrender.com`. You
   still need to create your first sign-in account there — see
   [Staff accounts and roles](#staff-accounts-and-roles) for how (Render's
   **free tier has no Shell tab**, so use the environment-variable method
   described there, not `npm run create-admin`).

**Important note on the free tier:** Render's free web services use a
temporary filesystem, which means the `church.db` file (and any data in it)
can be wiped when the service restarts or redeploys. This is fine for
testing, but for real member data you have two options once you're ready:

- Add a small **persistent disk** to your Render service (a few dollars a
  month) so `church.db` survives restarts, or
- Upgrade to a hosted database (see below) — this is the "upgrade path"
  this project was built for.

Other simple options that work the same way: [Railway](https://railway.app)
and [Fly.io](https://fly.io) — both support persistent storage even on
inexpensive tiers.

## Staff accounts and roles

There is no shared password anymore — every staff member signs in with their
own username and password. Two roles exist:

- **Admin** — everything a data-entry user can do, plus the **Staff** tab,
  where they can create new staff accounts, promote/demote roles, deactivate
  or reactivate an account, and reset anyone's password.
- **Data entry** — full access to members, partners, and the dashboard, but
  no access to the Staff tab.

**Creating the very first account** (there's no one signed in yet to do it
from the app) can be done two ways:

- **If you have a terminal/shell on the machine running the app** (local
  development, or a host with shell access): run
  ```bash
  npm run create-admin
  ```
  This asks for a full name, username, and password, and creates an admin
  account. Run it again any time you need another admin the same way — for
  example if everyone forgets their password.

- **If you don't** (e.g. Render's free tier has no Shell tab): set two
  environment variables on your host — `BOOTSTRAP_ADMIN_USERNAME` and
  `BOOTSTRAP_ADMIN_PASSWORD` (8+ characters) — and restart/redeploy the
  service. On startup, if no staff accounts exist yet, the app creates an
  admin account from those two values automatically and logs a confirmation
  line. It only ever does this once — as soon as any account exists, setting
  these again does nothing, so it's safe to leave them in place, though it's
  better practice to delete them from your host's environment variables once
  you've signed in (no reason to leave a plaintext password sitting in a
  dashboard indefinitely).

**Creating everyone else's account** is done from inside the app: sign in
as an admin, open the **Staff** tab, and fill in the "Add a staff account"
form. Give the new person their username and temporary password out of
band (in person, a phone call, etc.) — anyone can change their own password
afterwards from the **Change password** link next to Log out.

A safety rail is built in: the app won't let you deactivate or demote the
last remaining active admin, so you can't accidentally lock everyone out.

## Security

A few things were added specifically to make this safe to put on the public
internet:

- **Rate-limited sign-in** — the `/api/login` route accepts at most 10
  attempts per 15 minutes per IP address, which makes guessing a staff
  password by brute force impractical.
- **Hashed passwords** — passwords are never stored in plain text. Each one
  is hashed with Node's built-in `scrypt` (with its own random salt) before
  it touches the database.
- **HTTP security headers** — the [Helmet](https://helmetjs.github.io/)
  middleware sets standard protective headers (clickjacking protection,
  MIME-sniffing protection, a strict referrer policy, and more) on every
  response.
- **Database-backed sessions** — signed-in sessions are stored in the same
  database as everything else (a `sessions` table for SQLite, or
  `user_sessions` for Postgres) instead of in the server's memory. That
  means a server restart or redeploy no longer logs everyone out.
- **Inactivity timeout** — staff are automatically signed out after 30
  minutes with no activity (refreshing the page or clicking around counts
  as activity and resets the clock, so this only kicks in when someone
  actually walks away). Adjustable via the `INACTIVITY_TIMEOUT_MINUTES`
  environment variable if you want it shorter or longer.

One deliberate thing was *not* tightened yet: the app doesn't set a
Content-Security-Policy header, because a few pages still rely on small
inline `<script>` blocks (the light/dark theme pre-paint setter) and inline
`onerror=""` handlers on the logo images, both of which a locked-down CSP
would silently break. Moving those into the `.js` files is a reasonable
follow-up if you want to tighten this further.

## Backing up your data

Run this any time you want a safety copy of your data:
```bash
npm run backup
```

- **If you're using the default SQLite database**, this makes a consistent
  snapshot of `church.db` (safe to run even while the server is running)
  into `backups/church-<timestamp>.db`, and automatically keeps only the
  most recent 30 backups.
- **If you're using PostgreSQL** (`DATABASE_URL` is set), this shells out to
  `pg_dump` to produce `backups/church-<timestamp>.sql`. This needs the
  PostgreSQL client tools installed and on your `PATH` — if you'd rather
  not install those, most hosted Postgres providers (Neon, Supabase, Render
  Postgres) also take their own automatic backups you can restore from in
  their dashboard.

The `backups/` folder is git-ignored, same as the database itself. To back
up automatically instead of remembering to run this by hand, schedule it —
Windows Task Scheduler or `cron` locally, or your host's scheduled-job
feature if you're deployed (e.g. a Render Cron Job running
`npm run backup` daily).

## Exporting data to Excel

Click the **"Export to Excel (CSV)"** button above the directory. It
downloads a `.csv` file with every member field, which opens directly in
Excel, Google Sheets, or Numbers. If you've searched/filtered the directory
first, the export only includes the filtered results.

## Moving to a shared, external database (multiple staff/computers)

By default, data is stored in one local file (`church.db`) on whichever
computer or server runs the app. That's fine for one person testing things
out, but if you want **everyone to see the same live data** — whether they're
in the office or at home — you need a database that lives outside any one
computer. The app already supports this; you just need to point it at one.

**1. Get a free hosted PostgreSQL database.** Two easy, no-credit-card options:
   - [Neon](https://neon.tech) — generous free tier, made for exactly this
   - [Supabase](https://supabase.com) — also free, includes a nice data browser

   After creating a project, copy the **connection string** it gives you —
   it looks like:
   ```
   postgresql://user:password@host.region.provider.tech/dbname?sslmode=require
   ```

**2. Tell the app about it.**
   - **Locally:** copy `.env.example` to a new file named `.env`, and paste
     your connection string in as `DATABASE_URL=...`
   - **On Render (or another host):** add an environment variable named
     `DATABASE_URL` with that same value in your service's settings

**3. Restart the app.** On startup it prints which database it's using:
   ```
   Database: PostgreSQL (external, shared)
   ```
   That's it — no code changes. The app creates the table automatically the
   first time it connects. Every device that opens your app's link now reads
   and writes the same live data, and it's no longer tied to any one
   computer's filesystem (this also solves the earlier note about Render's
   free tier wiping local files on restart).

All database code lives in one file — **`db.js`** — so if you ever want to
customize the schema or move to a different database entirely, that's the
only file you need to touch.

## Project structure

```
church-member-app/
├── server.js                    # Express server, auth, and REST API routes
├── db.js                        # All database logic (SQLite or Postgres)
├── auth.js                      # Password hashing (scrypt) helpers
├── create-admin.js              # CLI script: creates the first staff account
├── backup.js                    # CLI script: `npm run backup`
├── package.json
├── .env.example                 # Copy to .env for local settings
├── public/
│   ├── landing.html             # Public homepage (hero, live counters, tiers)
│   ├── landing.js               # Landing counters + scripture rotator
│   ├── partner-registration.html # Public Kingdom Partnership wizard
│   ├── partner-registration.js   # Wizard steps, validation, draft saving
│   ├── login.html               # Staff sign-in screen
│   ├── login.js                 # Sign-in form logic
│   ├── app.html                 # Staff app shell (Overview, Directory, Partners, Activity Log)
│   ├── app.js                   # Staff app front-end logic
│   ├── charts.js                # The Overview tab's charts, drawn as inline SVG
│   ├── ui.js                    # Shared theme toggle, scroll reveals, counters
│   ├── style.css                # All styling, responsive, light + dark themes
│   └── logo.png                 # ← add your church logo here
└── church.db                    # Created automatically the first time you run it
```

## The Overview dashboard

The first tab staff see after signing in. It reads from `/api/stats`
(login required) and shows:

- the total number of Kingdom Partners, plus how many registered this month
- stat tiles for members, new partners, registrations awaiting review, and
  the number of distinct towns represented
- registrations per month over the last twelve months
- partners by partnership level, and the towns they come from
- a gender split and a partner-status roll-up

Each chart has a **Table** button that swaps it for the underlying numbers,
so nothing is readable only by hovering.

### Public statistics

The landing page counters come from `/api/public/stats`, the one read route
outside the login wall. It returns four aggregate totals — partners, members,
towns, and nationalities — and nothing else. No names, contact details, or
individual records are ever served publicly.

## Kingdom Partnership Registration

- **`/`** — the public landing page. Anyone visiting your link lands here first.
- **`/partner-registration.html`** — the public registration wizard. No login
  required — anyone can fill this out and submit it. It runs in five steps
  (Invitation → Your details → Partnership → Prayer → Declaration), and what
  someone has typed is kept in their own browser so they can close the page
  and come back to it. The draft is cleared as soon as they submit.
- **Partners tab** (staff, logged in) — lists every submission, searchable,
  sortable, and paginated just like the member directory. Click **Review** on
  any entry to see everything the partner submitted, plus staff-only fields:
  Partner ID, category assigned, receipt number, remarks, and partner status
  (Active/Inactive/Suspended/Upgraded/Downgraded).
- Submissions and staff edits both show up in the **Activity Log**.
- Partner data has its own **Export to Excel (CSV)** button, separate from
  the member export.
- If someone submits the form twice with the same name and phone (or same
  name and email) — for example after refreshing the page — the second
  submission is rejected with a friendly message instead of creating a
  duplicate record.

## Possible future additions

- Email or SMS notification to pastors when a new partner registers
- Household/family grouping
- Ministry or small-group tagging
- Photo uploads per member
- Search/filter improvements as the directory grows large
