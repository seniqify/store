/**
 * metaPixel — per-store Meta (Facebook) Pixel for stores running Meta/Instagram
 * ads. The owner pastes their Pixel ID in Manage; we load Meta's fbevents.js once
 * and fire the standard events so their ads can optimise for buyers + retarget.
 *
 * A store sends to two pixels when they differ: the one its owner added and the
 * one its PocketLink ads optimise on (config.meta.pixelId). Uses `trackSingle` so
 * events go ONLY to the active store's pixels — never leaks
 * between two stores a shopper might visit in one session. All tracking is a
 * no-op until a valid pixel is initialised, so callers can fire events freely.
 *
 * NOTE: PocketLink checkout finishes in WhatsApp, so "Purchase" fires when the
 * customer PLACES the order (a proxy conversion) — good enough for ad
 * optimisation. A server-side Conversions API "Purchase" (from the order record)
 * is the more reliable follow-up.
 */
let activeIds = [];

/** Load the store's pixel(s) (once) and fire the initial PageView to each. A store
 *  without a pixel clears the previous store's, so nothing leaks between stores. */
export function initMetaPixel(pixelIds) {
  const ids = [...new Set((Array.isArray(pixelIds) ? pixelIds : [pixelIds])
    .map((v) => String(v ?? '').trim())
    .filter((v) => /^\d{5,20}$/.test(v)))];
  if (typeof window === 'undefined') return;
  if (!ids.length) { activeIds = []; return; }
  if (ids.join(',') === activeIds.join(',')) return;                       // already running for this store

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

  for (const id of ids) {
    window.fbq('init', id);
    window.fbq('trackSingle', id, 'PageView');
  }
  activeIds = ids;
}

/** Fire a standard event to the active store's pixels — no-op if none is set.
 *  Pass `eventID` (e.g. the order id) so a matching server-side CAPI event with
 *  the same id is de-duplicated by Meta. */
export function pixelTrack(event, data, eventID) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function' || !activeIds.length) return;
  for (const id of activeIds) {
    if (eventID) window.fbq('trackSingle', id, event, data || {}, { eventID: String(eventID) });
    else window.fbq('trackSingle', id, event, data || {});
  }
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
