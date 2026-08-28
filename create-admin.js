// create-admin.js
// -----------------------------------------------------------------------
// Staff now sign in with their own username and password instead of one
// shared password, so there needs to be a way to create the very first
// account. Run this once from the server's terminal:
//
//   node create-admin.js
//
// It asks for a full name, username, and password, then creates an admin
// account who can sign in and create everyone else's accounts from the
// "Staff" tab in the app. Safe to run again later to create another admin
// (e.g. a second person who should be able to manage staff accounts).
// -----------------------------------------------------------------------

require('dotenv').config();

const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const db = require('./db');
const { hashPassword } = require('./auth');

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log('Create a staff admin account\n');

  const full_name = (await rl.question('Full name: ')).trim();
  const username = (await rl.question('Username: ')).trim();
  const password = await rl.question('Password (min 8 characters): ');

  rl.close();

  if (!full_name || !username || !password || password.length < 8) {
    console.error('\nFull name, username, and an 8+ character password are all required. Nothing was created.');
    process.exitCode = 1;
    return;
  }

  const existing = await db.getUserByUsername(username);
  if (existing) {
    console.error(`\nA user named "${username}" already exists. Nothing was created.`);
    process.exitCode = 1;
    return;
  }

  await db.createUser({
    full_name,
    username,
    password_hash: await hashPassword(password),
    role: 'admin',
  });

  console.log(`\nAdmin account "${username}" created. You can now sign in at /login.html.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
