// Idempotency for financial / public write requests (T-07). Header: Idempotency-Key (8-100 chars of A-Z a-z 0-9 . _ : -).
// - first request with a key: runs fn(), stores its response;  - retry with the same key+payload: returns the stored response (header Idempotent-Replayed: true);
// - same key + different payload: 422;  - same key while the first request is still running: 409 + Retry-After;  - a FAILED request frees its key so the client may retry.
// A row stuck "in_progress" for more than STALE_MS (crashed process) is taken over. Keys expire after 7 days.
import { createHash } from 'node:crypto';
const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/, STALE_MS = 60_000;

export async function idempotent({ q, httpErr, req, reply, scope, fn }) {
  const key = req.headers['idempotency-key'];
  if (key === undefined) return fn();
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw httpErr(400, 'Idempotency-Key must be 8-100 characters: letters, digits, . _ : -');
  const sc = `${scope}|${req.user?.username || req.ip}`;
  const hash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
  q('DELETE FROM idempotency_keys WHERE created_at < now() - interval \'7 days\' AND ctid IN (SELECT ctid FROM idempotency_keys WHERE created_at < now() - interval \'7 days\' LIMIT 200)').catch(() => {});
  const ins = await q('INSERT INTO idempotency_keys(scope,key,request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key', [sc, key, hash]);
  if (!ins.rowCount) {
    const { rows: [r] } = await q('SELECT request_hash, status, response_code, response, (now() - created_at) > make_interval(secs => $3) AS stale FROM idempotency_keys WHERE scope=$1 AND key=$2', [sc, key, STALE_MS / 1000]);
    if (!r) return idempotent({ q, httpErr, req, reply, scope, fn });                 // the first request failed and freed the key a moment ago: try as the first
    if (r.request_hash !== hash) throw httpErr(422, 'ERPX-I010: this Idempotency-Key was already used with a different request');
    if (r.status === 'done') { reply.header('Idempotent-Replayed', 'true'); if (r.response_code && r.response_code !== 200) reply.code(r.response_code); return r.response; }
    if (!r.stale) { reply.header('Retry-After', '1'); throw httpErr(409, 'the same request is still being processed'); }
    await q('UPDATE idempotency_keys SET created_at = now() WHERE scope=$1 AND key=$2 AND status=\'in_progress\'', [sc, key]);   // take over a dead attempt
  }
  try {
    const out = await fn();
    await q('UPDATE idempotency_keys SET status=\'done\', response_code=200, response=$3::jsonb WHERE scope=$1 AND key=$2', [sc, key, JSON.stringify(out ?? null)]);
    return out;
  } catch (e) { await q('DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2 AND status=\'in_progress\'', [sc, key]).catch(() => {}); throw e; }
}
