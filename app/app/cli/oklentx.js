#!/usr/bin/env node
// OKLENT BUSINESS CLI — talks to the REST API. https://oklent.net/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
const CFG = path.join(os.homedir(), '.oklentx.json');
const cfg = JSON.parse(await readFile(CFG, 'utf8').catch(() => '{}'));
const API = process.env.ERPX_API || cfg.api || 'http://localhost:3100';
const [cmd, ...rest] = process.argv.slice(2);
const opt = n => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : undefined; };
const today = new Date().toISOString().slice(0, 10);
async function call(m, p, body) {
  const r = await fetch(API + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(cfg.token && { authorization: 'Bearer ' + cfg.token }) }, body: m === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { console.error(`✗ ${r.status} ${j.error || ''}`); process.exit(1); } return j;
}
const money = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }).padStart(14);
const HELP = `OKLENT BUSINESS CLI (v1.4.9) — إدارة الأعمال والمحرك المحاسبي
oklentx <command>
  login --user admin --password ***      accounts                         periods
  tb [--from D --to D]                   is [--from D --to D]             bs [--to D]
  gl --account 1121 [--from D --to D]    vat [--from D --to D]            aging
  post --file entry.json                 reverse <entry_id> [--date D]    entry <id>
  close <period_id>                      reopen <period_id> --reason "…"  lock <period_id>   year-close <year>
  verify                                 rules                            try <lab_case>
  invoices                               pay <invoice_id> --amount N [--account 1121]
Env: ERPX_API (default ${API})`;
const out = {
  async login() { const r = await call('POST', '/auth/login', { username: opt('user'), password: opt('password') }); await writeFile(CFG, JSON.stringify({ api: API, token: r.token }), { mode: 0o600 }); console.log('✓ logged in as', r.user.username, `(${r.user.role})`); },
  async accounts() { for (const a of await call('GET', '/accounts')) console.log(a.code.padEnd(6), a.is_postable ? ' ' : '▸', a.name_ar, '|', a.name_en); },
  async periods() { for (const p of await call('GET', '/periods')) console.log(String(p.id).padStart(3), p.name, p.status); },
  async tb() { const r = await call('GET', `/reports/trial-balance?from=${opt('from') || today.slice(0, 4) + '-01-01'}&to=${opt('to') || today}`); let d = 0, c = 0;
    for (const x of r) { d += +x.closing_debit; c += +x.closing_credit; console.log(x.code.padEnd(6), x.name_en.padEnd(36), money(x.closing_debit), money(x.closing_credit)); } console.log('TOTAL'.padEnd(43), money(d), money(c), d === c ? '✓ balanced' : '✗'); },
  async is() { const r = await call('GET', `/reports/income-statement?from=${opt('from') || today.slice(0, 4) + '-01-01'}&to=${opt('to') || today}`); let n = 0;
    for (const x of r) { n += x.type === 'revenue' ? +x.amount : -x.amount; console.log(x.code.padEnd(6), x.name_en.padEnd(36), money(x.amount)); } console.log('NET PROFIT'.padEnd(43), money(n)); },
  async bs() { const r = await call('GET', `/reports/balance-sheet?to=${opt('to') || today}`); let a = 0, le = 0;
    for (const x of r) { x.section === 'asset' ? a += +x.amount : le += +x.amount; console.log(x.section.padEnd(10), x.code.padEnd(6), x.name_en.padEnd(34), money(x.amount)); } console.log('Assets', money(a), '| L+E', money(le), a === le ? '✓' : '✗'); },
  async gl() { for (const x of await call('GET', `/reports/general-ledger?account=${opt('account')}&from=${opt('from') || today.slice(0, 4) + '-01-01'}&to=${opt('to') || today}`)) console.log(x.entry_date, x.entry_no.padEnd(16), money(x.debit), money(x.credit), money(x.balance), x.memo); },
  async vat() { for (const x of await call('GET', `/reports/vat-return?from=${opt('from') || today.slice(0, 4) + '-01-01'}&to=${opt('to') || today}`)) console.log(String(x.box).padEnd(3), x.label_en.padEnd(42), money(x.net), money(x.vat)); },
  async aging() { for (const x of await call('GET', '/reports/ar-aging')) console.log(x.partner.padEnd(28), x.invoice_no.padEnd(16), x.due_date, money(x.outstanding), x.bucket); },
  async post() { const e = JSON.parse(await readFile(opt('file'), 'utf8')); console.log('✓ entry id', (await call('POST', '/journal', e)).id); },
  async entry() { const e = await call('GET', '/journal/' + rest[0]); console.log(e.entry_no, e.entry_date, e.memo, '\n hash', e.row_hash, '\n prev', e.prev_hash); for (const l of e.lines) console.log(' ', l.code.padEnd(6), money(l.debit), money(l.credit), l.currency_code); },
  async reverse() { console.log('✓ reversal entry', (await call('POST', `/journal/${rest[0]}/reverse`, { date: opt('date') || today })).id); },
  async close() { await call('POST', `/periods/${rest[0]}/close`); console.log('✓ closed'); },
  async reopen() { await call('POST', `/periods/${rest[0]}/reopen`, { reason: opt('reason') }); console.log('✓ reopened (audited)'); },
  async lock() { await call('POST', `/periods/${rest[0]}/lock`); console.log('✓ locked permanently'); },
  async 'year-close'() { console.log('✓ closing entry', (await call('POST', `/year-close/${rest[0]}`)).entry_id); },
  async verify() { const r = await call('GET', '/reports/chain-verify'); console.log(r.ok ? `✓ hash chain intact (${r.entries} entries)` : `✗ chain broken at ${r.first_bad_entry}`); process.exit(r.ok ? 0 : 2); },
  async rules() { const r = await call('GET', '/rules'); for (const x of r.rules) console.log(x.id.padEnd(4), x.en.padEnd(40), 'lab:', x.lab.join(',') || '-'); },
  async try() { const r = await call('POST', '/rules/try/' + rest[0]); console.log(r.blocked ? '✓ BLOCKED by PostgreSQL' : '✗ ACCEPTED', '\n', r.statement, '\n →', r.message); },
  async invoices() { for (const x of await call('GET', '/invoices')) console.log(x.number.padEnd(16), x.kind.padEnd(10), money(x.total), 'ICV', x.icv, x.partner || ''); },
  async pay() { console.log('✓ receipt entry', (await call('POST', `/invoices/${rest[0]}/payments`, { amount: opt('amount'), cash_account: opt('account') || '1121' })).entry_id); }
};
if (!out[cmd]) { console.log(HELP); process.exit(cmd ? 1 : 0); }
await out[cmd]();

