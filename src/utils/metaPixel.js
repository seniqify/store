/**
 * metaPixel — per-store Meta (Facebook) Pixel for stores running Meta/Instagram
 * ads. The owner pastes their Pixel ID in Manage; we load Meta's fbevents.js once
 * and fire the standard events so their ads can optimise for buyers + retarget.
 *
 * Uses `trackSingle` so events go ONLY to the active store's pixel — never leaks
 * between two stores a shopper might visit in one session. All tracking is a
 * no-op until a valid pixel is initialised, so callers can fire events freely.
 *
 * NOTE: PocketLink checkout finishes in WhatsApp, so "Purchase" fires when the
 * customer PLACES the order (a proxy conversion) — good enough for ad
 * optimisation. A server-side Conversions API "Purchase" (from the order record)
 * is the more reliable follow-up.
 */
let activeId = null;

/** Load the pixel (once) for this store and fire the initial PageView. */
export function initMetaPixel(pixelId) {
  const id = String(pixelId || '').trim();
  if (!id || typeof window === 'undefined') return;
  if (activeId === id) return;                       // already running for this store

  if (!window.fbq) {
    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
  }

  window.fbq('init', id);
  window.fbq('trackSingle', id, 'PageView');
  activeId = id;
}

/** Fire a standard event to the active store's pixel — no-op if none is set.
 *  Pass `eventID` (e.g. the order id) so a matching server-side CAPI event with
 *  the same id is de-duplicated by Meta. */
export function pixelTrack(event, data, eventID) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function' || !activeId) return;
  if (eventID) window.fbq('trackSingle', activeId, event, data || {}, { eventID: String(eventID) });
  else window.fbq('trackSingle', activeId, event, data || {});
}

/** Read the Meta match signals the browser Pixel sets (_fbp / _fbc cookies) plus
 *  the user agent, captured at order placement so a later server-side CAPI
 *  Purchase can be matched + deduplicated even when it fires much later. */
export function getMetaMatchData() {
  if (typeof document === 'undefined') return { fbp: null, fbc: null, ua: null };
  const cookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  return {
    fbp: cookie('_fbp'),
    fbc: cookie('_fbc'),
    ua:  typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
}
