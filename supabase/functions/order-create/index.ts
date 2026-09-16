// order-create — SHADOW MODE ONLY.
//
// What this does today: takes the same request the real endpoint will take,
// prices it from the store's own configuration, compares the result against the
// order the browser has ALREADY written, and records the difference. It creates
// nothing, changes nothing and returns nothing but { ok: true }.
//
// What it is for: every mismatch it records is either a drift bug in the new
// engine or a real forged price on the live site. Both need to be understood
// before checkout is switched over, and neither can be discovered by reasoning.
//
// NOT ENABLED HERE, on purpose (each is its own later step):
//   * checkout still writes orders itself — this is never in that path
//   * create_order_secure is never called
//   * the rate limits are measured, not enforced
//   * price-bearing request bodies are logged, not refused
//
// Auth: deployed with --no-verify-jwt, like the storefront's other endpoints.
// The service role key stays server-side and is never returned in any shape.
import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { priceOrder, requestFingerprint, ENGINE_VERSION, MAX_LINES, MAX_QTY_PER_LINE }
  from '../../../shared/pricing.mjs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// The only shapes this endpoint will ever answer with. No totals, no lines, no
// coupon detail, no catalog: returning a quote would make a public price oracle
// out of an endpoint whose whole purpose is to stop prices being guessable.
const OK       = { ok: true };
const BAD_REQ  = { ok: false, error: 'invalid_request' };

/** Financial fields a browser must never send. Their presence means either a
 *  stale bundle or a forged request; in shadow mode we record which, and once
 *  checkout is switched over the request is refused outright. */
const PRICE_FIELDS = [
  'price', 'mrp', 'total', 'subtotal', 'tax', 'shipping', 'packaging',
  'codFee', 'cod_fee', 'discount', 'gstRate', 'taxInclusive', 'cost', 'stock',
];

function priceFieldsPresent(body: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || v === null || typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (PRICE_FIELDS.includes(k)) found.add(k);
      walk(child, depth + 1);
    }
  };
  walk(body, 0);
  return [...found].sort();
}

/** The request, reduced to the fields the engine is allowed to see. Anything
 *  else the caller sent is dropped here and never reaches pricing. */
function allowlist(body: Record<string, any>) {
  const lines = Array.isArray(body?.lines) ? body.lines.slice(0, MAX_LINES) : [];
  return {
    slug:          String(body?.slug ?? ''),
    mode:          String(body?.mode ?? 'order'),
    paymentMethod: String(body?.paymentMethod ?? ''),
    couponCode:    body?.couponCode == null ? null : String(body.couponCode),
    notes:         String(body?.notes ?? ''),
    customer: {
      name:        String(body?.customer?.name ?? ''),
      phone:       String(body?.customer?.phone ?? ''),
      destination: String(body?.customer?.destination ?? ''),
      pincode:     String(body?.customer?.pincode ?? ''),
    },
    lines: lines.map((l: any) => ({
      productId: String(l?.productId ?? ''),
      variant:   l?.variant == null ? null : String(l.variant),
      extras:    Array.isArray(l?.extras) ? l.extras.map((e: any) => String(e ?? '')) : [],
      qty:       Math.min(Math.trunc(Number(l?.qty)) || 0, MAX_QTY_PER_LINE),
    })),
  };
}

/** Rate limits, MEASURED not enforced. Returns the limit that would have fired,
 *  so the thresholds can be set from real traffic instead of guesswork. */
async function wouldLimit(
  supabase: ReturnType<typeof createClient>, slug: string, ip: string | null,
): Promise<string | null> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  try {
    const { count: perStore } = await supabase
      .from('order_pricing_shadow')
      .select('id', { count: 'exact', head: true })
      .eq('store_slug', slug)
      .gte('created_at', since);
    if ((perStore ?? 0) >= 60) return 'store_10m';
    if (!ip) return null;
    return null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return json(BAD_REQ, 400);

    const body = raw as Record<string, any>;
    const req0 = allowlist(body);
    if (!req0.slug || req0.lines.length === 0) return json(BAD_REQ, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The store's own configuration — the only source of prices, fees, tax
    // settings and coupons. Nothing from the request is used as a value.
    const { data: store } = await supabase
      .from('stores').select('config').eq('slug', req0.slug).maybeSingle();
    if (!store?.config) return json(BAD_REQ, 400);

    const quote = priceOrder(store.config, req0);
    const fingerprint = await requestFingerprint(req0);

    // What the browser actually wrote, read from the SAVED ROW — never from the
    // request. Both sides of this comparison are authoritative.
    const observedId = typeof body?.observedOrderId === 'string' ? body.observedOrderId : null;
    let dbTotal: number | null = null;
    if (observedId) {
      const { data: row } = await supabase
        .from('orders').select('total').eq('id', observedId).eq('store_slug', req0.slug).maybeSingle();
      dbTotal = row ? Number(row.total) : null;
    }

    const serverTotal = quote.ok ? Number(quote.totals.total) : null;
    const delta = serverTotal != null && dbTotal != null ? serverTotal - dbTotal : null;

    const reasons: Record<string, unknown> = {
      quote: quote.ok ? 'ok' : quote.reason,
      coupon: quote.ok ? quote.coupon.reason : null,
      priceFieldsSent: priceFieldsPresent(body),
      fingerprintLen: fingerprint.length,
      engine: ENGINE_VERSION,
    };

    // Observation only. No product names, no costs, no margins, no coupon
    // definitions, no config — see the table comment in the migration.
    await supabase.from('order_pricing_shadow').insert({
      store_slug: req0.slug,
      order_id: observedId,
      server_total: serverTotal,
      db_total: dbTotal,
      delta,
      components: quote.ok ? quote.totals : null,
      reasons,
      line_count: req0.lines.length,
      idem_key_hash: body?.idempotencyKey ? await sha256Short(String(body.idempotencyKey)) : null,
      would_limit: await wouldLimit(supabase, req0.slug, callerIp(req)),
    }).then(({ error }) => {
      if (error) console.error('shadow log refused:', error.message);
    });

    return json(OK);
  } catch (err) {
    // Never leak an internal message to a public caller.
    console.error('order-create shadow error:', (err as Error)?.message);
    return json(BAD_REQ, 400);
  }
});

function callerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || null;
}

/** A short hash of the idempotency key: enough to spot a replay in the log,
 *  not enough to replay one. */
async function sha256Short(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
