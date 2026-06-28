/**
 * whatsappCampaign — owner-side WhatsApp broadcast via the store's own Seniqify
 * (backendprod) template API.
 *
 * Flow: the owner creates + gets a template approved on Seniqify, then pastes
 * that template's API URL (+ Bearer key) into Manage. We store it server-side
 * only (store_whatsapp table, PIN-checked RPC — never in the public config), and
 * the send-campaign edge function attaches the key and posts the personalised
 * "multiple" payload. PocketLink just turns the customer list into recipients.
 */
import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-campaign`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Pull the actual endpoint out of whatever the owner pastes — they often paste
 * the whole Seniqify block ("Template Name … Payload … API URL: https://…").
 * Prefers a `…/process` URL; strips trailing quotes/punctuation.
 */
export function cleanTemplateUrl(input) {
  const text = String(input || '').trim();
  const m = text.match(/https?:\/\/\S+?\/process\b/i) || text.match(/https?:\/\/\S+/i);
  const url = m ? m[0] : text;
  return url.replace(/["'`,)\]}>]+$/, '').trim();
}

/** Replace {name}/{shop}/{orders} tokens in a variable template for one customer. */
export function fillToken(tpl, customer = {}, shop = '') {
  return String(tpl ?? '')
    .replace(/\{name\}/gi,   customer.name || 'there')
    .replace(/\{shop\}/gi,   shop || 'our shop')
    .replace(/\{orders\}/gi, String(customer.orderCount ?? ''))
    .trim();
}

/**
 * Turn customers into the Seniqify `numbers[]` payload. Each recipient gets its
 * own positional `values` ({{1}}, {{2}}…) built from the owner's var templates.
 * Skips anyone without a usable 10-digit number.
 */
export function buildRecipients(customers = [], varTemplates = ['{name}'], shop = '') {
  const tpls = Array.isArray(varTemplates) && varTemplates.length ? varTemplates : ['{name}'];
  return customers
    .map((c) => {
      const phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) return null;
      const values = {};
      tpls.forEach((t, i) => { values[String(i + 1)] = fillToken(t, c, shop); });
      return { receiver: `91${phone}`, values };
    })
    .filter(Boolean);
}

/** Read the store's saved WhatsApp config (key returned MASKED). PIN-checked. */
export async function getWhatsappConfig(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_whatsapp', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return null;
    return data?.[0] || { configured: false, template_url: '', api_key_masked: '', var_templates: ['{name}'] };
  } catch {
    return null;
  }
}

/** Save/update the store's WhatsApp config. Leave apiKey blank to keep the saved one. */
export async function saveWhatsappConfig(slug, pin, { templateUrl, apiKey = '', varTemplates = ['{name}'] }) {
  const hashed = await hashPin(pin);
  const { error } = await supabase.rpc('set_store_whatsapp', {
    p_slug: slug,
    p_hashed_pin: hashed,
    p_template_url: cleanTemplateUrl(templateUrl),
    p_api_key: apiKey,
    p_var_templates: varTemplates,
  });
  if (error) throw new Error(error.message);
}

/** Send a campaign to the given recipients. Returns { sent, failed }. */
export async function sendCampaign(slug, pin, recipients) {
  const hashed = await hashPin(pin);
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ slug, hashedPin: hashed, recipients }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Send failed');
  return json;
}
