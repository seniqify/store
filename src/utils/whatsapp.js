/**
 * whatsapp.js — re-exports from the canonical utility.
 * Import from generateWhatsAppMessage.js for new code.
 */
export {
  generateWhatsAppMessage  as buildOrderMessage,
  generateWhatsAppURL,
  sendOrderOnWhatsApp      as openWhatsAppOrder,
} from './generateWhatsAppMessage';
