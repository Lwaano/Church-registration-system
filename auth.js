// auth.js
// -----------------------------------------------------------------------
// Password hashing for staff accounts, using Node's built-in scrypt so the
// app doesn't need a native dependency like bcrypt. Each hash stores its
// own random salt as "scrypt$<saltHex>$<hashHex>", so passwords can be
// re-hashed later without touching everyone else's records.
// -----------------------------------------------------------------------

const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password), salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    if (!stored || !stored.startsWith('scrypt$')) return resolve(false);
    const [, saltHex, hashHex] = stored.split('$');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    crypto.scrypt(String(password), salt, expected.length, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.length === expected.length && crypto.timingSafeEqual(derivedKey, expected));
    });
  });
}

module.exports = { hashPassword, verifyPassword };
