import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const BASE = 'https://track.delhivery.com';

// Delhivery rejects non-Latin (Devanagari) consignee data as "suspicious" and
// partial-saves it (name/phone/address dropped). Its labels can't render
// Devanagari either. So transliterate any Devanagari to readable Latin before
// sending. Approximate (schwa-deleted at word end) but legible for a courier.
function toLatin(input: string): string {
  const s = String(input || '');
  if (!/[ऀ-ॿ]/.test(s)) return s;   // nothing Devanagari → leave as-is
  const V: Record<string, string> = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऑ':'o','ऍ':'e','ॲ':'a' };
  const M: Record<string, string> = { 'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o','ॅ':'e' };
  const C: Record<string, string> = {
    'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','ळ':'l',
    'क़':'q','ख़':'kh','ग़':'g','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f','य़':'y',
  };
  const D: Record<string, string> = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
  let out = '', pend = false;
  const flush = (end: boolean) => { if (pend) { if (!end) out += 'a'; pend = false; } };
  for (const ch of s) {
    if (C[ch] !== undefined)      { flush(false); out += C[ch]; pend = true; }
    else if (M[ch] !== undefined) { out += M[ch]; pend = false; }
    else if (ch === '्')          { pend = false; }
    else if (ch === 'ं' || ch === 'ँ') { flush(false); out += 'n'; }
    else if (ch === 'ः')          { flush(false); out += 'h'; }
    else if (V[ch] !== undefined) { flush(false); out += V[ch]; }
    else if (D[ch] !== undefined) { flush(false); out += D[ch]; }
    else                          { flush(true); out += ch; }   // space / latin / punctuation
  }
  flush(true);
  return out.replace(/\s+/g, ' ').trim();
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ── booking ─────────────────────────────────────────────────────────────────
//
// Booking is the one shipment operation that makes something in the outside
// world: a real parcel, often a real pickup. Two requests for one order must
// never both reach the courier, and a parcel that exists must never go
// unrecorded. So every booking walks one path, bookShipment, in this order:
//
//   1. everything that can fail LOCALLY fails first -- PIN, store, account,
//      order, address, pincode -- before any claim exists;
//   2. claim_shipment_attempt lets exactly ONE request per order through (a
//      row lock plus the one-open-attempt index). Every other request is
//      turned away having spoken to nobody;
//   3. the courier's create call runs exactly once and is never retried, with
//      a reference that is a pure function of (order, attempt number);
//   4. its answer is classified strictly: CREATED (an explicit AWB), REJECTED
//      (provably nothing created), or UNKNOWN (everything else);
//   5. CREATED -> finalize_shipment_attempt writes the AWB to the attempt AND
//      the order, together. REJECTED -> fail_shipment_attempt releases the
//      claim. UNKNOWN -> the claim stays OPEN and blocks the order until a
//      person checks the courier panel. An open claim is the safe state: it
//      costs a manual check. Releasing it wrongly costs a duplicate parcel.
//
// shipping-book never writes orders.awb itself. The RPCs are the only writers.

/** The buyer-facing tracking link, by the courier that actually carries it. */
function trackUrlFor(courier: unknown, awb: unknown): string | null {
  if (!awb) return null;
  return String(courier || '').toLowerCase() === 'shadowfax'
    ? null                                        // Shadowfax has no public page
    : `https://www.delhivery.com/track/package/${awb}`;
}

/**
 * The order as the database actually has it. `known: false` means we could not
 * read it back - which is NOT the same as "no AWB", and must never be treated
 * as one.
 */
async function readCurrentShipment(
  supabase: any, slug: string, orderId: string,
): Promise<{ known: boolean; awb: string | null; courier: string | null }> {
  try {
    const { data, error } = await supabase.from('orders')
      .select('awb, courier').eq('id', orderId).eq('store_slug', slug).maybeSingle();
    if (error || !data) return { known: false, awb: null, courier: null };
    return { known: true, awb: data.awb ?? null, courier: data.courier ?? null };
  } catch {
    return { known: false, awb: null, courier: null };
  }
}

/**
 * One RPC call. Returns its JSON result, or null when no usable answer was
 * HEARD: a thrown error, an error result, or a result without an outcome.
 * null means "we do not know", never "it did not happen".
 */
async function askRpc(
  supabase: any, fn: string, args: Record<string, unknown>,
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error || !data || typeof data !== 'object' || typeof data.outcome !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

// ── the courier-side reference ──────────────────────────────────────────────
//
// Each courier is sent a per-booking reference and REJECTS one it has seen
// before (Delhivery: "Duplicate order id"; Shadowfax: a duplicate
// client_order_id). Until B2B it came from Date.now(), so every attempt sent a
// new one and the courier's duplicate check could never catch a repeat.
//
// It is now a pure function of (order id, attempt number): the same attempt
// always sends the same reference, so the courier's own duplicate check stands
// behind the claim as a second guard. A new attempt -- possible only after the
// previous one was provably released -- sends a new one.
//
// The formats are EXACTLY the shapes production already sends and both
// couriers already accept; only the source of the variable part changes:
//   Delhivery  8 chars, [0-9A-Z]. Live since 637d008 (2026-08-14), "verified
//              against the live label": it must stay short, because a longer
//              reference's barcode garbled the label's return address.
//   Shadowfax  20 chars, [0-9a-z]. Live since 1ff601f (2026-08-20), the first
//              Shadowfax booking, and unchanged since.

/** The order id as 32 lowercase hex characters, or '' if it is not a UUID. PURE. */
function orderHex(orderId: unknown): string {
  const h = String(orderId ?? '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(h) ? h : '';
}

/** 32-bit FNV-1a. PURE, and identical in Deno and Node. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Delhivery's `order` reference. PURE.
 *
 * The last 4 hex of the order id, then 4 base36 characters computed from
 * (order id, attempt number), uppercased: exactly 8 characters, [0-9A-Z] --
 * the shape production has sent since 2026-08-14. The first four still match
 * the tail of the order number printed on the delivery slip, as they always
 * have. For one order, every attempt gets a different token by construction:
 * it is (hash + attempt) modulo 36^4. '' when no valid reference can be made.
 */
function delhiveryReference(orderId: unknown, attemptNo: unknown): string {
  const hex = orderHex(orderId);
  const n = Number(attemptNo);
  if (!hex || !Number.isInteger(n) || n < 1) return '';
  const token = ((fnv1a32(hex) + n) % 1679616).toString(36).padStart(4, '0');
  const ref = (hex.slice(-4) + token).toUpperCase();
  return /^[0-9A-Z]{8}$/.test(ref) ? ref : '';
}

/**
 * Shadowfax's client_order_id. PURE.
 *
 * The last 12 hex of the order id, then the attempt number in base36 padded to
 * 8 digits: exactly 20 characters, [0-9a-z] -- the shape production has sent
 * since 2026-08-20. It can never equal a reference sent before B2B: those
 * ended in Date.now().toString(36), 8 digits that have not started with '0'
 * since 1972; these start with '0' for every attempt below 36^7.
 * '' when no valid reference can be made.
 */
function shadowfaxReference(orderId: unknown, attemptNo: unknown): string {
  const hex = orderHex(orderId);
  const n = Number(attemptNo);
  if (!hex || !Number.isInteger(n) || n < 1 || n >= 78364164096) return '';
  const ref = hex.slice(-12) + n.toString(36).padStart(8, '0');
  return /^[0-9a-z]{20}$/.test(ref) ? ref : '';
}

// ── what the courier's create call said ─────────────────────────────────────

/** A JSON object parsed from a body, or null. PURE. */
function jsonObject(bodyText: unknown): Record<string, any> | null {
  try {
    const v = JSON.parse(String(bodyText ?? ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The reason a courier gave, read only from its named message fields -- never
 * the raw body -- and bounded. PURE.
 */
function createReason(bodyText: unknown): string {
  const b = jsonObject(bodyText);
  if (!b) return '';
  const pkg = Array.isArray(b.packages) ? b.packages[0] : null;
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === 'string' && v.trim()) parts.push(v);
    else if (v && typeof v === 'object') parts.push(JSON.stringify(v));
  };
  add(b.errors);
  add(pkg?.remarks);
  add(b.rmk);
  add(b.error);
  if (typeof b.message === 'string' && b.message !== 'Success') add(b.message);
  return parts.join('; ').replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Does a courier's message say this reference already exists? PURE. */
function mentionsDuplicate(text: unknown): boolean {
  return /duplicate|already exists?|already been (used|taken|created|booked)|exists already|must be unique|not unique|unique constraint/i
    .test(String(text ?? ''));
}

/** A 4xx meaning "refused, not processed": not a timeout, conflict or rate limit. PURE. */
function isRefusalStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

/**
 * Shadowfax's answer to a create. PURE.
 *
 *   CREATED   HTTP 2xx, a JSON object, message 'Success' and an awb_number --
 *             the success test production has always used, plus the 2xx.
 *   REJECTED  a 4xx refusal with no AWB and no duplicate-reference message:
 *             the request was refused, so nothing was created.
 *   UNKNOWN   everything else. A duplicate-reference message is UNKNOWN: the
 *             first create under this reference may have succeeded with its
 *             answer lost. So is a 2xx without an AWB -- nothing in this repo
 *             shows that such an answer means nothing was created -- and so is
 *             an AWB beside anything short of a clean success.
 */
function classifyShadowfaxCreate(status: number, bodyText: string): CreateResult {
  const b = jsonObject(bodyText);
  const reason = createReason(bodyText);
  const raw = b?.data?.awb_number;
  const awb = raw === null || raw === undefined ? '' : String(raw).trim();
  if (b ? mentionsDuplicate(reason) : mentionsDuplicate(bodyText)) {
    return { kind: 'unknown', reason, duplicate: true };
  }
  const ok = status >= 200 && status < 300;
  if (awb) {
    if (ok && b?.message === 'Success') return { kind: 'created', awb, status: String(b?.data?.status || 'new') };
    return { kind: 'unknown', reason: reason || 'an AWB came back without a clean success', duplicate: false };
  }
  if (isRefusalStatus(status)) return { kind: 'rejected', reason: reason || `HTTP ${status}` };
  return { kind: 'unknown', reason: reason || (status ? `HTTP ${status}` : 'no answer'), duplicate: false };
}

/**
 * Delhivery's answer to a create. PURE.
 *
 *   CREATED   HTTP 2xx, a JSON object and packages[0].waybill -- the success
 *             test production has always used, plus the 2xx.
 *   REJECTED  a 4xx refusal with no waybill and no duplicate-reference message.
 *   UNKNOWN   everything else, including a 2xx with no waybill: its remarks are
 *             shown to the merchant, but nothing in this repo shows that such
 *             an answer means nothing was created. "Duplicate order id" is
 *             UNKNOWN: the first create under this reference may have
 *             succeeded with its answer lost.
 */
function classifyDelhiveryCreate(status: number, bodyText: string): CreateResult {
  const b = jsonObject(bodyText);
  const reason = createReason(bodyText);
  const pkg = Array.isArray(b?.packages) ? b?.packages[0] : null;
  const raw = pkg?.waybill;
  const awb = raw === null || raw === undefined ? '' : String(raw).trim();
  if (b ? mentionsDuplicate(reason) : mentionsDuplicate(bodyText)) {
    return { kind: 'unknown', reason, duplicate: true };
  }
  const ok = status >= 200 && status < 300;
  if (awb) {
    if (ok && b) return { kind: 'created', awb, status: String(pkg?.status || 'Manifested') };
    return { kind: 'unknown', reason: reason || 'a waybill came back without a clean success', duplicate: false };
  }
  if (isRefusalStatus(status)) return { kind: 'rejected', reason: reason || `HTTP ${status}` };
  return { kind: 'unknown', reason: reason || (status ? `HTTP ${status}` : 'no answer'), duplicate: false };
}

type CreateResult =
  | { kind: 'created'; awb: string; status: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown'; reason: string; duplicate: boolean };

// ── cleaning up a duplicate ─────────────────────────────────────────────────
//
// The two tests below are COPIED from shipping-ops, which owns cancellation.
// Each edge function deploys alone, so the copy is deliberate, and a test pins
// the two byte-for-byte. A courier refusal that merely mentions "cancel" is
// not a cancellation.

/**
 * Did Shadowfax CONFIRM the cancellation? PURE.
 *
 * Only when the HTTP call succeeded, the body is a JSON object, and its
 * responseCode is the number 200. The message is never evidence of success:
 * the old test accepted anything matching /cancel/i, and "Order cannot be
 * cancelled" matches. A 200 beside a message saying the cancellation did not
 * happen is contradictory, and contradictory is not confirmed.
 */
function shadowfaxCancelConfirmed(httpOk: boolean, bodyText: string): boolean {
  if (!httpOk) return false;
  let body: any;
  try { body = JSON.parse(String(bodyText ?? '')); } catch { return false; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (body.responseCode !== 200) return false;
  const msg = typeof body.responseMsg === 'string' ? body.responseMsg : '';
  return !/\b(cannot|can't|could not|unable|not allowed|not cancel\w*|failed|invalid|denied|rejected)\b/i.test(msg);
}

/**
 * Did Delhivery CONFIRM the cancellation? PURE.
 *
 * Only when the HTTP call succeeded AND one of two explicit answers is there:
 *   A. the body is valid JSON whose `status` is the boolean true, or
 *   B. the body is not JSON and carries <status>True</status>, with no other
 *      <status> value beside it.
 * Never on loose text -- refusals say "cancelled" too ("Cannot be cancelled").
 * A JSON-looking fragment inside non-JSON text is not JSON, and the string
 * "true" is not the boolean.
 */
function delhiveryCancelConfirmed(httpOk: boolean, bodyText: string): boolean {
  if (!httpOk) return false;
  const text = String(bodyText ?? '');
  let parsed: unknown;
  let isJson = true;
  try { parsed = JSON.parse(text); } catch { isJson = false; }
  if (isJson) {
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as { status?: unknown }).status === true;
  }
  const values = [...text.matchAll(/<status>\s*([^<]*?)\s*<\/status>/gi)].map((m) => m[1].toLowerCase());
  return values.length > 0 && values.every((v) => v === 'true');
}

/**
 * Cancel a DUPLICATE this request created, after another shipment won the
 * order. cancelled: true ONLY on the courier's explicit confirmation. Provider
 * bodies never travel further than this function.
 */
async function cancelAtCourier(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  provider: string, awb: string, token: string, mode: string,
): Promise<{ cancelled: boolean; reason: string }> {
  try {
    if (provider === 'shadowfax') {
      const sBase = mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';
      const cr = await fetchFn(`${sBase}/v3/clients/orders/cancel/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: awb }),
      });
      const ok = shadowfaxCancelConfirmed(!!cr?.ok, await cr.text());
      return { cancelled: ok, reason: ok ? '' : 'the courier did not confirm the cancellation' };
    }
    const r = await fetchFn(`${BASE}/api/p/edit`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ waybill: String(awb), cancellation: 'true' }),
    });
    const ok = delhiveryCancelConfirmed(!!r?.ok, await r.text());
    return { cancelled: ok, reason: ok ? '' : 'the courier did not confirm the cancellation' };
  } catch {
    return { cancelled: false, reason: 'could not reach the courier to cancel' };
  }
}

// ── the merchant's answers ──────────────────────────────────────────────────

/** We never learned whether the courier made a parcel. Never guess, never retry. PURE. */
function bookingUnknown(
  courierName?: string, reference?: string, said?: string, duplicate?: boolean,
): Record<string, unknown> {
  const who = courierName || 'The courier';
  return {
    error: (duplicate
      ? `${who} says this booking's reference already exists, so a shipment may already have been created. `
      : `${who} did not give a clear answer, so we cannot tell whether a shipment was created. `)
      + (said ? `${who} said: "${said}". ` : '')
      + `Check your courier panel${reference ? ` for reference ${reference}` : ''} before booking this order again. `
      + 'The order stays locked until it is checked.',
    bookingUnknown: true,
    needsReconciliation: true,
    ...(reference ? { reference } : {}),
  };
}

/** The claim was refused, so the courier was never contacted. */
async function claimRefused(
  supabase: any, slug: string, orderId: string, claim: Record<string, any>,
): Promise<Record<string, unknown>> {
  switch (claim.outcome) {
    case 'already_booked': {
      const cur = await readCurrentShipment(supabase, slug, orderId);
      const awb = claim.awb ?? cur.awb ?? null;
      return { awb, alreadyBooked: true, courier: cur.courier, trackUrl: trackUrlFor(cur.courier, awb) };
    }
    case 'open_with_awb':
      return {
        error: `This order already has a shipment (${claim.awb}) that is not attached to it yet. Check it in your courier panel before booking again.`,
        needsReconciliation: true,
        awb: claim.awb ?? null,
      };
    case 'open_without_awb':
      return {
        error: 'A booking for this order is already in progress, or its result was never confirmed. Check your courier panel before trying again.',
        bookingInProgress: true,
        needsReconciliation: true,
      };
    case 'order_not_bookable':
      return { error: 'This order is cancelled, so it cannot be shipped.' };
    case 'order_not_found':
      return { error: 'Order not found' };
    case 'invalid_courier':
      return { error: 'Courier not connected' };
    case 'race_lost':
      return { error: 'Another booking for this order just started. Refresh in a moment to see it.' };
    default:
      return { error: 'Could not start this booking, so nothing was sent to the courier.' };
  }
}

/** The courier made a parcel; PocketLink could not hear whether it was saved. PURE. */
function finalizeUnheard(courierName: string, awb: string): Record<string, unknown> {
  return {
    error: `${courierName} created shipment ${awb}, but PocketLink could not confirm it was saved to this order. `
      + `Refresh the order: if it shows ${awb}, the booking is complete. Do not book again.`,
    needsReconciliation: true,
    attachUnknown: true,
    createdAwb: awb,
  };
}

/** The courier made a parcel the database would not attach. PURE. */
function finalizeRefused(courierName: string, awb: string, outcome: string): Record<string, unknown> {
  return {
    error: `${courierName} created shipment ${awb}, but it could not be attached to this order. `
      + `Do not book again -- check ${awb} in your ${courierName} panel and contact support.`,
    needsReconciliation: true,
    orphanAwb: awb,
    outcome,
  };
}

/**
 * Our parcel lost: another shipment owns the order. Cancel ours at the courier
 * and, ONLY on an explicit confirmation, record it as superseded. Anything
 * short of that leaves our claim OPEN -- blocking -- and says so plainly.
 */
async function settleDuplicate(
  deps: { supabase: any; fetch: (url: string, init?: RequestInit) => Promise<Response> },
  c: { slug: string; orderId: string; provider: 'shadowfax' | 'delhivery'; token: string; mode: string },
  courierName: string, attemptId: unknown, ourAwb: string, winnerAwb: unknown,
): Promise<Record<string, unknown>> {
  const undo = await cancelAtCourier(deps.fetch, c.provider, ourAwb, c.token, c.mode);
  if (!undo.cancelled) {
    return {
      error: `This order was already booked, and a duplicate ${courierName} shipment (${ourAwb}) was created `
        + `that could not be confirmed as cancelled. Cancel ${ourAwb} in your ${courierName} panel. Do not book again.`,
      needsReconciliation: true,
      orphanAwb: ourAwb,
    };
  }
  const args = {
    p_attempt_id: attemptId, p_store_slug: c.slug, p_courier: c.provider,
    p_awb: ourAwb, p_final_status: 'Cancelled (duplicate)',
  };
  let sup = await askRpc(deps.supabase, 'supersede_shipment_attempt', args);
  if (!sup) sup = await askRpc(deps.supabase, 'supersede_shipment_attempt', args);   // exactly one retry
  if (sup && (sup.outcome === 'superseded' || sup.outcome === 'already_superseded')) {
    const cur = await readCurrentShipment(deps.supabase, c.slug, c.orderId);
    const awb = winnerAwb ?? cur.awb ?? null;
    return {
      awb, alreadyBooked: true, courier: cur.courier, trackUrl: trackUrlFor(cur.courier, awb),
      note: 'This order was already booked a moment ago. The duplicate shipment was cancelled.',
    };
  }
  return {
    error: `This order was already booked. The duplicate ${courierName} shipment (${ourAwb}) was cancelled `
      + 'with the courier, but PocketLink could not record that. Contact support before booking again.',
    needsReconciliation: true,
    duplicateCancelled: true,
    outcome: sup ? String(sup.outcome) : 'unheard',
  };
}

/**
 * Book one shipment: claim, create, then finalize / fail / settle. The ONLY
 * code that contacts a courier's create endpoint or changes a booking's
 * record. Its dependencies are passed in, so the whole flow runs in tests.
 */
async function bookShipment(
  deps: { supabase: any; fetch: (url: string, init?: RequestInit) => Promise<Response> },
  c: {
    slug: string; orderId: string; provider: 'shadowfax' | 'delhivery';
    token: string; mode: string; shipCost: number | null;
    /** The create request, given the deterministic reference. */
    request: (reference: string) => { url: string; init: RequestInit };
  },
): Promise<{ booked: boolean; reply: Record<string, unknown>; awb?: string }> {
  const name = c.provider === 'shadowfax' ? 'Shadowfax' : 'Delhivery';

  // 1. CLAIM. The only permission to contact the courier. A claim whose answer
  //    was not heard is NOT retried: a second call could not tell our own open
  //    claim from another request's. Nothing has been sent anywhere yet.
  const claim = await askRpc(deps.supabase, 'claim_shipment_attempt', {
    p_store_slug: c.slug, p_order_id: c.orderId, p_courier: c.provider,
  });
  if (!claim) {
    return { booked: false, reply: { error: 'Could not start this booking, so nothing was sent to the courier. Please try again in a moment.' } };
  }
  if (claim.outcome !== 'claimed') {
    return { booked: false, reply: await claimRefused(deps.supabase, c.slug, c.orderId, claim) };
  }
  const attemptId = claim.attempt_id;
  const attemptNo = Number(claim.attempt_no);

  // 2. The reference, from (order, attempt). If it cannot be built, nothing has
  //    been sent, so releasing the claim is provably safe.
  const reference = c.provider === 'shadowfax'
    ? shadowfaxReference(c.orderId, attemptNo)
    : delhiveryReference(c.orderId, attemptNo);
  if (!reference) {
    await askRpc(deps.supabase, 'fail_shipment_attempt', {
      p_attempt_id: attemptId, p_store_slug: c.slug, p_final_status: 'booking reference could not be built',
    });
    return { booked: false, reply: { error: 'Could not prepare this booking, so nothing was sent to the courier.' } };
  }

  // 3. CREATE -- exactly once. It is never retried, whatever it answers.
  const { url, init } = c.request(reference);
  let status = 0;
  let body = '';
  try {
    const res = await deps.fetch(url, init);
    status = Number(res?.status) || 0;
    body = await res.text();
  } catch {
    return { booked: false, reply: bookingUnknown(name, reference) };
  }
  const created: CreateResult = c.provider === 'shadowfax'
    ? classifyShadowfaxCreate(status, body)
    : classifyDelhiveryCreate(status, body);

  // 4a. UNKNOWN: the claim stays OPEN, so this order stays blocked. No fail, no
  //     retry, no new reference.
  if (created.kind === 'unknown') {
    return { booked: false, reply: bookingUnknown(name, reference, created.reason, created.duplicate) };
  }

  // 4b. REJECTED: provably nothing was created, so the claim may be released.
  if (created.kind === 'rejected') {
    const args = {
      p_attempt_id: attemptId, p_store_slug: c.slug,
      p_final_status: (created.reason || 'rejected by the courier').slice(0, 200),
    };
    let failed = await askRpc(deps.supabase, 'fail_shipment_attempt', args);
    if (!failed) failed = await askRpc(deps.supabase, 'fail_shipment_attempt', args);   // exactly one retry
    const released = !!failed && (failed.outcome === 'failed'
      || (failed.outcome === 'attempt_terminal' && failed.end_reason === 'failed'));
    return {
      booked: false,
      reply: released
        ? { error: `${name} could not book this shipment: ${created.reason}` }
        : {
          error: `${name} could not book this shipment: ${created.reason}. This order is locked until support `
            + 'releases it -- please contact support before trying again.',
          needsReconciliation: true,
        },
    };
  }

  // 4c. CREATED: the AWB lands on the attempt and the order together. The
  //     courier is not contacted again; an unheard answer is asked for ONCE
  //     more with identical arguments -- finalize is idempotent.
  const awb = created.awb;
  const args = {
    p_attempt_id: attemptId, p_store_slug: c.slug, p_courier: c.provider,
    p_awb: awb, p_shipping_cost: c.shipCost, p_final_status: created.status,
  };
  let fin = await askRpc(deps.supabase, 'finalize_shipment_attempt', args);
  if (!fin) fin = await askRpc(deps.supabase, 'finalize_shipment_attempt', args);   // exactly one retry
  if (!fin) return { booked: false, reply: finalizeUnheard(name, awb) };

  switch (fin.outcome) {
    case 'finalized':
    case 'already_finalized':
      return { booked: true, awb, reply: { awb, status: created.status } };
    case 'order_awb_conflict':
      return { booked: false, reply: await settleDuplicate(deps, c, name, attemptId, awb, fin.awb) };
    case 'attempt_not_found':
    case 'attempt_terminal':
    case 'courier_mismatch':
    case 'attempt_awb_conflict':
    case 'partial_state_attempt_only':
    case 'partial_state_order_only':
    case 'invalid_awb':
      return { booked: false, reply: finalizeRefused(name, awb, fin.outcome) };
    default:
      return { booked: false, reply: finalizeRefused(name, awb, 'unrecognised') };
  }
}

// Owner-only (PIN-checked): create a Delhivery shipment for an order and store the
// AWB. Does NOT schedule a pickup (that's a separate explicit step) — booking just
// manifests the shipment and gets the tracking number + label.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, hashedPin, orderId, details = {} } = await req.json();
    if (!slug || !hashedPin || !orderId) return json({ error: 'Missing store, PIN, or order' });

    // The courier charge the merchant saw in the booking modal (their real cost for
    // THIS shipment). Stored on the order so Stats → Profit can subtract the actual
    // delivery cost. Null when the estimate wasn't available (falls back to the
    // store's flat "delivery cost / order" in the profit maths).
    const shipCostNum = Number(details.shipping_cost);
    const shipCost = Number.isFinite(shipCostNum) && shipCostNum > 0 ? shipCostNum : null;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // PIN gate through the throttled verifier (pin-bypass-closure-forward.sql). A
    // direct stores.pin comparison here let anyone guess a PIN without limit.
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Incorrect PIN' });
    const { data: store } = await supabase.from('stores').select('config').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });

    // The store's active default courier (owner-selected in Settings).
    const shipCfg = store.config?.shipping || {};
    const activeCourier = String(shipCfg.courier || (shipCfg.shadowfax && !shipCfg.delhivery ? 'shadowfax' : 'delhivery')).toLowerCase();

    const { data: acct } = await supabase
      .from('store_shipping_accounts')
      .select('provider, mode, api_token, pickup_name, pickup_pincode, pickup_phone, pickup_address, pickup_city, pickup_state, default_weight_g, status')
      .eq('store_slug', slug).eq('provider', activeCourier).maybeSingle();
    if (!acct || acct.status !== 'connected' || !acct.api_token) return json({ error: 'Courier not connected' });

    const { data: order } = await supabase
      .from('orders')
      .select('id, awb, courier, customer_name, customer_phone, destination, pincode, total, payment_method, item_count, items')
      .eq('id', orderId).eq('store_slug', slug).maybeSingle();
    if (!order) return json({ error: 'Order not found' });
    // An order that already has a shipment is never booked again here. The
    // courier is read from the row now - it used not to be selected at all, so
    // every Shadowfax parcel was handed a Delhivery tracking link.
    if (order.awb) {
      return json({
        awb: order.awb, alreadyBooked: true, courier: order.courier ?? null,
        trackUrl: trackUrlFor(order.courier, order.awb),
      });
    }
    // The courier reference is built from the order id, so an id that cannot
    // make one is refused here -- locally, before any claim exists.
    if (!orderHex(order.id)) return json({ error: 'This order cannot be booked: its id is not in the expected format.' });

    // Everything bookShipment touches is passed in, so the whole flow is testable.
    const deps = { supabase, fetch: (url: string, init?: RequestInit) => fetch(url, init) };

    // ── Shadowfax booking (isolated; the Delhivery code below is untouched) ──
    if (acct.provider === 'shadowfax') {
      const sItems = Array.isArray(order.items) ? order.items : [];
      const sPick = (a: unknown, b: unknown) => (a !== undefined && a !== null && a !== '' ? a : b);
      const sCOD  = details.payment_mode ? details.payment_mode === 'COD' : order.payment_method === 'cod';

      let sDestPin = String(sPick(details.pin, order.pincode) || '').replace(/\D/g, '');
      if (sDestPin.length !== 6) {
        const sixes = String(sPick(details.add, order.destination) || '').match(/\d{6}/g);
        if (sixes && sixes.length) sDestPin = sixes[sixes.length - 1];
      }
      if (sDestPin.length !== 6) return json({ error: 'No valid 6-digit pincode — add the pincode and retry.' });

      const sWeight = Math.max(50, Math.round(Number(details.weight)) || Number(acct.default_weight_g) || 500);
      const sTotal  = Number(sPick(details.total_amount, order.total)) || 0;
      const sValue  = sTotal || sItems.reduce((n: number, i: any) => n + (Number(i.price) || 0) * (Number(i.qty) || 1), 0) || 1;
      const sCodAmt = sCOD ? (Number(sPick(details.cod_amount, order.total)) || 0) : 0;
      const sBase   = acct.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';

      const pickupObj = {
        name:           toLatin(String(acct.pickup_name || store.config?.businessName || slug)).slice(0, 100),
        contact:        String(acct.pickup_phone || '').replace(/\D/g, '').slice(-10),
        address_line_1: toLatin(String(acct.pickup_address || acct.pickup_name || 'Pickup address')).slice(0, 250),
        city:           acct.pickup_city || '',
        state:          acct.pickup_state || '',
        pincode:        Number(String(acct.pickup_pincode || '').replace(/\D/g, '')),
      };

      // client_order_id is filled in AFTER the claim, from (order id, attempt
      // number) -- see shadowfaxReference. Shadowfax rejects duplicate COIDs; the
      // webhook maps back by AWB, not COID.
      const payload = {
        order_type: 'marketplace',
        order_details: {
          client_order_id: '',
          actual_weight:   sWeight,
          product_value:   Math.round(sValue),
          payment_mode:    sCOD ? 'COD' : 'Prepaid',
          cod_amount:      String(sCodAmt),
          total_amount:    Math.round(sTotal),
          order_service:   'regular',
        },
        customer_details: {
          name:           titleCase(toLatin(String(sPick(details.name, order.customer_name) || ''))).slice(0, 100) || 'Customer',
          contact:        String(sPick(details.phone, order.customer_phone) || '').replace(/\D/g, '').slice(-10),
          address_line_1: toLatin(String(sPick(details.add, order.destination) || '')).slice(0, 250) || 'Address on order',
          city:           '', state: '',
          pincode:        Number(sDestPin),
        },
        pickup_details: pickupObj,
        rts_details:    { ...pickupObj, email: '' },
        product_details: (sItems.length ? sItems : [{ name: 'Order', price: Math.round(sValue), qty: order.item_count || 1 }]).map((i: any) => ({
          sku_name: (toLatin(`${i.name || 'Item'}${i.variant ? ` (${i.variant})` : i.size ? ` (${i.size})` : ''}`).slice(0, 200)) || 'Item',
          price:    Number(i.price) || 0,
          category: 'General',
          additional_details: { quantity: Number(i.qty) || 1 },
        })),
      };

      // Claim, create once, then finalize / fail / settle -- see bookShipment.
      const booked = await bookShipment(deps, {
        slug, orderId: order.id, provider: 'shadowfax', token: acct.api_token,
        mode: String(acct.mode || ''), shipCost,
        request: (reference) => {
          payload.order_details.client_order_id = reference;
          return {
            url: `${sBase}/v3/clients/orders/`,
            init: {
              method: 'POST',
              headers: { Authorization: `Token ${acct.api_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          };
        },
      });
      if (!booked.booked) return json(booked.reply);

      // Creating a marketplace order IS the seller-pickup request — Shadowfax assigns
      // a rider automatically, so there's no separate pickup call (unlike Delhivery).
      return json({ ...booked.reply, trackUrl: null, pickup: { scheduled: true, covered: true } });
    }

    const items = Array.isArray(order.items) ? order.items : [];
    // Include the variant/size (e.g. "(3 x Packet)") like the order card does, so
    // the label carries the full product detail — not just the base name.
    const desc  = items.map((i: any) => {
      const v = i.variant ? ` (${i.variant})` : i.size ? ` (${i.size})` : '';
      return `${i.qty}x ${i.name}${v}`;
    }).join(', ').slice(0, 250) || 'Order';

    // The merchant's edited "details" (from the booking modal) take priority; the
    // order's own data is the fallback.
    const pick = (a: unknown, b: unknown) => (a !== undefined && a !== null && a !== '' ? a : b);
    const isCOD   = details.payment_mode ? details.payment_mode === 'COD' : order.payment_method === 'cod';
    const rawName = pick(details.name, order.customer_name);
    const rawAdd  = pick(details.add,  order.destination);

    // Destination pincode: edited value → stored column → last 6-digit run in address.
    let destPin = String(pick(details.pin, order.pincode) || '').replace(/\D/g, '');
    if (destPin.length !== 6) {
      const sixes = String(rawAdd || '').match(/\d{6}/g);
      if (sixes && sixes.length) destPin = sixes[sixes.length - 1];
    }
    if (destPin.length !== 6) {
      return json({ error: 'No valid 6-digit pincode — add the pincode and retry.' });
    }

    const weight = Math.max(50, Math.round(Number(details.weight)) || Number(acct.default_weight_g) || 500);
    const L = Math.round(Number(details.length))  || 0;
    const B = Math.round(Number(details.breadth)) || 0;
    const Hh = Math.round(Number(details.height))  || 0;

    const shipment: Record<string, unknown> = {
      name:         titleCase(toLatin(String(rawName || ''))).slice(0, 60) || 'Customer',
      add:          toLatin(String(rawAdd || '')).slice(0, 250) || 'Address on order',
      pin:          destPin,
      phone:        String(pick(details.phone, order.customer_phone) || '').replace(/\D/g, '').slice(-10),
      // Short but UNIQUE order reference. A long UUID makes the label's order
      // barcode so wide it overlaps/garbles the return address; but Delhivery
      // rejects duplicate refs ("Duplicate order id"). Filled in AFTER the claim,
      // from (order id, attempt number) -- see delhiveryReference: the same 8
      // characters, [0-9A-Z], still a tidy label.
      order:        '',
      payment_mode: isCOD ? 'COD' : 'Prepaid',
      cod_amount:   isCOD ? Number(pick(details.cod_amount, order.total)) || 0 : 0,
      total_amount: Number(pick(details.total_amount, order.total)) || 0,
      weight:       weight,
      quantity:     Number(order.item_count) || 1,
      products_desc: toLatin(desc).slice(0, 250) || 'Order',
      seller_name:  toLatin(store.config?.businessName || slug),
      country:      'India',
      ...(L && B && Hh ? { shipment_length: L, shipment_width: B, shipment_height: Hh } : {}),
    };

    // Claim, create once, then finalize / fail / settle -- see bookShipment.
    const booked = await bookShipment(deps, {
      slug, orderId: order.id, provider: 'delhivery', token: acct.api_token,
      mode: String(acct.mode || ''), shipCost,
      request: (reference) => {
        shipment.order = reference;
        return {
          url: `${BASE}/api/cmu/create.json`,
          init: {
            method: 'POST',
            headers: { Authorization: `Token ${acct.api_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'format=json&data=' + encodeURIComponent(JSON.stringify({
              shipments: [shipment],
              pickup_location: { name: acct.pickup_name || (store.config?.businessName || slug) },
            })),
          },
        };
      },
    });
    // No pickup is scheduled unless the parcel is booked AND recorded as ours.
    if (!booked.booked) return json(booked.reply);
    const awb = booked.awb;

    // ── Auto-schedule a pickup so a courier actually comes (else it just sits at
    // "Ready to Ship"). Delhivery allows only ONE open pickup per location per day,
    // so the first booking of the day schedules it and later ones are "covered".
    let pickup: Record<string, unknown> = { scheduled: false };
    try {
      const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
      const day = new Date(nowIST);
      let time = '15:00:00';
      if (nowIST.getUTCHours() >= 13) { day.setUTCDate(day.getUTCDate() + 1); time = '12:00:00'; }
      const date = day.toISOString().slice(0, 10);
      const pr = await fetch(`${BASE}/fm/request/new/`, {
        method: 'POST',
        headers: { Authorization: `Token ${acct.api_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup_location: acct.pickup_name, pickup_date: date, pickup_time: time, expected_package_count: 1 }),
      });
      const pd = await pr.json().catch(() => ({}));
      const blob = JSON.stringify(pd).toLowerCase();
      if (pd?.pickup_id) {
        pickup = { scheduled: true, id: pd.pickup_id, date };
      } else if (/exist|already|pending|open pickup|duplicate/.test(blob)) {
        pickup = { scheduled: true, covered: true, date };   // today's pickup already booked → this parcel is included
      } else {
        pickup = { scheduled: false, reason: pd?.error || pd?.pr_exist || blob.slice(0, 140) };
      }
    } catch {
      pickup = { scheduled: false, reason: 'pickup request failed' };
    }

    return json({ ...booked.reply, trackUrl: `https://www.delhivery.com/track/package/${awb}`, pickup });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
