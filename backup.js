// backup.js
// -----------------------------------------------------------------------
// Makes a timestamped backup copy of the database so a mistake (or a
// failed deploy) never means losing every member and partner record.
//
//   - SQLite (default, no DATABASE_URL): uses better-sqlite3's own
//     .backup() API to safely copy church.db, even while the server is
//     running, into backups/church-<timestamp>.db. Keeps the most recent
//     30 backups and deletes older ones automatically.
//   - PostgreSQL (DATABASE_URL set): shells out to `pg_dump` to produce
//     backups/church-<timestamp>.sql. Requires the Postgres client tools
//     to be installed locally; most hosted Postgres providers (Neon,
//     Supabase, Render Postgres) also take their own automatic backups,
//     so this is a belt-and-suspenders extra, not the only copy.
//
// Run it by hand with `npm run backup`, or schedule it (Windows Task
// Scheduler, cron, or your host's scheduled-job feature) to run daily.
// -----------------------------------------------------------------------

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, 'backups');
const KEEP = 30;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneOldBackups(prefix) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(prefix))
    .sort(); // ISO timestamps in the filename sort chronologically
  const excess = files.length - KEEP;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
  }
}

async function backupSqlite() {
  const Database = require('better-sqlite3');
  const source = new Database(path.join(__dirname, 'church.db'), { readonly: true });
  const dest = path.join(BACKUP_DIR, `church-${timestamp()}.db`);

  await source.backup(dest);
  source.close();

  console.log(`Backed up church.db to ${path.relative(__dirname, dest)}`);
  pruneOldBackups('church-');
}

function backupPostgres() {
  const { execFileSync } = require('child_process');
  const dest = path.join(BACKUP_DIR, `church-${timestamp()}.sql`);

  try {
    execFileSync('pg_dump', [process.env.DATABASE_URL, '-f', dest], { stdio: 'inherit' });
  } catch (err) {
    console.error('Could not run pg_dump. Make sure the PostgreSQL client tools are installed and on your PATH.');
    console.error('Your hosting provider (Neon, Supabase, Render, etc.) likely also takes automatic backups —');
    console.error('check their dashboard if you need a copy right away.');
    process.exitCode = 1;
    return;
  }

  console.log(`Backed up the Postgres database to ${path.relative(__dirname, dest)}`);
  pruneOldBackups('church-');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (process.env.DATABASE_URL) {
  backupPostgres();
} else {
  backupSqlite().catch((err) => {
    console.error('Backup failed:', err.message);
    process.exitCode = 1;
  });
}
