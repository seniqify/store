import { courierInfo } from './deliveryStatus.js';

/**
 * Book courier: what each connected courier can do for one order, from
 * shipping-rate's answer per courier (`rates[courier]`: { loading } | { error } |
 * { serviceable, cod, amount }). `payment` is 'COD' | 'Prepaid'. PURE.
 * A courier is usable when it delivers to the pincode and, for COD, takes cash.
 * A rate lookup that failed leaves the courier usable: the booking itself checks.
 */
export function courierOptions(connected, rates, payment, defaultCourier) {
  return connected.map((c) => {
    const r = rates[c] || { loading: true };
    const off = !r.loading && r.serviceable === false;
    const noCod = payment === 'COD' && r.cod === false && !off;
    const info = courierInfo(c);
    return {
      key: c,
      name: info.name,
      chip: info.chip,
      isDefault: c === defaultCourier,
      loading: Boolean(r.loading),
      usable: !r.loading && !off && !noCod,
      off,
      noCod,
      amount: r.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      estimate: c === 'shadowfax',   // no rate API: the flat rate card
      unchecked: Boolean(r.error),
    };
  });
}

/** The courier Book courier starts on: the store's default when it can take the
 *  order, else the first that can, else none. PURE. */
export function autoPickCourier(options) {
  const usable = options.filter((x) => x.usable);
  return (usable.find((x) => x.isDefault) || usable[0])?.key || null;
}
