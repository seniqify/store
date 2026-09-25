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

// Owner-only (PIN-checked) shipment ops on a booked order:
//   label  → return the packing-slip PDF link (print)
//   track  → current Delhivery status
//   cancel → cancel at the courier, then record it through
//            cancel_current_shipment (see cancelShipment below)
/** Delhivery reports a return as StatusType "RT"; keep that in the saved text. */
function delhiveryStatusText(status: any): string {
  const raw = String(status?.Status || '');
  if (!raw) return '';
  return status?.StatusType === 'RT' && !/rto|return/i.test(raw) ? `RTO ${raw}` : raw;
}

// ── cancellation ────────────────────────────────────────────────────────────
//
// Cancelling is the one shipment operation that destroys evidence: it clears
// the order's AWB and closes the shipment's ledger attempt, both for good. So
// nothing is written unless all three of these hold, in this order:
//
//   1. the ORDER's own evidence says the shipment has not already ended.
//      Checked BEFORE the courier is contacted, because the ledger alone
//      cannot be trusted for this -- it is not a live mirror of courier status
//      (B3 is not live), and 22 of its open attempts already read delivered /
//      returned / lost on their orders.
//   2. the courier EXPLICITLY confirms the cancellation. A message that merely
//      mentions "cancel" is not confirmation: "Order cannot be cancelled" does.
//   3. cancel_current_shipment makes the only write, atomically -- it closes
//      the attempt and clears the pointer together, or refuses and writes
//      nothing.
//
// There is no other path that clears orders.awb on a cancellation, and no
// fallback write when the RPC refuses.

/**
 * Has this shipment already ended, by the ORDER's own evidence? PURE.
 *
 * Read exactly as B1's derivation reads it (shipment-attempts-forward.sql):
 * shipment_outcome first; otherwise the raw courier status -- the return
 * family, then lost, then delivered guarded against "undeliver" and "not
 * deliver". So "RTO Delivered" is a return and "Undelivered" is not a
 * delivery. B1's cancellation branch is deliberately left out: a courier-side
 * "Cancelled" status is not a reason to refuse a cancellation.
 */
function terminalEvidence(
  order: { shipment_outcome?: unknown; shipment_status?: unknown } | null | undefined,
): 'delivered' | 'returned' | 'lost' | null {
  const outcome = order?.shipment_outcome;
  if (outcome === 'delivered') return 'delivered';
  if (outcome === 'returned') return 'returned';
  if (outcome === 'lost') return 'lost';
  const st = String(order?.shipment_status ?? '');
  if (/(rto|rts|return)/i.test(st)) return 'returned';
  if (/\blost\b/i.test(st)) return 'lost';
  if (/\bdelivered\b/i.test(st) && !/(undeliver|not deliver)/i.test(st)) return 'delivered';
  return null;
}

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
 * A short reason the courier gave, to show the merchant. PURE.
 * Only named message fields are read -- never the whole body -- and the result
 * is bounded, so no provider payload travels further than this.
 */
function providerSays(bodyText: string): string {
  const text = String(bodyText ?? '');
  let pick = '';
  try {
    const b = JSON.parse(text);
    if (b && typeof b === 'object') {
      for (const k of ['responseMsg', 'remark', 'rmk', 'error', 'message']) {
        if (typeof b[k] === 'string' && b[k].trim()) { pick = b[k]; break; }
      }
    }
  } catch {
    const m = text.match(/<(remark|error|message)>\s*([^<]{1,300}?)\s*<\/\1>/i);
    if (m) pick = m[2];
  }
  return pick.replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** The order's AWB as the database holds it now. `known: false` = could not read. */
async function pointerNow(
  supabase: any, slug: string, orderId: string,
): Promise<{ known: boolean; awb: string | null }> {
  try {
    const { data, error } = await supabase.from('orders')
      .select('awb').eq('id', orderId).eq('store_slug', slug).maybeSingle();
    if (error || !data) return { known: false, awb: null };
    const awb = data.awb === null || data.awb === undefined ? '' : String(data.awb).trim();
    return { known: true, awb: awb || null };
  } catch {
    return { known: false, awb: null };
  }
}

/** The courier cancelled; PocketLink's record could not be made to match. PURE. */
function recordNotUpdated(courierName: string, outcome: string): Record<string, unknown> {
  return {
    cancelled: false,
    courierCancelled: true,
    needsReconciliation: true,
    outcome,
    error: `${courierName} confirmed the cancellation, but PocketLink could not update this order to match, `
      + 'so the order still shows the shipment. Refresh it, and contact support before booking this order again.',
  };
}

/**
 * The merchant's answer once the courier HAS confirmed and
 * cancel_current_shipment has replied. PURE.
 *
 * Every outcome the RPC can return is named here. Exactly three are success.
 * Each refusal wrote nothing, and nothing is written in its place: the parcel
 * is cancelled at the courier while PocketLink's record still shows it, and a
 * person has to reconcile that. An outcome this code does not know is never
 * treated as success.
 */
function cancelOutcomeReply(outcome: unknown, courierName: string): Record<string, unknown> {
  switch (outcome) {
    case 'cancelled':                    // attempt closed and pointer cleared
    case 'cancelled_pointer_was_clear':  // attempt closed; the pointer was already clear
    case 'already_cancelled':            // a repeat of a cancellation that already landed
      return { cancelled: true, outcome };
    case 'shipment_already_terminal':
    case 'attempt_state_mismatch':
    case 'attempt_not_found':
    case 'courier_mismatch':
    case 'awb_mismatch':
    case 'order_not_found':
    case 'invalid_awb':
    case 'invalid_courier':
    case 'transition_race':
      return recordNotUpdated(courierName, String(outcome));
    default:
      return recordNotUpdated(courierName, 'unrecognised');
  }
}

/**
 * Cancel an order's current shipment -- the ONLY code that changes anything on
 * a cancellation. Its dependencies are passed in, so the whole flow runs in
 * tests against fakes.
 */
async function cancelShipment(
  deps: { supabase: any; fetch: (url: string, init?: RequestInit) => Promise<Response> },
  c: {
    slug: string; orderId: string; provider: 'shadowfax' | 'delhivery'; awb: string;
    token: string; mode: string;
    order: { shipment_outcome?: unknown; shipment_status?: unknown } | null | undefined;
  },
): Promise<Record<string, unknown>> {
  const { awb } = c;
  const name = c.provider === 'shadowfax' ? 'Shadowfax' : 'Delhivery';

  // 1. The order's own evidence -- before the courier is contacted.
  const ended = terminalEvidence(c.order);
  if (ended) {
    return {
      cancelled: false,
      terminal: ended,
      error: ended === 'delivered' ? 'This shipment was already delivered, so it cannot be cancelled.'
        : ended === 'returned' ? 'This shipment has already been returned, so it cannot be cancelled.'
        : `This shipment is marked lost, so it cannot be cancelled here. Raise it with ${name}.`,
    };
  }

  // 2. The courier, which must say yes -- explicitly.
  let httpOk = false;
  let body = '';
  try {
    const res = c.provider === 'shadowfax'
      ? await deps.fetch(`${c.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api'}/v3/clients/orders/cancel/`, {
          method: 'POST',
          headers: { Authorization: `Token ${c.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: awb }),
        })
      : await deps.fetch(`${BASE}/api/p/edit`, {
          method: 'POST',
          headers: { Authorization: `Token ${c.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ waybill: String(awb), cancellation: 'true' }),
        });
    httpOk = !!res?.ok;
    body = await res.text();
  } catch {
    return {
      cancelled: false,
      courierUnreachable: true,
      error: `${name} could not be reached, or did not answer, so nothing was changed here. `
        + `The shipment may or may not be cancelled -- check your ${name} panel before trying again.`,
    };
  }
  const confirmed = c.provider === 'shadowfax'
    ? shadowfaxCancelConfirmed(httpOk, body)
    : delhiveryCancelConfirmed(httpOk, body);
  if (!confirmed) {
    const said = providerSays(body);
    return {
      cancelled: false,
      courierConfirmed: false,
      error: `${name} did not confirm the cancellation, so nothing was changed here.`
        + (said ? ` ${name} said: "${said}".` : '')
        + ` The shipment is probably still active -- check your ${name} panel.`,
    };
  }

  // 3. The only write.
  let rpc: { data: any; error: unknown };
  try {
    rpc = await deps.supabase.rpc('cancel_current_shipment', {
      p_store_slug:   c.slug,
      p_order_id:     c.orderId,
      p_courier:      c.provider,
      p_awb:          awb,
      p_final_status: 'Cancelled',
    });
  } catch (e) {
    rpc = { data: null, error: e };
  }
  if (rpc?.error || !rpc?.data) {
    // An error is a failure to HEAR the answer, not proof there was none. Read
    // the order back: a cleared pointer means the write landed. Nothing is
    // written here either way.
    const now = await pointerNow(deps.supabase, c.slug, c.orderId);
    if (now.known && now.awb === null) return { cancelled: true, outcome: 'recorded' };
    return recordNotUpdated(name, now.known ? 'unheard_not_recorded' : 'unheard');
  }
  return cancelOutcomeReply(rpc.data?.outcome, name);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, slug, hashedPin, orderId } = await req.json();
    if (!slug || !hashedPin || !orderId) return json({ error: 'Missing store, PIN, or order' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // PIN gate through the throttled verifier (pin-bypass-closure-forward.sql). A
    // direct stores.pin comparison here let anyone guess a PIN without limit.
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Incorrect PIN' });

    const { data: order } = await supabase.from('orders')
      .select('awb, courier, shipment_status, shipment_outcome').eq('id', orderId).eq('store_slug', slug).maybeSingle();
    const bookedCourier = String(order?.courier || 'delhivery').toLowerCase();
    const { data: acct } = await supabase.from('store_shipping_accounts')
      .select('provider, api_token, mode').eq('store_slug', slug).eq('provider', bookedCourier).maybeSingle();
    const token = acct?.api_token;
    const awb = order?.awb;
    if (!token) return json({ error: 'Shipping not connected' });
    if (!awb) return json({ error: 'This order has no shipment yet' });
    const isShadowfax = order?.courier === 'shadowfax' || acct?.provider === 'shadowfax';

    // ── cancel: ONE path for both couriers, behind all three gates ──
    if (action === 'cancel') {
      return json(await cancelShipment(
        { supabase, fetch: (url: string, init?: RequestInit) => fetch(url, init) },
        {
          slug, orderId, awb: String(awb).trim(), token, order,
          provider: isShadowfax ? 'shadowfax' : 'delhivery',
          mode: String(acct?.mode || ''),
        },
      ));
    }

    // ── Shadowfax ops (the Delhivery code below is untouched) ──
    if (isShadowfax) {
      const sBase = acct?.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';
      if (action === 'track') {
        // Live status + full hub-by-hub journey via the v4 tracking API. Returns a
        // normalised timeline the Delivery board renders in-app (no courier login).
        const tr = await fetch(`${sBase}/v4/clients/orders/${awb}/track/`, { headers: { Authorization: `Token ${token}` } });
        const td = await tr.json().catch(() => ({}));
        const od = td?.order_details || {};
        const events = Array.isArray(td?.tracking_details) ? td.tracking_details : [];
        const timeline = events.map((e: any) => ({
          code:   String(e?.status_id || '').toLowerCase(),
          label:  e?.status || '',
          place:  e?.location || '',
          ts:     e?.created || '',
          remarks: e?.remarks || '',
        }));
        const st = od.status_display || od.status || order?.shipment_status || 'Booked';
        if (od.status_display) await supabase.from('orders').update({ shipment_status: st }).eq('id', orderId).eq('store_slug', slug);
        // NDR reason: if the latest scan is an attempt/exception code, surface its remark.
        const last = events[events.length - 1] || {};
        const lastCode = String(last?.status_id || '').toLowerCase();
        const ndrCodes = ['nc', 'undelivered', 'cnr', 'npr', 'ud', 'customer_not_available', 'reattempt', 'address_issue', 'rto', 'rto_initiated'];
        const ndr = ndrCodes.some((c) => lastCode.includes(c)) ? (last?.remarks || st) : null;

        // Proof of delivery — only fetchable once delivered / returned-to-seller.
        // Gives who received it (name + contact) and a signature/photo report link.
        let pod = null;
        if (/deliver|rts_d/i.test(`${st} ${lastCode}`)) {
          try {
            const pr = await fetch(`${sBase}/v1/clients/pod_details/`, {
              method: 'POST',
              headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ awb_numbers: [awb] }),
            });
            const pd = await pr.json().catch(() => ({}));
            const rec = pd?.pod_details?.[awb];
            if (rec) {
              const clean = (v: unknown) => (v && v !== 'None' && v !== 'null' ? String(v) : null);
              const urls = String(rec.recipient_signature || '').match(/https?:\/\/[^\s'"\]]+/g) || [];
              pod = {
                name:    clean(rec.recipient_name),
                contact: clean(rec.recipient_contact),
                by:      clean(rec.recipient),        // "CUSTOMER" etc.
                proof:   urls,
              };
            }
          } catch { /* POD is a nicety — never block tracking on it */ }
        }

        return json({
          status: st,
          timeline,
          rider: od.rider_name ? { name: od.rider_name, phone: od.rider_contact || '' } : null,
          promisedDate: od.promised_delivery_date || null,
          customerTrackUrl: od.customer_track_url || null,
          ndrReason: ndr,
          pod,
          trackUrl: null,
        });
      }
      if (action === 'label')  return json({ error: 'Shadowfax doesn’t need a printed label — the pickup rider carries it.' });
      return json({ error: 'Unknown action' });
    }

    const headers = { Authorization: `Token ${token}` };

    if (action === 'label') {
      const r = await fetch(`${BASE}/api/p/packing_slip?wbns=${awb}&pdf=true&pdf_size=4R`, { headers });
      const d = await r.json().catch(() => ({}));
      const link = d?.packages?.[0]?.pdf_download_link || d?.pdf_download_link || null;
      if (!link) return json({ error: 'Label not ready yet — try again in a moment.' });
      return json({ labelUrl: link });
    }

    if (action === 'track') {
      const r = await fetch(`${BASE}/api/v1/packages/json/?waybill=${awb}`, { headers });
      const d = await r.json().catch(() => ({}));
      const shp  = d?.ShipmentData?.[0]?.Shipment || {};
      const st   = delhiveryStatusText(shp?.Status) || null;
      const inst = shp?.Status?.Instructions || '';
      const scans = Array.isArray(shp?.Scans) ? shp.Scans : [];
      const timeline = scans.map((s: any) => {
        const sc = s?.ScanDetail || {};
        return {
          code:   String(sc?.StatusCode || '').toLowerCase(),
          label:  sc?.Scan || '',
          place:  sc?.ScannedLocation || '',
          ts:     sc?.ScanDateTime || '',
          remarks: sc?.Instructions || '',
        };
      });
      if (st) await supabase.from('orders').update({ shipment_status: st }).eq('id', orderId).eq('store_slug', slug);
      const ndr = /pending|undeliver|not deliver|exception|\brto\b|address|refus|held/i.test(`${st} ${inst}`) ? (inst || st) : null;
      return json({
        status: st,
        instructions: inst,
        timeline,
        rider: null,
        promisedDate: shp?.ExpectedDeliveryDate || null,
        customerTrackUrl: null,
        ndrReason: ndr,
        trackUrl: `https://www.delhivery.com/track/package/${awb}`,
      });
    }

    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
