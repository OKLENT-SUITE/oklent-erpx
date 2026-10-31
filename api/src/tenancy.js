// Tenant context + registry (runtime). https://oklent.net/
// MULTI_TENANT=1 turns the feature on. Off (default) = the classic single-company behaviour, byte-for-byte: every query runs on schema "public".
import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage();
export const isMultiTenant = (env = process.env) => /^(1|true|yes)$/i.test(String(env.MULTI_TENANT || ''));
export const currentTenant = () => als.getStore()?.tenant || null;
/** Run fn with a tenant (a registry row) as the ambient context: every q()/tx() inside it targets that tenant's schema. */
export const withTenant = (tenant, fn) => als.run({ tenant }, fn);

const BASE_DOMAIN = () => String(process.env.TENANT_BASE_DOMAIN || '').toLowerCase().replace(/^\./, '');
const hostOnly = h => String(h || '').toLowerCase().split(':')[0].replace(/\.$/, '');

/** Pure: which slug does this Host header name? 'acme.erp.example.com' with base 'erp.example.com' -> 'acme'. null when it is the base itself / another domain. */
export function slugFromHost(host, base = BASE_DOMAIN()) {
  const h = hostOnly(host); if (!base || !h.endsWith('.' + base)) return null;
  const sub = h.slice(0, -(base.length + 1));
  return /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(sub) ? sub : null;     // one label only: a.b.base is refused
}

/** In-memory copy of platform.tenants, refreshed at most every TTL ms (so a suspension reaches every request within ~15 s). */
export function tenantRegistry({ load, ttlMs = Number(process.env.TENANT_CACHE_TTL_MS || 15000), now = () => Date.now() }) {
  let bySlug = new Map(), byId = new Map(), byDomain = new Map(), def = null, at = null, pending = null;
  const refresh = async () => {
    const rows = await load(); const s = new Map(), i = new Map(), d = new Map(); let df = null;
    for (const r of rows) { s.set(r.slug, r); i.set(r.id, r); if (r.custom_domain) d.set(r.custom_domain.toLowerCase(), r); if (r.is_default) df = r; }
    bySlug = s; byId = i; byDomain = d; def = df; at = now();
  };
  const fresh = async () => { if (at !== null && now() - at < ttlMs) return; pending ||= refresh().finally(() => { pending = null; }); await pending; };
  return {
    async bySlug(slug) { await fresh(); return bySlug.get(slug) || null; },
    async byId(id) { await fresh(); return byId.get(Number(id)) || null; },
    async byDomain(host) { await fresh(); return byDomain.get(hostOnly(host)) || null; },
    async defaultTenant() { await fresh(); return def; },
    async active() { await fresh(); return [...byId.values()].filter(t => t.status === 'active'); },
    async all() { await fresh(); return [...byId.values()]; },
    invalidate() { at = null; }
  };
}

/**
 * Pure resolution of the tenant a NOT-yet-authenticated request talks to (login, public storefront, public booking).
 * Order: custom domain -> sub-domain -> X-Tenant header -> explicit body value -> default tenant (unless TENANT_REQUIRE_EXPLICIT=1).
 * A signed-in request NEVER uses this: its tenant comes from the verified token (see server.js auth()).
 */
export async function resolveCandidate(reg, { host, header, body }, env = process.env) {
  const dom = await reg.byDomain(host); if (dom) return dom;
  const sub = slugFromHost(host, String(env.TENANT_BASE_DOMAIN || '').toLowerCase().replace(/^\./, ''));
  const slug = sub || (typeof header === 'string' && header) || (typeof body === 'string' && body) || null;
  if (slug) return reg.bySlug(String(slug).toLowerCase().slice(0, 40));
  if (/^(1|true|yes)$/i.test(String(env.TENANT_REQUIRE_EXPLICIT || ''))) return null;
  return reg.defaultTenant();
}

/** Throws a 4xx-style error when the tenant may not be used. */
export function assertUsable(t) {
  const e = (code, msg) => Object.assign(new Error(msg), { statusCode: code });
  if (!t) throw e(404, 'unknown company');
  if (t.status === 'suspended') throw e(403, 'this company account is suspended');
  if (t.status !== 'active') throw e(403, 'this company account is not active');
  return t;
}
