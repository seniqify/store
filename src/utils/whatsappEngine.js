/**
 * whatsappEngine — generates template-specific WhatsApp messages.
 * Each template type produces a different formatted message.
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

function waURL(message, number) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function openWhatsApp(message, number) {
  window.open(waURL(message, number), '_blank', 'noopener,noreferrer');
}

// ── Product order (existing format, re-exported for consistency) ──────────────
export { generateWhatsAppMessage as buildProductMessage } from './generateWhatsAppMessage';
export { sendOrderOnWhatsApp as openProductOrder } from './generateWhatsAppMessage';

// ── Service inquiry ───────────────────────────────────────────────────────────
// Kept under 50 words on purpose — the store's WhatsApp automation only
// triggers on incoming messages at or under that length. saveLead() (called
// right before this) already persists the full form, so trimming here never
// loses data — the owner sees everything in Manage → Leads regardless.
const MAX_WORDS = 50;
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

export function buildServiceMessage(form, config) {
  function build({ services, requirements }) {
    const lines = ['🔧 *Quote Request*', ''];
    lines.push(`${form.name}, +91${form.phone}`);
    if (services?.length) lines.push(`Interested in: ${services.join(', ')}`);
    if (form.budget) lines.push(`Budget: ₹${form.budget}`);
    if (requirements) lines.push(requirements);
    return lines.join('\n').trim();
  }

  const requirements = form.notes?.trim() ? `Requirements: ${form.notes.trim()}` : '';
  let msg = build({ services: form.services, requirements });
  if (wordCount(msg) <= MAX_WORDS) return msg;

  // Trim requirements text first — full text is already saved as a lead.
  msg = build({ services: form.services, requirements: requirements && 'See requirements in Leads' });
  if (wordCount(msg) <= MAX_WORDS) return msg;

  // Still over (many services selected) — collapse the service list too.
  const n = form.services?.length || 0;
  return build({ services: n ? [`${n} services (see Leads)`] : [], requirements: '' });
}

export function openServiceInquiry(form, config) {
  openWhatsApp(buildServiceMessage(form, config), config.whatsappNumber);
}

// ── Portfolio / Lead ──────────────────────────────────────────────────────────
export function buildLeadMessage(form, config) {
  const lines = [];

  lines.push(`*💼 NEW INQUIRY — ${config.businessName}*`);
  lines.push('');
  lines.push(`Name: ${form.name}`);
  lines.push(`Phone: +91 ${form.phone}`);
  if (form.email?.trim()) lines.push(`Email: ${form.email.trim()}`);
  if (form.service) lines.push(`Interested in: ${form.service}`);
  if (form.message?.trim()) lines.push(`Message: ${form.message.trim()}`);

  return lines.join('\n');
}

export function openLeadInquiry(form, config) {
  openWhatsApp(buildLeadMessage(form, config), config.whatsappNumber);
}
