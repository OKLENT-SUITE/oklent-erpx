import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { aiConfig } from './policies.js';

const formatNumber = (value, options = {}) => Number(value).toLocaleString('en-US', { useGrouping: false, ...options });

const SOURCES = [
  ['README.md', 'README.md'],
  ['docs/FAQ.md', 'docs/FAQ.md'],
  ['docs/SOP.md', 'docs/SOP.md'],
  ['docs/COMMERCE.md', 'docs/COMMERCE.md'],
  ['docs/ZATCA.md', 'docs/ZATCA.md']
];
const cleanDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const terms = value => (String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(x => !['من','في','على','عن','ما','هل','كيف','this','that','with','from','the','and'].includes(x));
const normalizeIntent = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي');
const REPORT_INTENTS = {
  invoices:['فاتوره','فواتير','تحصيل','متحصل','مستحق','invoice'], inventory:['مخزون','مخازن','صنف','اصناف','بضاعه','inventory','stock'],
  fleet:['اسطول','مركبه','مركبات','رحله','رحلات','وقود','صيانه','fleet'], 'receivables-aging':['اعمار','ذمم','متاخر','تاخير','مديون','aging'],
  'balance-sheet':['مركز مالي','اصول','خصوم','حقوق الملكيه','balance sheet'], 'vat-return':['ضريبه','ضريبي','زكاه','اقرار','vat'],
  'trial-balance':['ميزان','مدين','دائن','trial balance'], 'income-statement':['قائمه الدخل','دخل','ربح','خساره','income statement'],
  monthly:['ايراد','ايرادات','مصروف','مصروفات','شهري','مبيعات','monthly']
};
function inferReportType(question) {
  const q=normalizeIntent(question), ranked=Object.entries(REPORT_INTENTS).map(([type,words])=>({type,score:words.reduce((n,w)=>n+(q.includes(normalizeIntent(w))?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return !ranked.length||ranked.length>1&&ranked[0].score===ranked[1].score ? null : ranked[0].type;
}
async function loadKnowledge(root) {
  const out = [];
  for (const [label, rel] of SOURCES) {
    let content; try { content = await readFile(path.join(root, rel), 'utf8'); } catch { continue; }
    let section = label;
    for (const block of content.split(/\n(?=#{1,4}\s)/)) {
      const heading = block.match(/^#{1,4}\s+(.+)/m);
      if (heading) section = `${label} — ${heading[1].trim()}`;
      const paragraphs = block.replace(/^#{1,4}\s+.+$/m, '').split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      let current = '';
      for (const para of paragraphs) {
        if ((current + ' ' + para).length > 1500 && current) { out.push({ source: section, text: current }); current = ''; }
        current = current ? `${current}\n${para}` : para;
      }
      if (current) out.push({ source: section, text: current });
    }
  }
  return out;
}

export async function createAIService({ root, q, tx, env = process.env, rules }) {
  const knowledge = await loadKnowledge(root);
  const config = aiConfig(env);
  const rate = new Map();
  function rateCheck(user, feature, ip) {
    const now = Date.now();
    for (const key of [`user:${user.id}:${feature}`, `ip:${ip || 'unknown'}:${feature}`]) {
      const recent = (rate.get(key) || []).filter(t => now - t < 60_000);
      if (recent.length >= config.requestsPerMinute) throw Object.assign(new Error('طلبات متكررة؛ حاول بعد دقيقة'), { statusCode:429, code:'AI_RATE_LIMIT' });
      recent.push(now); rate.set(key,recent);
    }
  }

  function search(query) {
    const qTerms = [...new Set(terms(query))];
    if (!qTerms.length) return [];
    return knowledge.map(d => {
      const hay = terms(d.text);
      const hits = qTerms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { ...d, score: hits / Math.sqrt(Math.max(hay.length, 1)) };
    }).filter(d => d.score > 0).sort((a,b)=>b.score-a.score).slice(0,5);
  }

  async function buildContext(body) {
    if (body.feature === 'documents') {
      const hits = search(body.question);
      if (!hits.length) return { grounded: false, text: 'لم أعثر على مقطع مناسب في مستندات المساعدة المعتمدة.', sources: [] };
      return { grounded: true, text: hits.map((h,i)=>`[S${i+1}] ${h.source}\n${h.text}`).join('\n\n'), sources: hits.map((h,i)=>({ id:`S${i+1}`, name:h.source })) };
    }
    if (body.feature === 'rule') {
      const rule = rules.find(r => r.id === body.rule_id);
      if (!rule) return { grounded: false, text: 'رمز القاعدة غير موجود في كتالوج التطبيق.', sources: [] };
      const safe = { id: rule.id, name: rule.ar, explanation: rule.why_ar };
      return { grounded: true, text: JSON.stringify(safe), sources: [{ id: rule.id, name: `كتالوج القواعد — ${rule.id}` }] };
    }
    if (body.feature === 'invoice') {
      const { rows: [r] } = await q(`SELECT i.number,i.kind,(i.issue_at AT TIME ZONE 'Asia/Riyadh')::date::text issue_date,i.due_date,i.subtotal,i.vat_amount,i.total,
        CASE WHEN i.kind='credit' THEN NULL ELSE fn_invoice_outstanding(i.id) END outstanding
        FROM invoices i WHERE i.number=$1`, [body.invoice_number.trim()]);
      if (!r) return { grounded: false, text: 'لم يعثر النظام على فاتورة بهذا الرقم ضمن ما يتيحه حسابك.', sources: [] };
      const summary = { number:r.number, kind:r.kind, issue_date:r.issue_date, due_date:r.due_date, subtotal:r.subtotal, vat:r.vat_amount, total:r.total, outstanding:r.outstanding };
      return { grounded: true, text: JSON.stringify(summary), visualization:{title:'ملخص الفاتورة',kind:'metrics',metrics:[['الإجمالي',`${formatNumber(r.total,{minimumFractionDigits:2})} ر.س`],['الصافي',`${formatNumber(r.subtotal,{minimumFractionDigits:2})} ر.س`],['الضريبة',`${formatNumber(r.vat_amount,{minimumFractionDigits:2})} ر.س`],['المتبقي',r.outstanding===null?'غير منطبق':`${formatNumber(r.outstanding,{minimumFractionDigits:2})} ر.س`]]}, sources: [{ id: r.number, name: `بيانات الفاتورة ${r.number} من النظام` }] };
    }
    if (!cleanDate(body.from) || !cleanDate(body.to) || body.from > body.to) throw Object.assign(new Error('التاريخ غير صالح'), { statusCode: 400, code: 'AI_BAD_DATE' });
    const days = (Date.parse(body.to + 'T00:00:00Z') - Date.parse(body.from + 'T00:00:00Z')) / 86400000;
    if (days > 366) throw Object.assign(new Error('الفترة القصوى للتلخيص 366 يوماً'), { statusCode: 400, code: 'AI_DATE_RANGE' });
    const reportType=body.report_type==='auto'?inferReportType(body.question):body.report_type;
    if (!reportType) return { grounded:false,text:'لم يتضح نوع البيانات من السؤال. اذكر التقرير المطلوب أو اختره من القائمة: الفواتير والتحصيل، المخزون، الأسطول، أعمار الذمم، المركز المالي، الإقرار الضريبي، ميزان المراجعة، قائمة الدخل، الإيرادات والمصروفات.',sources:[] };
    let data, label;
    if (reportType === 'monthly') {
      data = (await q(`SELECT to_char(date_trunc('month',je.entry_date),'YYYY-MM') month,
        coalesce(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0) revenue,
        coalesce(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0) expense
        FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
        WHERE a.type IN ('revenue','expense') AND je.source_type<>'year_close' AND je.entry_date BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1`, [body.from,body.to])).rows;
      label = 'ملخص الإيرادات والمصروفات الشهري';
    } else if (reportType === 'invoices') {
      const { rows:[r] } = await q(`SELECT count(*)::int invoice_count,
        coalesce(sum(i.total),0) total_amount,coalesce(sum(fn_invoice_outstanding(i.id)),0) outstanding_amount,
        count(*) FILTER (WHERE fn_invoice_outstanding(i.id)>0)::int unpaid_count
        FROM invoices i WHERE i.kind<>'credit' AND (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2`, [body.from,body.to]);
      data=r; label='ملخص الفواتير والمبالغ غير المحصلة';
    } else if (reportType === 'inventory') {
      const { rows:[r] } = await q(`SELECT count(*)::int tracked_products,
        coalesce(sum(coalesce(c.qty,0)),0) on_hand,
        coalesce(sum(greatest(coalesce(c.qty,0),0)*coalesce(c.avg_cost,p.cost_price)),0) stock_value,
        count(*) FILTER (WHERE coalesce(c.qty,0)<=0)::int out_of_stock
        FROM products p LEFT JOIN product_costing c ON c.product_id=p.id WHERE p.stock_tracked`, []);
      data=r; label='ملخص أرصدة المخزون وتكلفته';
    } else if (reportType === 'fleet') {
      const { rows:[r] } = await q(`SELECT
        (SELECT count(*)::int FROM fleet_vehicles WHERE status<>'sold') vehicle_count,
        (SELECT count(*)::int FROM fleet_trips WHERE trip_date BETWEEN $1 AND $2 AND status<>'cancelled') trip_count,
        (SELECT coalesce(sum(liters),0) FROM fleet_fuel WHERE fuel_date BETWEEN $1 AND $2) fuel_liters,
        (SELECT coalesce(sum(total_amount),0) FROM fleet_fuel WHERE fuel_date BETWEEN $1 AND $2) fuel_cost,
        (SELECT coalesce(sum(cost),0) FROM fleet_maintenance WHERE maintenance_date BETWEEN $1 AND $2) maintenance_cost`, [body.from,body.to]);
      data=r; label='ملخص الأسطول والرحلات والوقود والصيانة';
    } else if (reportType === 'receivables-aging') {
      data=(await q(`SELECT bucket,count(*)::int invoice_count,coalesce(sum(outstanding),0) outstanding
        FROM fn_ar_aging($1) GROUP BY bucket
        ORDER BY CASE bucket WHEN 'غير مستحق' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END`,[body.to])).rows;
      label='أعمار الذمم المدينة حسب فترة التأخير';
    } else if (reportType === 'balance-sheet') {
      data=(await q(`SELECT section,count(*)::int lines,coalesce(sum(amount),0) amount
        FROM fn_balance_sheet($1) GROUP BY section ORDER BY section`,[body.to])).rows;
      label='ملخص المركز المالي حسب الأصول والخصوم وحقوق الملكية';
    } else if (reportType === 'vat-return') {
      data=(await q(`SELECT box,label_ar,net,vat FROM fn_vat_return($1,$2) ORDER BY box`,[body.from,body.to])).rows;
      label='ملخص الإقرار الضريبي';
    } else if (reportType === 'trial-balance') {
      const { rows: [r] } = await q(`SELECT count(*)::int account_count,coalesce(sum(opening),0) opening,
        coalesce(sum(period_debit),0) period_debit,coalesce(sum(period_credit),0) period_credit,
        coalesce(sum(closing_debit),0) closing_debit,coalesce(sum(closing_credit),0) closing_credit
        FROM fn_trial_balance($1,$2)`, [body.from,body.to]);
      data = r; label = 'ملخص ميزان المراجعة';
    } else {
      data = (await q(`SELECT type,coalesce(sum(amount),0) amount,count(*)::int lines
        FROM fn_income_statement($1,$2) GROUP BY type ORDER BY type`, [body.from,body.to])).rows;
      label = 'ملخص قائمة الدخل';
    }
    const visualization = reportVisualization(reportType, data);
    return { grounded: true, text: JSON.stringify({ report:label, from:body.from, to:body.to, currency:'SAR', data }), visualization, sources:[{ id:reportType, name:`${label} المحسوب في قاعدة البيانات` }] };
  }

  async function auditStart(user, body, promptChars, requestId) {
    await tx(user.username, async c => {
      await c.query(`INSERT INTO ai_audit(request_id,actor_id,feature,provider,model,status,policy_decision,prompt_chars,fail_code,completed_at)
        VALUES ($1,$2,$3,$4,$5,'started','allow',$6,NULL,NULL)`,
        [requestId,user.id,body.feature,config.provider,config.model,promptChars]);
    });
    return true;
  }

  async function auditFinish(requestId, { status, inputTokens=null, outputTokens=null, cost=null, durationMs=null, failCode=null }) {
    await q(`UPDATE ai_audit SET status=$2,input_tokens=$3,output_tokens=$4,cost_estimate_usd=$5,duration_ms=$6,fail_code=$7,completed_at=now() WHERE request_id=$1`,
      [requestId,status,inputTokens,outputTokens,cost,durationMs,failCode]);
  }

  async function ask(user, body, requestId, ip) {
    if (!config.ready) {
      throw Object.assign(new Error('المساعد المحلي متوقف. فعّله من إعداد الخادم AI_LOCAL_ENABLED.'), { statusCode:503, code:'AI_DISABLED' });
    }
    rateCheck(user,body.feature,ip);
    const context = await buildContext(body);
    const prompt = JSON.stringify({ question:body.question, context:context.text });
    if (prompt.length > config.maxInputChars) throw Object.assign(new Error('السياق أكبر من الحد المسموح'), { statusCode:413, code:'AI_INPUT_LIMIT' });
    await auditStart(user, body, prompt.length, requestId);
    const started = Date.now();
    if (!context.grounded) {
      const answer = context.text;
      await auditFinish(requestId,{status:'succeeded',durationMs:Date.now()-started});
      return { answer, sources:context.sources, visualization:context.visualization || null, request_id:requestId, usage:{input_tokens:null,output_tokens:null,cost_estimate_usd:null} };
    }
    const answer = localAnswer(body, context);
    await auditFinish(requestId,{status:'succeeded',durationMs:Date.now()-started});
    return { answer, sources:context.sources, visualization:context.visualization || null, request_id:requestId, usage:{input_tokens:null,output_tokens:null,cost_estimate_usd:null} };
  }

  return { config, ask, auditFinish };
}

function localAnswer(body, context) {
  if (body.feature === 'documents') return `من دليل الاستخدام:\n${context.text.replace(/\[S\d+\]\s*/g, '')}`;
  let data; try { data=JSON.parse(context.text); } catch { return context.text; }
  if (body.feature === 'rule') return `القاعدة ${data.id} — ${data.name}\n${data.explanation}`;
  if (body.feature === 'invoice') return `الفاتورة ${data.number}: تاريخ الإصدار ${data.issue_date}، الإجمالي ${formatNumber(data.total,{minimumFractionDigits:2})} ر.س، المتبقي ${data.outstanding===null?'غير منطبق':formatNumber(data.outstanding,{minimumFractionDigits:2})+' ر.س'}.`;
  const labels={month:'الشهر',revenue:'الإيرادات',expense:'المصروفات',invoice_count:'عدد الفواتير',total_amount:'إجمالي الفواتير',outstanding_amount:'المبالغ غير المحصلة',unpaid_count:'عدد الفواتير غير المحصلة',tracked_products:'عدد أصناف المخزون المتتبعة',on_hand:'إجمالي الكمية بالمخزون',stock_value:'قيمة المخزون',out_of_stock:'أصناف نفد مخزونها',vehicle_count:'عدد المركبات',trip_count:'عدد الرحلات',fuel_liters:'كمية الوقود باللتر',fuel_cost:'تكلفة الوقود',maintenance_cost:'تكلفة الصيانة',account_count:'عدد الحسابات',opening:'الأرصدة الافتتاحية',period_debit:'إجمالي المدين خلال الفترة',period_credit:'إجمالي الدائن خلال الفترة',closing_debit:'الأرصدة المدينة الختامية',closing_credit:'الأرصدة الدائنة الختامية',type:'نوع البند',amount:'المبلغ',lines:'عدد البنود',section:'القسم',outstanding:'المبلغ المستحق',bucket:'مدة التأخير',label_ar:'البند الضريبي',net:'الصافي',vat:'الضريبة'};
  const rows=Array.isArray(data.data)?data.data:[data.data];
  const lines=rows.filter(Boolean).map(row=>Object.entries(row).map(([k,v])=>`${labels[k]||k}: ${typeof v==='number'?formatNumber(v,{maximumFractionDigits:2}):v}`).join(' · '));
  return `${data.report} للفترة ${data.from} إلى ${data.to}:\n${lines.join('\n')||'لا توجد بيانات لهذه الفترة.'}\n\nالمصدر: قاعدة بيانات التطبيق (قراءة فقط).`;
}

function reportVisualization(type, data) {
  const money = n => Number(n || 0);
  if (type === 'monthly') return { title:'الإيرادات والمصروفات حسب الشهر', kind:'series', labels:data.map(x=>x.month), series:[{name:'الإيرادات',values:data.map(x=>money(x.revenue))},{name:'المصروفات',values:data.map(x=>money(x.expense))}], unit:'ر.س' };
  if (type === 'invoices') return { title:'إجمالي الفواتير مقابل المبالغ غير المحصلة', kind:'series', labels:['الفواتير','التحصيل المتبقي'], series:[{name:'القيمة',values:[money(data.total_amount),money(data.outstanding_amount)]}], unit:'ر.س', metrics:[['عدد الفواتير',data.invoice_count],['فواتير غير محصلة',data.unpaid_count]] };
  if (type === 'inventory') return { title:'ملخص المخزون', kind:'metrics', metrics:[['أصناف متتبعة',data.tracked_products],['الكمية الحالية',money(data.on_hand)],['قيمة المخزون',money(data.stock_value)+' ر.س'],['أصناف نفد مخزونها',data.out_of_stock]] };
  if (type === 'fleet') return { title:'تكلفة الوقود والصيانة', kind:'series', labels:['الوقود','الصيانة'], series:[{name:'التكلفة',values:[money(data.fuel_cost),money(data.maintenance_cost)]}], unit:'ر.س', metrics:[['المركبات',data.vehicle_count],['الرحلات',data.trip_count],['الوقود المستهلك',money(data.fuel_liters)+' لتر']] };
  if (type === 'receivables-aging') { const rows=Array.isArray(data)?data:[]; return { title:'الذمم المدينة حسب مدة التأخير',kind:'series',labels:rows.map(x=>x.bucket),series:[{name:'المبالغ المستحقة',values:rows.map(x=>money(x.outstanding))}],unit:'ر.س',metrics:[['إجمالي الفواتير المفتوحة',rows.reduce((a,x)=>a+Number(x.invoice_count||0),0)]] }; }
  if (type === 'balance-sheet') { const rows=Array.isArray(data)?data:[], names={asset:'الأصول',liability:'الخصوم',equity:'حقوق الملكية'}; return { title:'مكونات المركز المالي',kind:'series',labels:rows.map(x=>names[x.section]||x.section),series:[{name:'الرصيد',values:rows.map(x=>money(x.amount))}],unit:'ر.س' }; }
  if (type === 'vat-return') { const rows=Array.isArray(data)?data:[]; return { title:'صافي وضريبة الإقرار حسب البند',kind:'series',labels:rows.map(x=>`${x.box} · ${x.label_ar}`),series:[{name:'الصافي',values:rows.map(x=>money(x.net))},{name:'الضريبة',values:rows.map(x=>money(x.vat))}],unit:'ر.س' }; }
  if (type === 'trial-balance') return { title:'الأرصدة الختامية المدينة والدائنة', kind:'series', labels:['مدين','دائن'], series:[{name:'الرصيد',values:[money(data.closing_debit),money(data.closing_credit)]}], unit:'ر.س', metrics:[['الحسابات',data.account_count],['إجمالي المدين للفترة',money(data.period_debit)+' ر.س'],['إجمالي الدائن للفترة',money(data.period_credit)+' ر.س']] };
  const rows=Array.isArray(data)?data:[];
  return { title:'قائمة الدخل حسب النوع', kind:'series', labels:rows.map(x=>x.type==='revenue'?'الإيرادات':x.type==='expense'?'المصروفات':x.type), series:[{name:'المبلغ',values:rows.map(x=>money(x.amount))}], unit:'ر.س' };
}
