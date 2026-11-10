// Courier wallet warnings (Shadowfax is prepaid: an empty wallet refuses every
// booking). Remembered on this device when a booking fails for that reason,
// cleared when the shop says it recharged. A browser-only flag on purpose: the
// courier's wallet is not visible to PocketLink, only its refusal is.

const KEY = (slug) => `pl_courier_wallet_low_v1:${slug}`;
const EVENT = 'pl-courier-alerts';

/** Does a courier's refusal say its wallet is empty? PURE. */
export function isWalletRefusal(message) {
  return /wallet|insufficient (fund|balance)|low balance|recharge/i.test(String(message || ''));
}

export function walletLow(slug) {
  try { return JSON.parse(localStorage.getItem(KEY(slug)) || '{}') || {}; } catch { return {}; }
}

function save(slug, value) {
  try {
    if (Object.keys(value).length) localStorage.setItem(KEY(slug), JSON.stringify(value));
    else localStorage.removeItem(KEY(slug));
  } catch { /* private window: the warning simply isn't remembered */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* not in a browser */ }
}

export function markWalletLow(slug, courier, message) {
  save(slug, { ...walletLow(slug), [courier]: { at: new Date().toISOString(), message: String(message || '').slice(0, 200) } });
}

export function clearWalletLow(slug, courier) {
  const next = { ...walletLow(slug) };
  delete next[courier];
  save(slug, next);
}

/** Re-render when another card or tab changes the warning. */
export function onWalletLowChange(fn) {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
}
