/**
 * Default / Demo Store — slug: default
 * Generic fallback store for the platform landing page.
 * Shows the Seniqify Store workflow without tying to a specific business domain.
 */

export const defaultConfig = {
  slug:         'default',
  businessName: 'Seniqify Store Demo',
  tagline:      'A demo storefront — try the WhatsApp order workflow',
  logo:         null,
  logoEmoji:    '🏪',

  whatsappNumber: '919000000000',
  phone:   '+91 90000 00000',
  email:   'hello@seniqify.store',
  address: 'India',
  gst:     'GST registration pending',
  upi:  'demo@upi',
  bank: {
    accountName:   'Demo Store',
    accountNumber: '1111222233334444',
    ifsc:          'ICIC0001234',
    bankName:      'ICICI Bank',
  },

  theme: {
    primary:     '#6366f1',   // indigo-500
    primaryDark: '#4f46e5',   // indigo-600
    accent:      '#f59e0b',
    accentDark:  '#d97706',
  },

  cart: {
    taxRate:           0.18,
    freeShippingAbove: 999,
    shippingCharge:    49,
  },

  hero: {
    eyebrow: '🛒 Multi-business storefront platform',
    heading: 'Any Business,\nOne Platform',
    subtext:
      'This is a demo store. Browse products, try the cart, and experience the WhatsApp order workflow.',
    cta: 'Browse Products',
  },

  features: [
    { emoji: '⚡', title: 'Instant Setup',    desc: 'New store live in minutes' },
    { emoji: '📱', title: 'WhatsApp Orders',  desc: 'Orders go straight to your chat' },
    { emoji: '🎨', title: 'Custom Branding',  desc: 'Each store has its own theme' },
    { emoji: '🧾', title: 'GST Ready',        desc: 'Tax-inclusive pricing & invoices' },
  ],

  categories: [
    { id: 'all',      label: 'All Items',    emoji: '🛒' },
    { id: 'featured', label: 'Featured',     emoji: '⭐' },
    { id: 'new',      label: 'New Arrivals', emoji: '🆕' },
    { id: 'sale',     label: 'On Sale',      emoji: '🏷️' },
  ],

  products: [
    {
      id: 1,
      name:        'Demo Product — Alpha',
      category:    'featured',
      description: 'A sample product showcasing the card layout, price display, and add-to-cart flow.',
      image:       'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80',
      price: 999,
      mrp:   1299,
      unit:  'per piece',
      badge:      'Featured',
      badgeColor: 'bg-brand',
    },
    {
      id: 2,
      name:        'Demo Product — Beta',
      category:    'new',
      description: 'Another sample product showing how new arrivals are labeled and displayed.',
      image:       'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&q=80',
      price: 499,
      mrp:   699,
      unit:  'per piece',
      badge:      'New',
      badgeColor: 'bg-blue-600',
    },
    {
      id: 3,
      name:        'Demo Product — Gamma',
      category:    'sale',
      description: 'A discounted demo product showing the savings badge, strikethrough MRP, and % off chip.',
      image:       'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80',
      price: 299,
      mrp:   599,
      unit:  'per piece',
      badge:      '50% Off',
      badgeColor: 'bg-red-500',
    },
    {
      id: 4,
      name:        'Demo Product — Delta',
      category:    'featured',
      description: 'A bulk-pack product showing per-unit pricing, savings, and how packs work in the cart.',
      image:       'https://images.unsplash.com/photo-1560472355-536de3962603?w=400&q=80',
      price: 1499,
      mrp:   1999,
      unit:  'pack of 5',
      badge:      'Bulk Deal',
      badgeColor: 'bg-accent',
    },
    {
      id: 5,
      name:        'Demo Product — Epsilon',
      category:    'new',
      description: 'Fifth demo item — fill your cart to see the mobile bottom bar, sticky sidebar, and order form.',
      image:       'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=400&q=80',
      price: 749,
      mrp:   999,
      unit:  'per piece',
      badge:      null,
      badgeColor: null,
    },
    {
      id: 6,
      name:        'Demo Product — Zeta',
      category:    'sale',
      description: 'Out-of-stock demo. Shows the disabled state overlay and "Unavailable" button.',
      image:       'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80',
      price: 199,
      mrp:   399,
      unit:  'per piece',
      stock:      0,           // triggers out-of-stock UI
      badge:      null,
      badgeColor: null,
    },
  ],
};
