// Minimal XML parser + Canonical XML (inclusive C14N; identical to 1.1 for documents without xml:base/xml:id) — no dependencies.
// Scope: the UBL invoices this app generates and ZATCA-signed invoices (no DTD, no comments needed in the canonical form).
import { createHash } from 'node:crypto';
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? (() => { throw new Error('unknown entity &' + e + ';'); })()));

export function parseXml(xml) {
  let i = 0; const n = xml.length; const stack = []; let root = null;
  const err = m => { throw new Error(`XML parse error at ${i}: ${m}`); };
  const add = c => { if (stack.length) stack[stack.length - 1].children.push(c); else if (typeof c !== 'string') root = c; else if (c.trim()) err('text outside the root element'); };
  while (i < n) {
    if (xml[i] !== '<') { const j = xml.indexOf('<', i); const t = xml.slice(i, j < 0 ? n : j); add(decode(t)); i = j < 0 ? n : j; continue; }
    if (xml.startsWith('<?', i)) { const j = xml.indexOf('?>', i); if (j < 0) err('unterminated PI'); i = j + 2; continue; }
    if (xml.startsWith('<!--', i)) { const j = xml.indexOf('-->', i); if (j < 0) err('unterminated comment'); i = j + 3; continue; }
    if (xml.startsWith('<![CDATA[', i)) { const j = xml.indexOf(']]>', i); if (j < 0) err('unterminated CDATA'); add(xml.slice(i + 9, j)); i = j + 3; continue; }
    if (xml.startsWith('<!', i)) err('DOCTYPE / DTD is not allowed');
    if (xml.startsWith('</', i)) { const j = xml.indexOf('>', i); const name = xml.slice(i + 2, j).trim(); const top = stack.pop(); if (!top || top.name !== name) err('mismatched </' + name + '>'); i = j + 1; continue; }
    const m = /^<([^\s/>]+)/.exec(xml.slice(i, i + 300)); if (!m) err('bad tag'); i += m[0].length;
    const el = { name: m[1], attrs: [], children: [] };
    for (;;) {
      while (/\s/.test(xml[i])) i++;
      if (xml[i] === '>') { i++; add(el); stack.push(el); break; }
      if (xml.startsWith('/>', i)) { i += 2; add(el); break; }
      const a = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(xml.slice(i, i + 4000)); if (!a) err('bad attribute');
      el.attrs.push({ name: a[1], value: decode(a[3] ?? a[4]) }); i += a[0].length;
    }
  }
  if (stack.length) err('unclosed <' + stack[stack.length - 1].name + '>'); if (!root) err('no root element');
  return root;
}
const nsOf = (el, inherited) => { const m = new Map(inherited); for (const a of el.attrs) { if (a.name === 'xmlns') m.set('', a.value); else if (a.name.startsWith('xmlns:')) m.set(a.name.slice(6), a.value); } return m; };
const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');

/** Canonical form of an element (and its subtree) as a string. `inherit` = namespaces in scope from outside the subtree. */
export function canonicalize(el, inherit = new Map(), rendered = new Map()) {
  const scope = nsOf(el, inherit); const rend = new Map(rendered);
  let out = '<' + el.name; const decl = [];
  for (const a of el.attrs) if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) decl.push([a.name === 'xmlns' ? '' : a.name.slice(6), a.value]);
  // inclusive C14N also renders namespaces that are in scope but not yet rendered (needed when canonicalizing a detached subtree)
  for (const [p, u] of scope) if (!decl.some(d => d[0] === p) && rend.get(p) !== u && !(p === '' && u === '' && !rend.has(''))) decl.push([p, u]);
  decl.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [p, u] of decl) { if (rend.get(p) === u || (p === '' && u === '' && !rend.get(''))) continue; out += p ? ` xmlns:${p}="${escAttr(u)}"` : ` xmlns="${escAttr(u)}"`; rend.set(p, u); }
  const uri = a => { const c = a.name.indexOf(':'); return c < 0 ? '' : (scope.get(a.name.slice(0, c)) || ''); };
  const loc = a => a.name.slice(a.name.indexOf(':') + 1);
  const attrs = el.attrs.filter(a => a.name !== 'xmlns' && !a.name.startsWith('xmlns:')).sort((a, b) => { const ua = uri(a), ub = uri(b); return ua < ub ? -1 : ua > ub ? 1 : loc(a) < loc(b) ? -1 : loc(a) > loc(b) ? 1 : 0; });
  for (const a of attrs) out += ` ${a.name}="${escAttr(a.value)}"`;
  out += '>';
  for (const c of el.children) out += typeof c === 'string' ? escText(c) : canonicalize(c, scope, rend);
  return out + '</' + el.name + '>';
}
export const sha256b64 = s => createHash('sha256').update(s, 'utf8').digest('base64');
export const sha256hex = s => createHash('sha256').update(s, 'utf8').digest('hex');

const childOf = (el, name) => el.children.find(c => typeof c !== 'string' && c.name === name);
/** Removes what ZATCA excludes from the invoice hash: ext:UBLExtensions, cac:Signature and the cac:AdditionalDocumentReference whose cbc:ID is QR. Returns a NEW tree. */
export function withoutSignatureParts(root) {
  const keep = c => {
    if (typeof c === 'string') return true;
    if (c.name === 'ext:UBLExtensions' || c.name === 'cac:Signature') return false;
    if (c.name === 'cac:AdditionalDocumentReference') { const id = childOf(c, 'cbc:ID'); if (id && id.children.join('').trim() === 'QR') return false; }
    return true;
  };
  return { ...root, children: root.children.filter(keep) };
}
/** Invoice hash as ZATCA defines it: SHA-256 of the canonical form of the invoice WITHOUT the signature parts, base64. */
export function invoiceHash(xml) {
  const r = withoutSignatureParts(parseXml(xml)); return sha256b64(canonicalize(r).replace(/^\uFEFF/, ''));
}
