/**
 * Which WhatsApp message brought this customer to the shop? (pure; tested)
 *
 * The reminder link (/cart/<token>) and the offer link (/o/<token>) leave a note
 * here for that shop; when the customer places an order there within 48 hours,
 * the checkout hands the token to attribute_message_order, which tags the order
 * to that message (supabase/messages-v2-forward.sql). That is how the shop sees
 * "Ordered · via reminder link" and the rupees each message brought in.
 *
 * localStorage, not sessionStorage: people open the link, look, and come back
 * to order later the same day.
 */

const KEY = 'pl_msg_attr_v1';
const TTL_MS = 48 * 60 * 60 * 1000;
const TOKEN = /^[0-9a-f]{20}$/;

function read(storage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Remember that this shop was opened from a message link. Never throws. */
export function saveMessageAttribution(slug, kind, token, storage = globalThis.localStorage, now = Date.now()) {
  if (!slug || !['cart', 'offer'].includes(kind) || !TOKEN.test(String(token || ''))) return;
  try {
    const all = read(storage);
    all[slug] = { kind, token: String(token), at: now };
    storage?.setItem(KEY, JSON.stringify(all));
  } catch { /* storage blocked — the order simply isn't tagged */ }
}

/** The message that brought this customer to THIS shop, if fresh — taken once. */
export function takeMessageAttribution(slug, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const all = read(storage);
    const a = all[slug];
    if (!a) return null;
    delete all[slug];
    storage?.setItem(KEY, JSON.stringify(all));
    if (!(now - Number(a.at) <= TTL_MS) || !TOKEN.test(String(a.token || '')) || !['cart', 'offer'].includes(a.kind)) return null;
    return { kind: a.kind, token: a.token };
  } catch {
    return null;
  }
}
