// Menu catalogue = web/nav.json (single source of truth, also served to the browser).
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadMenuCatalog(root) {
  const nav = JSON.parse(readFileSync(path.join(root, 'web', 'nav.json'), 'utf8'));
  const ids = new Set(); const parentsOf = new Map();           // item -> [section id, main id]
  for (const m of nav.mains) { ids.add('main:' + m.id);
    for (const s of m.secs) { ids.add('sec:' + s.id); for (const k of s.kids) { ids.add(k[0]); parentsOf.set(k[0], ['sec:' + s.id, 'main:' + m.id]); } } }
  const locked = new Set();                                      // protected items + their parents can never be hidden (no lock-out)
  for (const p of nav.protected) { locked.add(p); for (const x of parentsOf.get(p) || []) locked.add(x); }
  return { nav, ids, locked, defaultDisabled: nav.defaultDisabled };
}
