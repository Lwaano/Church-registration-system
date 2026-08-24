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
- **Login screen** — one shared staff password protects the rest of the app; each
  person also enters their name, which is used to credit their changes in
  the activity log
- **Overview dashboard** — the staff landing tab: headline partner count, stat
  tiles, a twelve-month registration trend, partnership-level and town
  breakdowns, a gender split, and a status roll-up. Every chart has a
  table view for reading the exact numbers.
- **Light and dark themes** — a toggle in the header, remembered per browser
- **Directory view** — searchable, sortable, paginated list of members
  (table on desktop, cards on mobile). Click a column heading to sort by it.
- **Add / Edit form** — captures name, gender, date of birth, marital status,
  phone, email, address, and member-since date
- **Activity Log** — shows who added, edited, or removed each member, most
  recent first
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

Copy `.env.example` to `.env` and set a password:
```
APP_PASSWORD=choose-a-shared-password
SESSION_SECRET=any-long-random-string
```

Then:
```bash
npm start
```

Then open **http://localhost:3000** in your browser, and sign in with your
name and the `APP_PASSWORD` you set. Share that same password with your
colleagues — each person enters their own name at login so the activity log
can tell who did what.

The first time you run it, a `church.db` file will be created automatically
in the project folder — that's your database. Back it up occasionally (it's
just one file, so you can copy it anywhere).

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
   - `APP_PASSWORD` — the shared password your staff will log in with
   - `SESSION_SECRET` — any long random string (so logins survive restarts)
6. Render will give you a URL like `https://your-church.onrender.com` —
   that's the link you share with your team. Give them the URL plus the
   `APP_PASSWORD` — they each choose their own name at login.

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

## Possible future additions

- Individual named staff accounts with per-person passwords and roles
  (admin vs. viewer), instead of one shared password
- Household/family grouping
- Ministry or small-group tagging
- Photo uploads per member
