import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';
import { batches } from './offerText';

/**
 * WhatsApp offers — the browser side. The rules (who may receive an offer, what
 * it costs, which messages a shop may use) live in supabase/offers-forward.sql;
 * sending happens in the send-offer edge function. The browser never sees a
 * template's Seniqify link.
 */

/** Ready-made + this shop's own messages, or null on failure. */
export async function listTemplates(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('list_message_templates', { p_slug: slug, p_hashed_pin: hashed });
    return error || !Array.isArray(data) ? null : data;
  } catch {
    return null;
  }
}

/** Ask for the shop's own message. Resolves { ok, id } or { ok: false, error }. */
export async function requestTemplate(slug, pin, name, body) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('request_message_template', {
      p_slug: slug, p_hashed_pin: hashed, p_name: name, p_body: body,
    });
    if (error || !data) return { ok: false, error: 'Could not send the request. Please try again.' };
    return data;
  } catch {
    return { ok: false, error: 'Could not send the request. Please try again.' };
  }
}

/** Who of these customers can receive the offer, and the cost. */
export async function offerAudience(slug, pin, templateId, phones, fields) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('offer_audience', {
      p_slug: slug, p_hashed_pin: hashed, p_template_id: templateId, p_phones: phones, p_fields: fields,
    });
    if (error || !data) return { ok: false, error: 'Could not check who can receive it. Please try again.' };
    return data;
  } catch {
    return { ok: false, error: 'Could not check who can receive it. Please try again.' };
  }
}

/** Send in batches; onProgress({ done, total, sent, failed }). Stops early when
 *  the wallet runs out. Resolves the totals. */
export async function sendOffer({ slug, pin, templateId, fields, phones, onProgress }) {
  const hashed = await hashPin(pin);
  const total = phones.length;
  const sum = { sent: 0, failed: 0, skipped: 0, stoppedFor: '' };
  let done = 0;
  for (const chunk of batches(phones)) {
    const { data, error } = await supabase.functions.invoke('send-offer', {
      body: { slug, hashedPin: hashed, template_id: templateId, fields, phones: chunk },
    });
    if (error || data?.error) throw new Error(data?.error || 'Sending stopped. Please try again.');
    sum.sent += Number(data.sent) || 0;
    sum.failed += Number(data.failed) || 0;
    sum.skipped += Number(data.skipped) || 0;
    done += chunk.length;
    onProgress?.({ done, total, sent: sum.sent, failed: sum.failed });
    const r = data.reasons || {};
    if (r.no_balance) { sum.stoppedFor = 'no_balance'; break; }
    if (r.not_approved || r.bad_field) { sum.stoppedFor = 'message'; break; }
  }
  return sum;
}

/** The customer asked the shop to stop WhatsApp offers. */
export async function recordOptOut(slug, pin, phone) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc('seller_record_optout', { p_slug: slug, p_hashed_pin: hashed, p_phone: phone });
  if (error || data !== true) throw new Error('Could not save that. Please try again.');
  return true;
}
