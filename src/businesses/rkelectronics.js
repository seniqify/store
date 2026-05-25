/**
 * RK Electronics — slug: rkelectronics
 * Mobile accessories wholesale, Delhi.
 * 18% GST (electronics), blue brand color.
 */

export const rkElectronicsConfig = {
  slug:         'rkelectronics',
  businessName: 'RK Electronics',
  tagline:      'Mobile Accessories Wholesale — Direct from Delhi',
  logo:         null,
  logoEmoji:    '📱',

  whatsappNumber: '919812345678',
  phone:   '+91 98123 45678',
  email:   'orders@rkelectronics.in',
  address: 'Lajpat Rai Market, Delhi — 110006',
  gst:     'GST No: 07BBBBB5678A1Z3',
  upi:  'rkelectronics@upi',
  bank: {
    accountName:   'RK Electronics',
    accountNumber: '9876543210',
    ifsc:          'SBIN0012345',
    bankName:      'State Bank of India',
  },

  theme: {
    primary:     '#2563eb',   // blue-600
    primaryDark: '#1d4ed8',   // blue-700
    accent:      '#f59e0b',
    accentDark:  '#d97706',
  },

  cart: {
    taxRate:           0.18,   // 18% GST (electronics)
    freeShippingAbove: 1499,
    shippingCharge:    79,
  },

  hero: {
    eyebrow: '📦 Wholesale Prices — MOQ 10 Pcs · Delhi NCR',
    heading: 'Mobile Accessories,\nAt Wholesale Rates',
    subtext:
      'Chargers, cables, earphones, cases & power banks. Bulk orders welcome. GST invoice included.',
    cta: 'Shop Now',
  },

  features: [
    { emoji: '✅', title: 'Original Stock',     desc: 'Certified & genuine products' },
    { emoji: '📄', title: 'GST Invoice',        desc: 'B2B billing, ITC eligible' },
    { emoji: '🚚', title: 'Pan-India Delivery', desc: 'Courier in 2–5 working days' },
    { emoji: '📦', title: 'Bulk Orders',        desc: 'MOQ 10 pcs per SKU' },
  ],

  categories: [
    { id: 'all',       label: 'All Products', emoji: '📱' },
    { id: 'charger',   label: 'Chargers',     emoji: '🔌' },
    { id: 'cable',     label: 'Cables',       emoji: '🔗' },
    { id: 'audio',     label: 'Audio',        emoji: '🎧' },
    { id: 'case',      label: 'Cases',        emoji: '🛡️' },
    { id: 'powerbank', label: 'Power Banks',  emoji: '🔋' },
  ],

  products: [
    // ── Chargers ────────────────────────────────────────────────────────────
    {
      id: 101,
      name:        '65W GaN Charger — Dual Port (C+A)',
      category:    'charger',
      description: 'Compact GaN technology. Charges laptop, phone, and tablet simultaneously. Universal compatibility.',
      image:       'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&q=80',
      price: 649,
      mrp:   999,
      unit:  'per piece',
      badge:      'Best Seller',
      badgeColor: 'bg-brand',
    },
    {
      id: 102,
      name:        '33W Fast Charger — Type-C',
      category:    'charger',
      description: 'Supports PD 3.0 and QC 4.0 fast charging. Compatible with all Type-C Android devices.',
      image:       'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&q=80',
      price: 349,
      mrp:   499,
      unit:  'per piece',
      badge:      null,
      badgeColor: null,
    },
    {
      id: 103,
      name:        '20W MFi Certified Charger — iPhone',
      category:    'charger',
      description: 'Apple MFi certified. Lightning fast charging for iPhone 8 and above. India plug included.',
      image:       'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80',
      price: 499,
      mrp:   799,
      unit:  'per piece',
      badge:      'MFi',
      badgeColor: 'bg-gray-700',
    },

    // ── Cables ──────────────────────────────────────────────────────────────
    {
      id: 201,
      name:        'Braided Type-C to Type-C Cable — 1.2m',
      category:    'cable',
      description: 'Nylon braided, 100W power delivery. Supports 40 Gbps data transfer. Available in black & white.',
      image:       'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=400&q=80',
      price: 199,
      mrp:   349,
      unit:  'per piece',
      badge:      '100W PD',
      badgeColor: 'bg-blue-600',
    },
    {
      id: 202,
      name:        'Type-C to Lightning Cable — MFi 1m',
      category:    'cable',
      description: 'Apple certified. Fast-charge your iPhone using any USB-C adapter or MacBook.',
      image:       'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
      price: 299,
      mrp:   499,
      unit:  'per piece',
      badge:      'MFi',
      badgeColor: 'bg-gray-700',
    },
    {
      id: 203,
      name:        'Micro-USB Cable — Pack of 3',
      category:    'cable',
      description: 'Universal 2.4A charging cables. Works with Android devices, power banks, and Bluetooth accessories.',
      image:       'https://images.unsplash.com/photo-1596003906949-67221c37965c?w=400&q=80',
      price: 249,
      mrp:   399,
      unit:  'pack of 3',
      badge:      'Value Pack',
      badgeColor: 'bg-green-600',
    },

    // ── Audio ────────────────────────────────────────────────────────────────
    {
      id: 301,
      name:        'TWS Earbuds — Active Noise Cancellation',
      category:    'audio',
      description: '30 dB ANC, 24-hr battery life, IPX4 splash resistant. AAC and SBC audio codec support.',
      image:       'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
      price: 1299,
      mrp:   1999,
      unit:  'per pair',
      badge:      'ANC',
      badgeColor: 'bg-purple-600',
    },
    {
      id: 302,
      name:        'Wired Earphones — Type-C, Hi-Res',
      category:    'audio',
      description: 'Hi-Res Audio certified. In-line mic and remote. 10 mm dynamic drivers with deep bass.',
      image:       'https://images.unsplash.com/photo-1605462863863-10d9e47e15ee?w=400&q=80',
      price: 449,
      mrp:   699,
      unit:  'per pair',
      badge:      'Hi-Res',
      badgeColor: 'bg-brand',
    },

    // ── Cases ────────────────────────────────────────────────────────────────
    {
      id: 401,
      name:        'Premium Leather Wallet Case',
      category:    'case',
      description: 'PU leather, 3-card slots, magnetic closure. For Samsung Galaxy S & iPhone 14/15 series.',
      image:       'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&q=80',
      price: 349,
      mrp:   599,
      unit:  'per piece',
      badge:      null,
      badgeColor: null,
    },
    {
      id: 402,
      name:        'Anti-Shock Clear Case — Pack of 5',
      category:    'case',
      description: 'Military-grade drop protection. Crystal-clear TPU, anti-yellowing formula. Mixed models per pack.',
      image:       'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80',
      price: 299,
      mrp:   499,
      unit:  'pack of 5',
      badge:      'Bulk Deal',
      badgeColor: 'bg-accent',
    },

    // ── Power Banks ──────────────────────────────────────────────────────────
    {
      id: 501,
      name:        '10000mAh Power Bank — 22.5W Fast Charge',
      category:    'powerbank',
      description: 'Dual output (C + A), 22.5W fast charge in & out. LED indicator, slim profile, airline safe.',
      image:       'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&q=80',
      price: 899,
      mrp:   1299,
      unit:  'per piece',
      badge:      'Best Seller',
      badgeColor: 'bg-brand',
    },
    {
      id: 502,
      name:        '20000mAh Power Bank — 65W PD',
      category:    'powerbank',
      description: 'Charges a MacBook. Triple output (2×C + 1×A), passthrough charging, digital percentage display.',
      image:       'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&q=80',
      price: 1799,
      mrp:   2499,
      unit:  'per piece',
      badge:      'Pro',
      badgeColor: 'bg-blue-700',
    },
  ],
};
