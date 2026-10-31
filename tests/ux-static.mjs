// UX-01 (STATIC part only): RTL / responsive / accessibility basics of the shipped HTML shells and the rendered login screen, checked in jsdom.
// NOT a substitute for real-browser, real-device checks (see docs/DEPLOYMENT.md "UX acceptance"): no screenshots, no contrast or screen-reader testing here.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), { JSDOM } = createRequire(path.join(root, 'api', 'package.json'))('jsdom');
let bad = 0; const chk = (n, ok, d = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + d)); if (!ok) bad++; };
for (const f of fs.readdirSync(path.join(root, 'web')).filter(x => x.endsWith('.html'))) {
  const d = new JSDOM(fs.readFileSync(path.join(root, 'web', f), 'utf8')).window.document, h = d.documentElement;
  chk(`${f}: <html lang="ar" dir="rtl">`, h.getAttribute('lang') === 'ar' && h.getAttribute('dir') === 'rtl', `lang=${h.lang} dir=${h.dir}`);
  chk(`${f}: responsive viewport meta`, /width=device-width/.test(d.querySelector('meta[name=viewport]')?.content || ''));
  chk(`${f}: has <title> and charset`, !!d.title && !!d.querySelector('meta[charset]'));
  const noAlt = [...d.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')); chk(`${f}: every <img> has alt`, noAlt.length === 0, noAlt.length + ' missing');
  const unnamed = [...d.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(e => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title') || e.getAttribute('placeholder') || (e.id && d.querySelector(`label[for="${e.id}"]`)) || e.closest('label')));
  chk(`${f}: every form control has an accessible name`, unnamed.length === 0, unnamed.map(e => e.id || e.name || e.tagName).slice(0, 5).join(','));
  const btn = [...d.querySelectorAll('button')].filter(b => !(b.textContent.trim() || b.getAttribute('aria-label') || b.title)); chk(`${f}: every button has a name`, btn.length === 0, btn.length + ' unnamed');
}
const css = fs.readFileSync(path.join(root, 'web/style.css'), 'utf8');
chk('style.css: has mobile breakpoint(s)', /@media[^{]*max-width/.test(css)); chk('style.css: visible keyboard focus style', /:focus(-visible)?\s*[{,]/.test(css), 'no :focus rule');
chk('style.css: respects reduced motion', /prefers-reduced-motion/.test(css), 'no prefers-reduced-motion rule (advisory)');
chk('1.3.3 KPI cards: one dashboard-style rule (white card + coloured side bar) overrides every gradient tile', /\.kpi,\.stat\{[^}]*background:#fff !important[^}]*border-inline-start:4px solid var\(--kc\)/.test(css));
const gradTiles = fs.readdirSync(path.join(root, 'web')).filter(x => x.endsWith('.js')).flatMap(f => (fs.readFileSync(path.join(root, 'web', f), 'utf8').match(/class="(?:kpi|stat)[^"]*"[^>]*style="[^"]*gradient/g) || []).map(m => f + ': ' + m.slice(0, 60)));
chk('1.3.3 no screen paints a KPI/stat tile with an inline gradient', gradTiles.length === 0, gradTiles.join(' | '));
console.log(bad ? `\n${bad} FAILED` : '\nALL STATIC UX CHECKS PASSED'); process.exit(bad ? 1 : 0);
