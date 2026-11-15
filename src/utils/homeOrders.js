// Home → "Latest orders": where one order stands, in the words Home uses. PURE.
import { orderStage } from './orderCard.js';

/** Home's stage for an order: new, to_ship, not_paid, on_the_way, delivered, returned, cancelled. */
export function stageOf(o) {
  if (o?.status === 'new') return 'new';
  const s = orderStage(o);
  if (s === 'courier' || s === 'with_rider') return 'on_the_way';
  return ['to_ship', 'not_paid', 'delivered', 'returned', 'cancelled'].includes(s) ? s : 'to_ship';
}

/** The short reference a buyer sees ("Order #A7F2C"); the Orders search finds it. */
export const orderRef = (o) => String(o?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
