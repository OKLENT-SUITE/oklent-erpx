// Two-factor authentication: TOTP (RFC 6238 over RFC 4226), no dependencies. https://oklent.net/
// Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password ... (SHA-1, 6 digits, 30 s: the universal profile).
import { createHmac, createHash, randomBytes, createCipheriv, createDecipheriv, hkdfSync, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const s = String(str).toUpperCase().replace(/[\s=-]/g, ''); let bits = 0, val = 0; const out = [];
  for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) throw new Error('invalid base32'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export const newSecret = (bytes = 20) => base32Encode(randomBytes(bytes));   // 160-bit secret, as recommended by RFC 4226

/** RFC 4226 HOTP. algo: sha1 (default) | sha256 | sha512. */
export function hotp(secretB32, counter, { digits = 6, algo = 'sha1' } = {}) {
  const key = base32Decode(secretB32); const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, key).update(msg).digest(); const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (nowMs = Date.now(), period = 30) => Math.floor(nowMs / 1000 / period);
export const totp = (secretB32, nowMs = Date.now(), opts = {}) => hotp(secretB32, stepOf(nowMs, opts.period || 30), opts);

const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Verifies a user-typed code. Accepts the current step +/- `window` (clock drift) and REFUSES any step <= lastStep (a code works once: replay protection).
 * Returns the matched step (store it as the new last step) or null.
 */
export function verifyTotp(secretB32, code, { nowMs = Date.now(), window = 1, lastStep = null, period = 30, digits = 6 } = {}) {
  const c = String(code || '').replace(/\s/g, ''); if (!new RegExp(`^\\d{${digits}}$`).test(c)) return null;
  const now = stepOf(nowMs, period); let hit = null;
  for (let d = -window; d <= window; d++) { const st = now + d; if (st < 0) continue; if (eq(hotp(secretB32, st, { digits }), c) && hit === null) hit = st; }   // loop never short-circuits: constant work
  if (hit === null) return null;
  if (lastStep !== null && lastStep !== undefined && hit <= Number(lastStep)) return null;
  return hit;
}

export function otpauthUri({ secret, account, issuer = 'OKLENT BUSINESS' }) {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---- recovery codes: 10 single-use codes, shown once, stored only as SHA-256 hashes ----
export function newRecoveryCodes(n = 10) {
  const plain = Array.from({ length: n }, () => { const s = base32Encode(randomBytes(7)).slice(0, 10); return s.slice(0, 5) + '-' + s.slice(5); });
  return { plain, hashes: plain.map(hashRecovery) };
}
export const normRecovery = c => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
export const hashRecovery = c => createHash('sha256').update('erpx-recovery:' + normRecovery(c)).digest('hex');
export const looksLikeRecovery = c => normRecovery(c).length === 10 && !/^\d{6}$/.test(String(c).replace(/\s/g, ''));

// ---- secret at rest: AES-256-GCM, key derived (HKDF) from TOTP_ENC_KEY or, failing that, JWT_SECRET. The database alone never reveals a secret. ----
function key(env) {
  const base = env.TOTP_ENC_KEY || env.JWT_SECRET; if (!base) throw new Error('TOTP_ENC_KEY or JWT_SECRET is required');
  return Buffer.from(hkdfSync('sha256', Buffer.from(base), Buffer.from('erpx-totp-salt'), Buffer.from('erpx-totp-secret-v1'), 32));
}
export function sealSecret(secretB32, env = process.env) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key(env), iv);
  const ct = Buffer.concat([c.update(secretB32, 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function openSecret(sealed, env = process.env) {
  if (!String(sealed).startsWith('v1.')) throw new Error('unknown secret format');
  const raw = Buffer.from(String(sealed).slice(3), 'base64'); const d = createDecipheriv('aes-256-gcm', key(env), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
