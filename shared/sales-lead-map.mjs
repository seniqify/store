// Sales CRM part 3: turn what Google Ads, Meta lead ads and the website form
// send into one shape for public.sales_lead_in(). PURE (no network), shared by
// supabase/functions/sales-lead-in and tests/sales-crm-part3.test.mjs.

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const SHOP_WORDS = /(shop|store|business|company|firm|dukan|brand)/i;
const CITY_WORDS = /(city|town|district|location)/i;

/**
 * Google Ads lead form webhook body ->
 * { ok, externalId, name, phone, shop, city, campaign, form, isTest } or { ok: false, why }.
 * The key the manager set in Google Ads must match `key`.
 */
export function fromGoogle(body, key) {
  if (!body || typeof body !== 'object') return { ok: false, why: 'no body' };
  if (!key || typeof body.google_key !== 'string' || !sameText(body.google_key, key)) return { ok: false, why: 'bad key' };
  const cols = Array.isArray(body.user_column_data) ? body.user_column_data : [];
  const get = (...ids) => {
    for (const id of ids) {
      const c = cols.find((x) => String(x?.column_id || '').toUpperCase() === id);
      if (c && clean(c.string_value, 200)) return clean(c.string_value, 200);
    }
    return '';
  };
  // Custom questions ("Your shop's name?") carry their text in column_name.
  const custom = (re) => clean(cols.find((x) => re.test(String(x?.column_name || '')))?.string_value, 120);
  const name = get('FULL_NAME') || clean(`${get('FIRST_NAME')} ${get('LAST_NAME')}`, 120);
  return {
    ok: true,
    externalId: clean(body.lead_id, 200) || null,
    name,
    phone: get('PHONE_NUMBER', 'WORK_PHONE'),
    shop: get('COMPANY_NAME') || custom(SHOP_WORDS),
    city: get('CITY') || custom(CITY_WORDS),
    campaign: body.campaign_id ? `Google campaign ${clean(body.campaign_id, 40)}` : '',
    form: body.form_id ? `Form ${clean(body.form_id, 40)}` : '',
    isTest: body.is_test === true,
  };
}

/** The leadgen ids in a Meta Page webhook: [{ leadgenId, formId, adId, pageId }]. */
export function metaLeadIds(body) {
  const out = [];
  for (const e of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(e?.changes) ? e.changes : []) {
      if (ch?.field !== 'leadgen' || !ch.value?.leadgen_id) continue;
      out.push({ leadgenId: String(ch.value.leadgen_id), formId: String(ch.value.form_id || ''), adId: String(ch.value.ad_id || ''), pageId: String(ch.value.page_id || e.id || '') });
    }
  }
  return out;
}

/** A lead read from the Graph API (/{leadgen_id}?fields=field_data,...) -> one shape. */
export function fromMetaLead(lead, leadgenId) {
  const fields = Array.isArray(lead?.field_data) ? lead.field_data : [];
  const val = (f) => clean(Array.isArray(f?.values) ? f.values[0] : f?.values, 200);
  const by = (...names) => {
    for (const n of names) {
      const f = fields.find((x) => String(x?.name || '').toLowerCase() === n);
      if (f && val(f)) return val(f);
    }
    return '';
  };
  const like = (re) => { const f = fields.find((x) => re.test(String(x?.name || ''))); return f ? val(f).slice(0, 120) : ''; };
  return {
    ok: true,
    externalId: String(leadgenId || lead?.id || ''),
    name: by('full_name') || clean(`${by('first_name')} ${by('last_name')}`, 120),
    phone: by('phone_number', 'phone', 'mobile_number', 'whatsapp_number'),
    shop: by('company_name', 'business_name', 'shop_name') || like(SHOP_WORDS),
    city: by('city') || like(CITY_WORDS),
    campaign: clean(lead?.campaign_name || lead?.ad_name || '', 200),
    form: clean(lead?.form_name || (lead?.form_id ? `Form ${lead.form_id}` : ''), 200),
    source: String(lead?.platform || '').toLowerCase() === 'ig' ? 'instagram' : 'facebook',
    isTest: false,
  };
}

/** The "call me back" form on pocketlink.store. hp = honeypot (bots fill it). */
export function fromWebsite(body) {
  if (!body || typeof body !== 'object') return { ok: false, why: 'no body' };
  if (clean(body.hp, 10)) return { ok: false, why: 'bot', silent: true };
  const digits = String(body.phone ?? '').replace(/\D/g, '');
  const p10 = digits.length >= 10 ? digits.slice(-10) : '';
  if (!/^[6-9][0-9]{9}$/.test(p10)) return { ok: false, why: 'Enter a 10-digit mobile number.' };
  const name = clean(body.name, 120);
  if (name.length < 2) return { ok: false, why: 'Enter your name.' };
  return {
    ok: true, externalId: null, name, phone: p10, shop: clean(body.shop, 120), city: clean(body.city, 80),
    campaign: clean(body.page, 60) ? `Page ${clean(body.page, 60)}` : '', form: 'Call me back', isTest: false,
  };
}

/** Constant-time compare for short secrets. */
export function sameText(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
