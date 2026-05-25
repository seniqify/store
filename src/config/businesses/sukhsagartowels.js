/**
 * Sukh Sagar Towels — slug: sukhsagartowels
 * Hospitality-grade bulk towels. Indigo theme.
 */
export const sukhsagarConfig = {
  slug: 'sukhsagartowels',
  name: 'Sukh Sagar Towels',
  tagline: 'Hospitality Towels — Bulk Orders for Hotels & Hospitals',
  logo: null,
  logoEmoji: '🌊',

  whatsapp: '918800112233',
  phone: '+91 88001 12233',
  email: 'orders@sukhsagartowels.in',
  address: 'Industrial Estate, Karur, Tamil Nadu — 639002',
  gst: 'GST No: 33YYYYYY678A1Z3',
  upi: 'sukhsagar@upi',

  theme: {
    primary:     '#6366f1',   // indigo-500
    primaryDark: '#4f46e5',   // indigo-600
    accent:      '#f59e0b',
    accentDark:  '#d97706',
  },

  cart: {
    taxRate:           0.05,
    freeShippingAbove: 999,
    shippingCharge:    79,
  },

  hero: {
    eyebrow: '🏨 Trusted by 500+ Hotels & Hospitals across India',
    heading: 'Hotel-Grade Towels,\nBulk Pricing',
    subtext:
      'Minimum 50 pieces per order. GST invoice available. 24–48 hr dispatch from Karur.',
    cta: 'Browse Catalogue',
  },

  features: [
    { emoji: '🏨', title: 'Hotel Grade',   desc: 'Used by 5-star properties'   },
    { emoji: '📦', title: 'Bulk Orders',   desc: 'Min 50 pcs, up to 10,000'   },
    { emoji: '📄', title: 'GST Invoice',   desc: 'B2B & institutional billing'  },
    { emoji: '🚀', title: 'Fast Dispatch', desc: '24–48 hr from Karur'          },
  ],

  categories: [
    { id: 'all',      label: 'All',          emoji: '🛁'  },
    { id: 'bath',     label: 'Bath Towels',  emoji: '🛀'  },
    { id: 'hand',     label: 'Hand Towels',  emoji: '🙌'  },
    { id: 'sport',    label: 'Sport Towels', emoji: '🏋️' },
    { id: 'hospital', label: 'Hospital',     emoji: '🏥'  },
    { id: 'set',      label: 'Bulk Sets',    emoji: '📦'  },
  ],

  products: [
    {
      id: 1,
      name: 'Hotel Bath Towel — 600 GSM White',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&q=80',
      price: 299,  mrp: 449,
      unit: 'per piece',  size: '70 × 140 cm',  gsm: 600,
      badge: 'Hotel Grade',  badgeColor: 'bg-indigo-600',
    },
    {
      id: 2,
      name: 'Economy Bath Towel — 380 GSM',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&q=80',
      price: 149,  mrp: 199,
      unit: 'per piece',  size: '70 × 140 cm',  gsm: 380,
      badge: null,  badgeColor: null,
    },
    {
      id: 3,
      name: 'Premium Hand Towel — 500 GSM',
      category: 'hand',
      image: 'https://images.unsplash.com/photo-1600369671738-48af8bb1f2cf?w=400&q=80',
      price: 99,  mrp: 149,
      unit: 'per piece',  size: '40 × 60 cm',  gsm: 500,
      badge: null,  badgeColor: null,
    },
    {
      id: 4,
      name: 'Face Towel — 360 GSM Pack of 6',
      category: 'hand',
      image: 'https://images.unsplash.com/photo-1616048056617-93b94a339009?w=400&q=80',
      price: 249,  mrp: 349,
      unit: 'pack of 6',  size: '30 × 30 cm',  gsm: 360,
      badge: 'Value Pack',  badgeColor: 'bg-green-600',
    },
    {
      id: 5,
      name: 'Gym Sport Towel — Quick Dry',
      category: 'sport',
      image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&q=80',
      price: 199,  mrp: 299,
      unit: 'per piece',  size: '50 × 100 cm',  gsm: 400,
      badge: 'Quick Dry',  badgeColor: 'bg-blue-600',
    },
    {
      id: 6,
      name: 'Hospital Grade Towel — Anti-Microbial',
      category: 'hospital',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
      price: 349,  mrp: 499,
      unit: 'per piece',  size: '70 × 140 cm',  gsm: 550,
      badge: 'Anti-Microbial',  badgeColor: 'bg-red-600',
    },
    {
      id: 7,
      name: 'Hospital Hand Towel — White Pack of 12',
      category: 'hospital',
      image: 'https://images.unsplash.com/photo-1600369671738-48af8bb1f2cf?w=400&q=80',
      price: 799,  mrp: 1099,
      unit: 'pack of 12',  size: '40 × 60 cm',  gsm: 420,
      badge: null,  badgeColor: null,
    },
    {
      id: 8,
      name: 'Hotel Set — 50 Pcs Mixed (Bath + Hand)',
      category: 'set',
      image: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&q=80',
      price: 8999,  mrp: 12999,
      unit: 'set of 50',  size: 'Bath + Hand (mixed)',  gsm: 500,
      badge: 'Bulk Deal',  badgeColor: 'bg-purple-600',
    },
  ],
};
