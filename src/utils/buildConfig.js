/**
 * buildConfig
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts onboarding wizard data into a full, ready-to-use business config
 * object — the same shape used by all components via useBusinessConfig().
 *
 * @param {object}   wizardData      — collected across the 3 wizard steps
 * @param {string[]} existingSlugs   — all taken slugs (static + stored)
 * @returns {object}                 — complete business config
 */

import { uniqueSlug } from './slugify';

// ── Theme presets ─────────────────────────────────────────────────────────────
// Each preset maps a primary hex to a full { primary, primaryDark, accent, accentDark } object.
// primaryDark is a naturally darker tone of the same hue, used for hover/active states.
export const THEME_PRESETS = {
  '#0d9488': { primary: '#0d9488', primaryDark: '#0f766e', accent: '#f59e0b', accentDark: '#d97706' }, // teal
  '#2563eb': { primary: '#2563eb', primaryDark: '#1d4ed8', accent: '#f59e0b', accentDark: '#d97706' }, // blue
  '#6366f1': { primary: '#6366f1', primaryDark: '#4f46e5', accent: '#f59e0b', accentDark: '#d97706' }, // indigo
  '#16a34a': { primary: '#16a34a', primaryDark: '#15803d', accent: '#f59e0b', accentDark: '#d97706' }, // green
  '#ea580c': { primary: '#ea580c', primaryDark: '#c2410c', accent: '#f59e0b', accentDark: '#d97706' }, // orange
  '#9333ea': { primary: '#9333ea', primaryDark: '#7e22ce', accent: '#f59e0b', accentDark: '#d97706' }, // purple
  '#e11d48': { primary: '#e11d48', primaryDark: '#be123c', accent: '#f59e0b', accentDark: '#d97706' }, // rose
};

// Rotating placeholder images used when a product has no image URL.
const PLACEHOLDERS = [
  'https://images.unsplash.com/photo-1560472355-536de3962603?w=400&q=80',
  'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80',
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80',
  'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&q=80',
  'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=400&q=80',
];

export function buildBusinessConfig(wizardData, existingSlugs = []) {
  const {
    businessName,
    whatsappNumber,
    logoEmoji          = '🏪',
    themeColor         = '#0d9488',
    gstRate            = 0.05,
    gstNumber          = '',
    deliveryCharge     = 49,
    freeDeliveryAbove  = 999,
    upiId              = '',
    bankAccountName    = '',
    bankAccountNumber  = '',
    bankIfsc           = '',
    bankName           = '',
    categories         = [],
    products           = [],
  } = wizardData;

  const slug  = uniqueSlug(businessName, existingSlugs);
  const theme = THEME_PRESETS[themeColor] ?? THEME_PRESETS['#0d9488'];

  // ── Format phone from the raw 10-digit WhatsApp number ──────────────────
  const digits     = whatsappNumber.replace(/\D/g, '').slice(-10);
  const phoneFormatted = digits.length === 10
    ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
    : `+91 ${digits}`;

  // ── Categories: always prepend the universal "All" filter ───────────────
  const allCategories = [
    { id: 'all', label: 'All Products', emoji: '🛒' },
    ...categories,
  ];

  // ── Map wizard products → full product schema ──────────────────────────
  const builtProducts = products.map((p, i) => ({
    id:          i + 1,
    name:        p.name.trim(),
    category:    p.category,
    description: p.description?.trim() || '',
    image:       p.image?.trim() || PLACEHOLDERS[i % PLACEHOLDERS.length],
    price:       Number(p.price),
    mrp:         p.mrp && Number(p.mrp) > Number(p.price) ? Number(p.mrp) : undefined,
    unit:        p.unit?.trim() || 'per piece',
    inStock:     p.inStock !== false,   // default true; false only if explicitly set
    badge:       null,
    badgeColor:  null,
  }));

  return {
    slug,
    businessName: businessName.trim(),
    tagline:      `Order from ${businessName.trim()} via WhatsApp`,
    logo:         null,
    logoEmoji,

    whatsappNumber: `91${digits}`,
    phone:          phoneFormatted,
    email:          '',
    address:        '',
    gst:            gstNumber.trim(),
    upi:            upiId.trim(),
    bank: {
      accountName:   bankAccountName.trim(),
      accountNumber: bankAccountNumber.trim(),
      ifsc:          bankIfsc.trim().toUpperCase(),
      bankName:      bankName.trim(),
    },

    theme,

    cart: {
      taxRate:           Number(gstRate) || 0,
      freeShippingAbove: Number(freeDeliveryAbove) || 999,
      shippingCharge:    Number(deliveryCharge) || 0,
    },

    hero: {
      eyebrow: '📦 Browse and order directly via WhatsApp',
      heading: businessName.trim(),
      subtext: 'Browse our products, add to cart, and place your order — confirmation via WhatsApp.',
      cta:     'Browse Products',
    },

    features: [
      { emoji: '📱', title: 'WhatsApp Orders',    desc: 'Instant order confirmation' },
      { emoji: '✅', title: 'Quality Assured',    desc: '100% genuine products' },
      { emoji: '🚚', title: 'Pan-India Delivery', desc: 'We ship anywhere in India' },
      { emoji: '📄', title: 'GST Invoice',        desc: 'Proper billing on request' },
    ],

    categories: allCategories,
    products:   builtProducts,
  };
}
