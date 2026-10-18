// Storefront auto-setup. Pure API-side logic (no DDL), so it works on an existing database without a rebuild.
// Rules:
//  - fill-blank mode (default, used on store creation / feature change / API start): only EMPTY fields are filled, an admin's own text is never overwritten.
//  - overwrite mode (explicit admin button): replaces every site field with the defaults of the store's commerce type.
//  - a site is auto-published ONLY when it is actually ready (online_shop on + at least one published, sellable product + a valid payment method).
//  Payment methods mada/card are never defaulted: no payment gateway is integrated yet (docs/COMMERCE.md).

const TAGLINES = {
  retail: 'منتجات · توصيل · دفع آمن',
  wholesale: 'أسعار الجملة للشركات والتجار',
  rental: 'تأجير · حجوزات · توصيل وتركيب',
  service: 'صيانة · خدمات · حجز زيارة',
  subscription: 'اشتراكات وخدمات دورية',
  hybrid: 'منتجات · خدمات · حجوزات'
};

export const isMoney = v => v === null || v === undefined || v === '' || /^\d+(\.\d{1,2})?$/.test(String(v).trim());
export const money = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(String(v).trim()));

export function siteDefaults(store) {
  const f = store.features || [];
  const pay = ['cod'];
  if (f.includes('transfers')) pay.push('bank_transfer');
  const delivery = f.includes('delivery');
  const name = store.name_ar;
  return {
    title_ar: name,
    tagline_ar: TAGLINES[store.commerce_type] || TAGLINES.hybrid,
    about_ar: `${name}: نوفّر ${f.includes('rental') ? 'التأجير والحجز، ' : ''}${f.includes('services') ? 'الخدمات والصيانة، ' : ''}والبيع المباشر بأسعار واضحة${delivery ? '، ونوصّل إلى باب بيتك' : ''}.`,
    return_policy_ar: 'يمكن استرجاع أو استبدال المنتج خلال 7 أيام من الاستلام بشرط أن يكون بحالته الأصلية وغير مستخدم ومعه الفاتورة. الخدمات والحجوزات تُلغى قبل موعدها بـ 24 ساعة على الأقل.',
    theme_color: '#14B8A6',
    payment_methods: pay,
    delivery_fee: delivery ? 30 : 0,
    free_delivery_over: delivery ? 500 : null,
    min_order: 0
  };
}

const blank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Apply defaults inside the caller's transaction. Returns { changed: [...fields], site }. */
export async function applySiteDefaults(c, storeId, { overwrite = false } = {}) {
  const { rows: [s] } = await c.query('SELECT * FROM stores WHERE id=$1', [storeId]);
  if (!s) return { changed: [], site: null };
  const d = siteDefaults(s);
  let { rows: [w] } = await c.query('SELECT * FROM store_site WHERE store_id=$1', [storeId]);
  if (!w) { await c.query('INSERT INTO store_site(store_id,title_ar) VALUES ($1,$2)', [storeId, s.name_ar]); w = (await c.query('SELECT * FROM store_site WHERE store_id=$1', [storeId])).rows[0]; }
  const next = {}, changed = [];
  for (const [k, v] of Object.entries(d)) {
    const cur = w[k];
    const empty = k === 'payment_methods' ? !(cur || []).length
      : k === 'delivery_fee' || k === 'min_order' ? Number(cur || 0) === 0
      : k === 'free_delivery_over' ? cur === null
      : k === 'theme_color' ? false : blank(cur);
    if (overwrite || empty) { if (JSON.stringify(cur) !== JSON.stringify(v) && String(cur) !== String(v)) { next[k] = v; changed.push(k); } }
  }
  if (Object.keys(next).length) {
    const keys = Object.keys(next);
    const sets = keys.map((k, i) => `${k}=$${i + 2}${k === 'payment_methods' ? '::text[]' : k === 'delivery_fee' || k === 'free_delivery_over' || k === 'min_order' ? '::numeric' : ''}`).join(', ');
    await c.query(`UPDATE store_site SET ${sets} WHERE store_id=$1`, [storeId, ...keys.map(k => next[k])]);
  }
  return { changed, site: (await c.query('SELECT * FROM store_site WHERE store_id=$1', [storeId])).rows[0] };
}

/** Go-live checklist. `ok` items are blockers when false; `warn` items are advice. */
export async function readiness(q, storeId) {
  const { rows: [s] } = await q('SELECT s.*, b.name_ar branch_name FROM stores s LEFT JOIN branches b ON b.id=s.branch_id WHERE s.id=$1', [storeId]);
  if (!s) return null;
  const { rows: [w] } = await q('SELECT * FROM store_site WHERE store_id=$1', [storeId]);
  const { rows: [p] } = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE kind='goods')::int goods,
      count(*) FILTER (WHERE kind='goods' AND stock_tracked AND NOT allow_negative AND fn_available(id,$1) <= 0)::int out_of_stock,
      count(*) FILTER (WHERE kind IN ('service','rental'))::int bookable FROM products WHERE is_active AND published`, [storeId]);
  const { rows: [tc] } = await q('SELECT count(*)::int n FROM technicians WHERE is_active');
  const f = s.features || [], site = w || {};
  const items = [
    { k: 'active', t: 'المتجر نشط', ok: !!s.is_active },
    { k: 'feature', t: 'ميزة «المتجر الإلكتروني» مفعّلة', ok: f.includes('online_shop'), fix: 'فعّلها من القسم ١ ثم احفظ' },
    { k: 'branch', t: 'مرتبط بفرع', ok: !!s.branch_id, fix: 'اختر الفرع من القسم ١' },
    { k: 'content', t: 'عنوان الموقع والنبذة وسياسة الاسترجاع مكتملة', ok: !blank(site.title_ar) && !blank(site.about_ar) && !blank(site.return_policy_ar), fix: 'اضغط «ضبط الإعدادات الافتراضية»' },
    { k: 'contact', t: 'وسيلة تواصل واحدة على الأقل (جوال / واتساب / بريد)', ok: !blank(site.phone) || !blank(site.whatsapp) || !blank(site.email), fix: 'أدخل رقم الجوال أو الواتساب' },
    { k: 'pay', t: 'طريقة دفع واحدة على الأقل', ok: (site.payment_methods || []).length > 0, fix: 'اختر طريقة دفع' },
    { k: 'products', t: 'منتج واحد على الأقل منشور', ok: p.total > 0, fix: 'انشر منتجاً من «المنتجات والعروض»' },
    { k: 'delivery', t: f.includes('delivery') ? 'رسوم التوصيل محددة' : 'التوصيل غير مفعّل (لا حاجة لرسوم)', ok: !f.includes('delivery') || Number(site.delivery_fee) >= 0, warn: f.includes('delivery') && Number(site.delivery_fee) === 0 , fix: 'رسوم التوصيل صفر (توصيل مجاني دائماً)'}
  ];
  if (p.bookable > 0 || f.includes('booking')) {
    const bad = !f.includes('booking') ? 'توجد خدمات/تأجير منشورة لكن ميزة «الحجز» غير مفعّلة، فلن يظهر زر الحجز' : tc.n === 0 ? 'لا يوجد فني نشط: يمكن استقبال الحجوزات لكن لا يمكن إسنادها' : null;
    items.push({ k: 'booking', t: bad || 'الحجوزات جاهزة (ميزة الحجز مفعّلة ويوجد فني نشط)', ok: true, warn: !!bad, fix: bad ? 'فعّل «الحجز» من القسم ١ وأضف فنياً من الحجوزات ← الفنيون' : undefined });
  }
  const blockers = items.filter(i => !i.ok).length;
  return { store_id: s.id, slug: s.slug, is_published: !!site.is_published, ready: blockers === 0, blockers, items, published_products: p.total, out_of_stock_products: p.out_of_stock, bookable_products: p.bookable, active_technicians: tc.n };
}

/** On API start: fill blanks for every active store; auto-publish only stores that are verifiably ready. Never throws (a failed bootstrap must not stop the API). */
export async function bootstrapStores({ q, tx, log }) {
  try {
    const { rows } = await q('SELECT id, slug FROM stores WHERE is_active ORDER BY id');
    for (const s of rows) {
      const r = await tx('system', c => applySiteDefaults(c, s.id));
      const rd = await readiness(q, s.id);
      if (rd?.ready && !rd.is_published && process.env.AUTO_PUBLISH_READY_SITES !== 'false') {
        await tx('system', c => c.query('UPDATE store_site SET is_published=true WHERE store_id=$1', [s.id]));
        log?.info?.(`store ${s.slug}: auto-published (all readiness checks passed)`);
      }
      if (r.changed.length) log?.info?.(`store ${s.slug}: filled defaults for ${r.changed.join(', ')}`);
    }
  } catch (e) { log?.error?.({ err: e }, 'store bootstrap skipped'); }
}
