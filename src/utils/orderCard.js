/**
 * The Orders card's "one next step" model (founder-approved mockup, 2026-10-05).
 * Pure; tested in tests/order-card.test.mjs.
 *
 * The shop no longer moves an order along by hand (no "Accept", no "Out for
 * delivery", no "Send confirmation"). Where an order stands is READ from what
 * actually happened:
 *   - the buyer tapped Confirm on WhatsApp (customer_confirmed_at) or paid;
 *   - a courier booking (awb) and the courier's own status, which the
 *     orders_payment_automation trigger turns into delivered / returned -- and
 *     a delivered COD order into paid;
 *   - the shop's own delivery boy (status 'dispatched', then 'delivered').
 * Where the shipment and the money stand come from the canonical helpers
 * (shipmentState, paymentLabelState), never re-derived here.
 */
import { shipmentState } from './commerceMetrics.js';
import { paymentLabelState } from './ordersView.js';
import { classifyBucket, prettyStatus, courierInfo } from './deliveryStatus.js';

const lower = (v) => String(v ?? '').toLowerCase().trim();
const isCod = (o) => lower(o?.payment_method) === 'cod';

/** The list's tabs, in order. Returned and Cancelled show only when they have rows. */
export const STAGE_TABS = Object.freeze([
  { key: 'to_ship',    label: 'To ship' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'delivered',  label: 'Delivered' },
  { key: 'returned',   label: 'Returned' },
  { key: 'cancelled',  label: 'Cancelled' },
]);

/**
 * Where one order stands:
 *   to_ship     a real order nobody has sent yet
 *   not_paid    chose Pay Online and left before paying -- not a sale yet
 *   courier     booked with a courier (on its way, or a courier-side problem)
 *   with_rider  handed to the shop's own delivery boy
 *   delivered   delivered (courier said so, or the shop marked it)
 *   returned    came back (or lost)
 *   cancelled   cancelled by the shop
 */
export function orderStage(o) {
  if (o?.status === 'cancelled') return 'cancelled';
  const ship = shipmentState(o);
  if (ship === 'returned') return 'returned';
  if (ship === 'delivered') return 'delivered';
  if (paymentLabelState(o) === 'incomplete') return 'not_paid';
  if (o?.awb) return 'courier';
  if (o?.status === 'dispatched') return 'with_rider';
  return 'to_ship';
}

/** Which tab a stage lives under. */
export function stageTab(stage) {
  if (stage === 'not_paid') return 'to_ship';
  if (stage === 'courier' || stage === 'with_rider') return 'on_the_way';
  return stage;
}

/** Rows per tab, for the tab chips. */
export function tabCounts(rows) {
  const out = { to_ship: 0, on_the_way: 0, delivered: 0, returned: 0, cancelled: 0 };
  for (const o of Array.isArray(rows) ? rows : []) out[stageTab(orderStage(o))] += 1;
  return out;
}

/**
 * Has the order been confirmed, and how?
 *   done     yes
 *   waiting  a COD order whose WhatsApp "Confirm my order" request went out
 *            (it has a confirm_token) and has not been answered
 */
export function confirmation(o) {
  if (o?.customer_confirmed_at) return { done: true, waiting: false, how: 'on WhatsApp' };
  if (o?.paid === true && !isCod(o)) return { done: true, waiting: false, how: 'paid' };
  if (['confirmed', 'dispatched', 'delivered'].includes(o?.status)) return { done: true, waiting: false, how: 'by you' };
  if (o?.awb) return { done: true, waiting: false, how: '' };
  return { done: false, waiting: isCod(o) && Boolean(o?.confirm_token), how: '' };
}

/**
 * Warn before shipping a COD order the buyer has not confirmed: those are the
 * ones most often refused at the door. Only after 30 minutes, so a buyer who is
 * still reading the WhatsApp message is not flagged.
 */
export function needsCallFirst(o, now) {
  if (orderStage(o) !== 'to_ship') return false;
  const c = confirmation(o);
  const t = Date.parse(o?.created_at);
  return !c.done && c.waiting && Number.isFinite(t) && Number.isFinite(now) && now - t > 30 * 60000;
}

/** Courier wording for an order on its way. */
export function courierProgress(o) {
  const bucket = classifyBucket(o);
  return { bucket, label: prettyStatus(o?.shipment_status), problem: bucket === 'attention' || bucket === 'cancelled' };
}

/**
 * The four progress steps. state: done | now | pending | stop.
 * `ago` formats a timestamp for the step's small line.
 */
export function orderSteps(o, ago = () => '') {
  const stage = orderStage(o);
  const conf = confirmation(o);
  const sent = stage === 'courier' || stage === 'with_rider' || stage === 'delivered' || stage === 'returned';
  const confirmStep = stage === 'not_paid'
    ? { key: 'confirmed', label: 'Paid', state: 'now', sub: 'not yet' }
    : { key: 'confirmed', label: 'Confirmed',
        state: conf.done || sent ? 'done' : conf.waiting ? 'now' : 'pending',
        sub: conf.done ? conf.how : conf.waiting ? 'waiting' : '' };
  const shipNow = stage === 'to_ship' && !conf.waiting;
  return [
    { key: 'ordered', label: 'Ordered', state: 'done', sub: ago(o?.created_at) },
    confirmStep,
    { key: 'shipped', label: 'Shipped', state: sent ? 'done' : shipNow ? 'now' : 'pending',
      sub: sent ? (o?.awb ? courierInfo(o?.courier).name : 'own delivery') : shipNow ? 'next' : '' },
    stage === 'returned'
      ? { key: 'delivered', label: 'Returned', state: 'stop', sub: 'came back' }
      : { key: 'delivered', label: 'Delivered',
          state: stage === 'delivered' ? 'done' : sent ? 'now' : 'pending',
          sub: stage === 'delivered' ? ago(o?.delivered_at) : stage === 'courier' ? courierProgress(o).label : '' },
  ];
}

/**
 * The ONE thing the shop has to do now, and an optional second.
 *   primary / alt: 'book' | 'rider' | 'picked_up' | 'pay_link' | 'request_pay' |
 *                  'delivered' | 'received' | 'review' | 'call' | 'restore' | null
 *
 * ctx: { courier: name of the connected courier for this order, or null;
 *        pickup: the customer collects it; canPayLink; canRequestPay; now }
 */
export function nextStep(o, ctx = {}) {
  const stage = orderStage(o);
  const callFirst = needsCallFirst(o, ctx.now);
  switch (stage) {
    case 'to_ship':
      if (ctx.pickup) return { primary: 'picked_up', alt: callFirst ? 'call' : null };
      if (ctx.courier) return { primary: 'book', alt: callFirst ? 'call' : 'rider' };
      return { primary: 'rider', alt: callFirst ? 'call' : null };
    case 'not_paid':
      return { primary: ctx.canPayLink ? 'pay_link' : ctx.canRequestPay ? 'request_pay' : null, alt: null };
    case 'with_rider':
      return { primary: 'delivered', alt: null };
    case 'courier':
      return { primary: null, alt: courierProgress(o).problem ? 'call' : null };
    case 'delivered':
      return { primary: o?.paid === true ? 'review' : 'received', alt: null };
    case 'cancelled':
      return { primary: null, alt: 'restore' };
    default:
      return { primary: null, alt: null };
  }
}

/** The payment chip's words. Its state comes from paymentLabelState. */
export function paymentChip(o) {
  const s = paymentLabelState(o);
  const amount = `₹${Number(o?.total || 0).toLocaleString('en-IN')}`;
  if (s === 'paid') return { tone: 'paid', text: o?.paid_via === 'cod_delivery' ? 'Paid · cash collected' : 'Paid' };
  if (s === 'incomplete') return { tone: 'bad', text: 'Not paid' };
  if (s === 'returned') return { tone: 'muted', text: 'Returned' };
  if (s === 'unconfirmed') return { tone: 'due', text: 'Payment not confirmed' };
  if (isCod(o)) return { tone: 'due', text: `COD · collect ${amount}` };
  return { tone: 'due', text: 'Unpaid' };
}
