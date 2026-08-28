// Shared delivery-status vocabulary for the Delivery board.
//
// `shipment_status` on an order is a free-form string that differs by courier and
// by source (Shadowfax stores codes like "nc"/"ofd" *and* display strings like
// "Not Contactable"; Delhivery stores "Manifested"/"In Transit"/"Delivered"/…).
// classifyBucket() folds all of that into five operational buckets, most-urgent
// first, so the board can group any courier's shipments the same way.

export const BUCKETS = ['attention', 'ofd', 'transit', 'pickup', 'delivered'];

// Cancelled shipments clear their AWB, so they don't reach the board; kept here
// only for completeness / pretty labels.
export const BUCKET_META = {
  attention: { label: 'Needs attention',  stripe: '#dc2626', tone: 'red',
               chip: 'bg-red-100 text-red-700',       soft: 'bg-red-50 text-red-700 border-red-100' },
  ofd:       { label: 'Out for delivery',  stripe: '#4f46e5', tone: 'indigo',
               chip: 'bg-indigo-100 text-indigo-700', soft: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  transit:   { label: 'In transit',        stripe: '#d97706', tone: 'amber',
               chip: 'bg-amber-100 text-amber-700',   soft: 'bg-amber-50 text-amber-700 border-amber-100' },
  pickup:    { label: 'Awaiting pickup',   stripe: '#059669', tone: 'emerald',
               chip: 'bg-emerald-100 text-emerald-700', soft: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  delivered: { label: 'Delivered',         stripe: '#2563eb', tone: 'blue',
               chip: 'bg-blue-100 text-blue-700',     soft: 'bg-blue-50 text-blue-700 border-blue-100' },
  cancelled: { label: 'Cancelled',         stripe: '#9ca3af', tone: 'gray',
               chip: 'bg-gray-100 text-gray-500',     soft: 'bg-gray-50 text-gray-500 border-gray-100' },
};

/** Fold a courier status string into one operational bucket. */
export function classifyBucket(order) {
  const raw = String(order?.shipment_status || '').toLowerCase().trim();
  if (/cancel/.test(raw)) return 'cancelled';
  // "delivered" but never "undelivered" (\b stops the match inside undelivered)
  if (/\bdelivered\b/.test(raw)) return 'delivered';
  // NDR / exception / return — anything that needs the owner to act
  if (/not contactable|\bnc\b|undeliver|not deliver|unreachable|reattempt|re-attempt|not available|\bcnr\b|\bnpr\b|address|refus|failed|\bhold\b|held|\bpending\b|exception|\brto\b|return to origin|returned|lost|\bnpr\b/.test(raw)) return 'attention';
  // out for delivery (Delhivery calls it "Dispatched")
  if (/out for deliver|\bofd\b|assigned for deliver|dispatch/.test(raw)) return 'ofd';
  // pickup phase — booked, not yet on the road
  if (/\bnew\b|manifest|seller pickup|out for pickup|\bofp\b|not picked|awaiting pickup|scheduled|assigned for seller/.test(raw)) return 'pickup';
  if (!raw) return 'pickup';
  // everything in between (picked / bag in transit / received at hub / …)
  return 'transit';
}

const NICE = {
  new: 'Booked', manifested: 'Booked', item_manifested: 'In transit',
  ofp: 'Out for pickup', assigned_for_seller_pickup: 'Pickup assigned',
  picked: 'Picked up', recd_at_rev_hub: 'Reached hub', bag_in_transit: 'In transit',
  bag_received: 'Reached hub', bag_received_at_via: 'Reached hub',
  recd_at_fwd_dc: 'Reached hub', recd_at_fwd_hub: 'Reached hub',
  assigned_for_delivery: 'Out for delivery', ofd: 'Out for delivery', dispatched: 'Out for delivery',
  delivered: 'Delivered', nc: 'Not contactable', undelivered: 'Undelivered',
  cnr: 'Not reachable', npr: 'Payment not ready', ud: 'Undelivered',
  rto: 'Return to origin', rto_initiated: 'Return started', cancelled: 'Cancelled',
  pending: 'Attempt failed', 'in transit': 'In transit',
};

/** Turn a raw code/status into a human label ("bag_in_transit" → "In transit"). */
export function prettyStatus(raw) {
  const key = String(raw || '').toLowerCase().trim();
  if (!key) return 'Booked';
  if (NICE[key]) return NICE[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Courier display + chip style. */
export function courierInfo(courier) {
  const c = String(courier || 'delhivery').toLowerCase();
  if (c === 'shadowfax') return { key: 'shadowfax', name: 'Shadowfax', chip: 'bg-orange-100 text-orange-700' };
  if (c === 'local')     return { key: 'local',     name: 'Delivery boy', chip: 'bg-emerald-100 text-emerald-700' };
  return { key: 'delhivery', name: 'Delhivery', chip: 'bg-indigo-100 text-indigo-700' };
}
