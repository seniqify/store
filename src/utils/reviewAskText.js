/**
 * The review request PocketLink sends from its own WhatsApp ("Ask automatically"
 * and "Ask all"). These words MUST match the approved Seniqify templates: the
 * screen previews them, the template sends them.
 *
 *   {{1}} first name   {{2}} shop   {{3}} first item
 *   URL button → https://www.pocketlink.store/{{1}}  (value: review/<token>)
 *
 * The shop's own "Send one by one" uses reviewInviteMessage (reviewShape.js)
 * instead: a plain message with the link in the text.
 */
export const REVIEW_ASK_TEXT = {
  en: {
    body: 'Hi {{1}}, your order from {{2}} has been delivered.\n\nHow was your {{3}}? Please give it a rating. It takes 30 seconds and helps other customers.',
    button: 'Rate my order',
  },
  mr: {
    body: 'नमस्कार {{1}}, {{2}} कडून तुमची ऑर्डर पोहोचली आहे.\n\nतुम्हाला {{3}} कसे वाटले? कृपया रेटिंग द्या. फक्त ३० सेकंद लागतात आणि इतर ग्राहकांना मदत होते.',
    button: 'रेटिंग द्या',
  },
};

/** The message a customer gets, filled in. Empty parts get the same fallback as the sender. */
export function reviewAskMessage(lang, { name, store, item } = {}) {
  const mr = lang === 'mr';
  const t = REVIEW_ASK_TEXT[mr ? 'mr' : 'en'];
  const pick = (v, en, m) => (String(v || '').trim() || (mr ? m : en));
  const text = t.body
    .replace('{{1}}', pick(String(name || '').trim().split(/\s+/)[0], 'there', 'ग्राहक'))
    .replace('{{2}}', pick(store, 'our shop', 'आमचे दुकान'))
    .replace('{{3}}', pick(item, 'order', 'ऑर्डर'));
  return { text, button: t.button };
}
