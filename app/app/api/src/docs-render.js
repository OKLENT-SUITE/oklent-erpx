// Markdown -> HTML for the in-app documentation. The docs are developer-authored, but the output is injected with innerHTML,
// so raw HTML is escaped and dangerous link schemes are neutralised (defence in depth against XSS).
import { Marked } from 'marked';

const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const md = new Marked({
  walkTokens(t) { if ((t.type === 'link' || t.type === 'image') && !/^(https?:|mailto:|#|\/|\.)/i.test(String(t.href || '').trim())) t.href = '#'; },
  renderer: { html(tok) { return esc(typeof tok === 'string' ? tok : tok.text ?? tok.raw); } }
});
export const renderMarkdown = src => md.parse(String(src ?? ''), { async: false });
