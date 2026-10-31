// Product-image storage helpers (no dependencies, no database). https://oklent.net/
// Security model: the file TYPE is decided from the file's own bytes (magic numbers), never from its name or the browser's Content-Type;
// SVG/GIF/HTML are refused (SVG can carry script); the stored name is a random UUID (the client never chooses a path);
// only /uploads/products/<uuid>.<jpg|png|webp> is ever read or deleted, so a crafted image_url can never point deletion at another file.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;                       // 2 MB
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const UPLOAD_URL_PREFIX = '/uploads/products/';
const OWN = /^\/uploads\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const uploadRoot = root => process.env.UPLOAD_DIR || path.join(root, 'uploads');

/** Returns { ext, mime } from the file signature, or null when it is not a JPEG / PNG / WebP. */
export function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Validates size + signature + (when given) that the declared Content-Type agrees with the bytes. Throws Error with .statusCode. */
export function validateImage(buf, declaredMime) {
  const e = (code, msg) => Object.assign(new Error(msg), { statusCode: code });
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw e(400, 'لم يصل ملف الصورة');
  if (buf.length > MAX_IMAGE_BYTES) throw e(413, 'حجم الصورة يتجاوز 2 ميجابايت');
  const t = detectImage(buf); if (!t) throw e(415, 'نوع الملف غير مدعوم: المسموح JPG أو PNG أو WebP فقط');
  if (declaredMime && declaredMime.split(';')[0].trim().toLowerCase() !== t.mime) throw e(415, 'نوع الملف لا يطابق محتواه');
  return t;
}

// Multi-tenant: files live under <dir>/t/<tenant-slug>/products/ and are only ever deleted by the tenant whose slug is in the URL.
// scope = null keeps the single-company layout exactly as before.
const SLUG = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const scopedRe = scope => new RegExp('^/uploads/t/' + scope + '/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$');
export const isOwnUpload = (url, scope = null) => typeof url === 'string' && (scope ? SLUG.test(scope) && scopedRe(scope).test(url) : OWN.test(url));

/** Writes the image under <dir>/products/<uuid>.<ext> (flag wx: never overwrites) and returns the public path stored in products.image_url. */
export async function saveProductImage(buf, dir, scope = null) {
  if (scope && !SLUG.test(scope)) throw Object.assign(new Error('invalid tenant scope'), { statusCode: 500 });
  const t = validateImage(buf); const name = `${randomUUID()}.${t.ext}`;
  const sub = scope ? path.join('t', scope, 'products') : 'products';
  await mkdir(path.join(dir, sub), { recursive: true });
  await writeFile(path.join(dir, sub, name), buf, { flag: 'wx', mode: 0o644 });
  return (scope ? `/uploads/t/${scope}/products/` : UPLOAD_URL_PREFIX) + name;
}

/** Deletes a file this module created. Anything else (external URLs, other paths) is ignored. Never throws. */
export async function removeUpload(url, dir, scope = null) {
  if (!isOwnUpload(url, scope)) return false;
  try { await unlink(path.join(dir, ...(scope ? ['t', scope, 'products'] : ['products']), path.basename(url))); return true; } catch { return false; }
}
