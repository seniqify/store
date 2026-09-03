import { classifyBucket, prettyStatus } from './deliveryStatus';

/**
 * Buyer-facing view of where an order has got to.
 *
 * The seller's Delivery board already folds every courier's wording into five
 * buckets (classifyBucket); this reuses that vocabulary so buyer and seller are
 * never looking at different truths about the same parcel.
 *
 * The one rule here: NEVER show progress we don't have. A store that doesn't
 * ship through PocketLink produces no courier events at all, so the timeline
 * stops after "confirmed" and says why (`note`), instead of leaving ghost steps
 * that sit unticked forever. A tracker that pretends is worse than no tracker —
 * it generates exactly the "where is my order?" message this page exists to stop.
 */

// Hero tones map to the same colours as BUCKET_META on the seller board.
const TONE = {
  emerald: { bg: 'linear-gradient(160deg,#059669,#047857)' },
  amber:   { bg: 'linear-gradient(160deg,#d97706,#b45309)' },
  indigo:  { bg: 'linear-gradient(160deg,#4f46e5,#4338ca)' },
  blue:    { bg: 'linear-gradient(160deg,#2563eb,#1d4ed8)' },
  red:     { bg: 'linear-gradient(160deg,#dc2626,#b91c1c)' },
  gray:    { bg: 'linear-gradient(160deg,#6b7280,#4b5563)' },
};

export function heroStyle(tone) {
  return { background: (TONE[tone] || TONE.emerald).bg };
}

/**
 * @param {object} o  the `order` object from get_order_by_token
 * @returns {{hero:{tone,icon,title,sub}, steps:Array, note:string|null, cod:boolean}}
 */
export function buildTimeline(o = {}) {
  const shipped   = Boolean(o.awb);
  const bucket    = shipped ? classifyBucket({ shipment_status: o.shipmentStatus }) : null;
  const cancelled = o.status === 'cancelled';
  const delivered = o.status === 'delivered' || bucket === 'delivered';
  const cod       = String(o.paymentMethod || '').toLowerCase() === 'cod' && !o.paid;

  // ── Steps ────────────────────────────────────────────────────────────────
  const steps = [
    { key: 'placed',    label: 'Order placed', at: o.placedAt,    state: 'done' },
    { key: 'confirmed', label: o.confirmedAt ? 'You confirmed' : 'Confirm your order',
      at: o.confirmedAt, state: o.confirmedAt ? 'done' : 'todo' },
  ];

  if (shipped) {
    steps.push({
      key: 'shipped', label: 'Packed & shipped', state: 'done',
      hint: o.courier ? courierName(o.courier) : null,
    });
    if (bucket === 'attention') {
      steps.push({ key: 'issue', label: prettyStatus(o.shipmentStatus) || 'Delivery issue',
                   state: 'issue' });
    } else {
      steps.push({ key: 'transit', label: 'In transit',
                   state: bucket === 'transit' ? 'now'
                        : (bucket === 'ofd' || delivered) ? 'done' : 'todo' });
      steps.push({ key: 'ofd', label: 'Out for delivery',
                   state: bucket === 'ofd' ? 'now' : delivered ? 'done' : 'todo' });
    }
    steps.push({ key: 'delivered', label: 'Delivered', state: delivered ? 'done' : 'todo' });
  }

  // ── Hero ─────────────────────────────────────────────────────────────────
  let hero;
  if (cancelled) {
    hero = { tone: 'gray', icon: 'x', title: 'Order cancelled',
             sub: 'Please contact the shop if this looks wrong.' };
  } else if (delivered) {
    hero = { tone: 'blue', icon: 'box', title: 'Delivered',
             sub: 'Thanks for shopping with us!' };
  } else if (bucket === 'attention') {
    hero = { tone: 'red', icon: 'alert', title: prettyStatus(o.shipmentStatus) || 'Needs attention',
             sub: 'The shop is sorting this out — message them if it’s urgent.' };
  } else if (bucket === 'ofd') {
    hero = { tone: 'indigo', icon: 'pin', title: 'Arriving today',
             sub: 'Your order is out for delivery.' };
  } else if (bucket === 'transit') {
    hero = { tone: 'amber', icon: 'truck', title: 'On the way',
             sub: 'Your order has left the shop.' };
  } else if (shipped) {
    hero = { tone: 'emerald', icon: 'box', title: 'Packed & ready',
             sub: 'Waiting for the courier to pick it up.' };
  } else if (o.confirmedAt) {
    hero = { tone: 'emerald', icon: 'check', title: 'Order confirmed',
             sub: 'The shop is preparing it.' };
  } else {
    hero = { tone: 'emerald', icon: 'check', title: 'Order placed',
             sub: 'Tap confirm below so the shop can start packing.' };
  }

  // The honest stop — say why there is nothing more to show.
  const note = (!shipped && !cancelled && !delivered)
    ? 'This shop arranges delivery themselves, so there are no courier updates to show here. They’ll message you directly.'
    : null;

  return { hero, steps, note, cod, delivered, cancelled, shipped };
}

/** Courier slug → the name a customer would recognise. */
export function courierName(slug) {
  const k = String(slug || '').toLowerCase();
  if (k.includes('delhivery')) return 'Delhivery';
  if (k.includes('shadowfax')) return 'Shadowfax';
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : '';
}
