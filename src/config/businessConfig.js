/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BUSINESS CONFIG — single source of truth for the entire storefront.
 *
 *  Change anything here and every component updates automatically.
 *  No component should ever hardcode business data, products, or theme colors.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const BUSINESS_CONFIG = {
  // ── Identity ──────────────────────────────────────────────────────────────
  name: 'SoftWeave Towels',
  tagline: 'Premium Cotton Towels — Direct from Karur',
  logo: null,           // Set to an image URL to show a logo image in Header
  logoEmoji: '🧸',      // Fallback when logo is null

  // ── Contact ───────────────────────────────────────────────────────────────
  whatsapp: '919876543210',       // Format: country code + number, no "+"
  phone: '+91 98765 43210',
  email: 'orders@softweave.in',
  address: 'Karur, Tamil Nadu — 639001',
  gst: 'GST No: 33XXXXX1234Z1Z5',
  upi: 'softweave@upi',
  bank: {
    accountName:   'SoftWeave Towels',
    accountNumber: '1234567890',
    ifsc:          'HDFC0001234',
    bankName:      'HDFC Bank',
  },

  // ── Theme colors ──────────────────────────────────────────────────────────
  // Changing these hex values is enough to rebrand the entire UI.
  // Applied as CSS custom properties — see src/utils/theme.js
  theme: {
    primary:     '#0d9488',   // teal-600  — main brand
    primaryDark: '#0f766e',   // teal-700  — hover / darker text
    accent:      '#f59e0b',   // amber-500 — warm contrast accent
    accentDark:  '#d97706',   // amber-600 — accent hover
  },

  // ── Cart & order settings ─────────────────────────────────────────────────
  cart: {
    taxRate:           0.05,  // 5% GST (textile category)
    freeShippingAbove: 599,
    shippingCharge:    49,
  },

  // ── Hero banner content ───────────────────────────────────────────────────
  hero: {
    eyebrow: '🇮🇳 Direct from Karur, Tamil Nadu — India\'s Towel Capital',
    heading: 'Premium Towels,\nDelivered to Your Door',
    subtext:
      'Bath, Hand, Face & Kitchen towels. Bulk orders welcome. GST invoice included. COD available.',
    cta: 'Shop Towels',
  },

  // ── Trust-features strip (below hero) ────────────────────────────────────
  features: [
    { emoji: '🧵', title: '100% Cotton',        desc: 'Combed cotton, zero synthetics' },
    { emoji: '📄', title: 'GST Invoice',         desc: 'B2B & retail billing available' },
    { emoji: '🚚', title: 'Pan-India Delivery',  desc: 'All pincodes covered' },
    { emoji: '💬', title: 'WhatsApp Orders',     desc: 'Bulk order support on chat' },
  ],

  // ── Categories ────────────────────────────────────────────────────────────
  // The "all" entry is mandatory — it acts as the "show everything" filter.
  categories: [
    { id: 'all',     label: 'All Towels',     emoji: '🛁' },
    { id: 'bath',    label: 'Bath Towels',    emoji: '🛀' },
    { id: 'hand',    label: 'Hand Towels',    emoji: '🙌' },
    { id: 'face',    label: 'Face Towels',    emoji: '😊' },
    { id: 'kitchen', label: 'Kitchen Towels', emoji: '🍽️' },
    { id: 'set',     label: 'Towel Sets',     emoji: '🎁' },
  ],

  // ── Products ──────────────────────────────────────────────────────────────
  // Required fields: id, name, category, image, price, unit, size
  // Optional fields: mrp, gsm, badge, badgeColor
  products: [
    // ── Bath Towels ───────────────────────────────────────────────────────
    {
      id: 1,
      name: 'Premium Bath Towel — Ivory White',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&q=80',
      price: 349,
      mrp: 499,
      unit: 'per piece',
      size: '70 × 140 cm',
      gsm: 500,
      badge: 'Best Seller',
      badgeColor: 'bg-brand',
    },
    {
      id: 2,
      name: 'Premium Bath Towel — Steel Grey',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&q=80',
      price: 349,
      mrp: 499,
      unit: 'per piece',
      size: '70 × 140 cm',
      gsm: 500,
      badge: null,
      badgeColor: null,
    },
    {
      id: 3,
      name: 'Luxury Bath Towel — 600 GSM',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&q=80',
      price: 549,
      mrp: 799,
      unit: 'per piece',
      size: '70 × 140 cm',
      gsm: 600,
      badge: 'Premium',
      badgeColor: 'bg-purple-600',
    },
    {
      id: 4,
      name: 'Kids Bath Towel — Soft Cotton',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1616048056617-93b94a339009?w=400&q=80',
      price: 249,
      mrp: 349,
      unit: 'per piece',
      size: '60 × 120 cm',
      gsm: 380,
      badge: 'Kids',
      badgeColor: 'bg-pink-500',
    },

    // ── Hand Towels ───────────────────────────────────────────────────────
    {
      id: 5,
      name: 'Cotton Hand Towel — Bright White',
      category: 'hand',
      image: 'https://images.unsplash.com/photo-1600369671738-48af8bb1f2cf?w=400&q=80',
      price: 149,
      mrp: 199,
      unit: 'per piece',
      size: '40 × 60 cm',
      gsm: 420,
      badge: null,
      badgeColor: null,
    },
    {
      id: 6,
      name: 'Stripe Hand Towel — Pack of 2',
      category: 'hand',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
      price: 279,
      mrp: 399,
      unit: 'pack of 2',
      size: '40 × 60 cm',
      gsm: 400,
      badge: '30% Off',
      badgeColor: 'bg-green-600',
    },

    // ── Face Towels ───────────────────────────────────────────────────────
    {
      id: 7,
      name: 'Soft Face Towel — Pack of 3',
      category: 'face',
      image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&q=80',
      price: 199,
      mrp: 279,
      unit: 'pack of 3',
      size: '30 × 30 cm',
      gsm: 360,
      badge: 'Value Pack',
      badgeColor: 'bg-blue-600',
    },
    {
      id: 8,
      name: 'Bamboo-Cotton Face Towel',
      category: 'face',
      image: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&q=80',
      price: 229,
      mrp: 349,
      unit: 'per piece',
      size: '30 × 30 cm',
      gsm: 400,
      badge: 'Eco',
      badgeColor: 'bg-green-700',
    },

    // ── Kitchen Towels ────────────────────────────────────────────────────
    {
      id: 9,
      name: 'Cotton Kitchen Towel — Pack of 6',
      category: 'kitchen',
      image: 'https://images.unsplash.com/photo-1616048056617-93b94a339009?w=400&q=80',
      price: 249,
      mrp: 399,
      unit: 'pack of 6',
      size: '40 × 60 cm',
      gsm: 340,
      badge: null,
      badgeColor: null,
    },
    {
      id: 10,
      name: 'Check-Pattern Kitchen Towel',
      category: 'kitchen',
      image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&q=80',
      price: 89,
      mrp: 129,
      unit: 'per piece',
      size: '40 × 60 cm',
      gsm: 320,
      badge: null,
      badgeColor: null,
    },

    // ── Towel Sets ────────────────────────────────────────────────────────
    {
      id: 11,
      name: 'Family Bath Set — 6 Pieces',
      category: 'set',
      image: 'https://images.unsplash.com/photo-1600369671738-48af8bb1f2cf?w=400&q=80',
      price: 999,
      mrp: 1499,
      unit: 'set of 6',
      size: 'Bath + Hand (mixed)',
      gsm: 480,
      badge: '33% Off',
      badgeColor: 'bg-red-500',
    },
    {
      id: 12,
      name: 'Hotel Quality Set — 12 Pieces',
      category: 'set',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
      price: 1799,
      mrp: 2799,
      unit: 'set of 12',
      size: 'Bath + Hand + Face (mixed)',
      gsm: 500,
      badge: 'Bulk Deal',
      badgeColor: 'bg-accent',
    },
  ],
};
