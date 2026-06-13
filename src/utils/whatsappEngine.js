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
export function buildServiceMessage(form, config) {
  const lines = [];

  lines.push(`*🔧 QUOTATION REQUEST — ${config.businessName}*`);
  lines.push('');
  lines.push(`Name: ${form.name}`);
  lines.push(`Phone: +91 ${form.phone}`);
  if (form.services?.length) {
    lines.push(`Service(s): ${form.services.join(', ')}`);
  }
  if (form.budget) lines.push(`Budget: ₹${form.budget}`);
  if (form.notes?.trim()) lines.push(`Requirements: ${form.notes.trim()}`);

  return lines.join('\n');
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
