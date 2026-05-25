/**
 * R.K. Enterprises — slug: rkenterprises
 * Home textiles wholesale from Surat. Orange theme. 12% GST (HSN 6302).
 */
export const rkConfig = {
  slug: 'rkenterprises',
  name: 'R.K. Enterprises',
  tagline: 'Home Textiles Wholesale — Since 1998',
  logo: null,
  logoEmoji: '🏡',

  whatsapp: '917799334455',
  phone: '+91 77993 34455',
  email: 'sales@rkenterprises.in',
  address: 'Ring Road, Surat, Gujarat — 395002',
  gst: 'GST No: 24ZZZZZ9012B1Z1',
  upi: 'rkenterprises@upi',

  theme: {
    primary:     '#f97316',   // orange-500
    primaryDark: '#ea580c',   // orange-600
    accent:      '#0d9488',   // teal — keeps contrast with orange
    accentDark:  '#0f766e',
  },

  cart: {
    taxRate:           0.12,  // 12% GST on home textiles (HSN 6302)
    freeShippingAbove: 799,
    shippingCharge:    59,
  },

  hero: {
    eyebrow: '🏭 Direct from Surat — India\'s Textile Capital',
    heading: 'Premium Home\nTextiles at Wholesale',
    subtext:
      'Bed sheets, pillow covers, blankets & more. Minimum 10 pcs per design. Pan-India delivery.',
    cta: 'View Products',
  },

  features: [
    { emoji: '🛏️', title: '100+ Designs',    desc: 'New arrivals every week'  },
    { emoji: '📦', title: 'Wholesale',       desc: 'Min 10 pcs per design'    },
    { emoji: '📄', title: 'GST Invoice',     desc: '12% HSN 6302 billing'     },
    { emoji: '🚚', title: 'Pan-India',       desc: 'All pincodes, 3–7 days'   },
  ],

  categories: [
    { id: 'all',      label: 'All Products',  emoji: '🏠'  },
    { id: 'bedsheet', label: 'Bed Sheets',    emoji: '🛏️' },
    { id: 'pillow',   label: 'Pillow Covers', emoji: '🛌'  },
    { id: 'blanket',  label: 'Blankets',      emoji: '🌡️' },
    { id: 'bath',     label: 'Bath Towels',   emoji: '🛀'  },
    { id: 'set',      label: 'Combo Sets',    emoji: '🎁'  },
  ],

  products: [
    {
      id: 1,
      name: 'Pure Cotton Bedsheet — King Size',
      category: 'bedsheet',
      image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&q=80',
      price: 599,  mrp: 899,
      unit: 'per piece',  size: '108 × 108 inches',  gsm: 180,
      badge: 'Best Seller',  badgeColor: 'bg-orange-500',
    },
    {
      id: 2,
      name: 'Floral Print Bedsheet — Single',
      category: 'bedsheet',
      image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80',
      price: 349,  mrp: 499,
      unit: 'per piece',  size: '60 × 90 inches',  gsm: 160,
      badge: null,  badgeColor: null,
    },
    {
      id: 3,
      name: 'Cotton Pillow Cover — Pack of 2',
      category: 'pillow',
      image: 'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=400&q=80',
      price: 149,  mrp: 199,
      unit: 'pack of 2',  size: '17 × 27 inches',  gsm: 160,
      badge: null,  badgeColor: null,
    },
    {
      id: 4,
      name: 'Embroidered Pillow Cover Set of 5',
      category: 'pillow',
      image: 'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=400&q=80',
      price: 399,  mrp: 599,
      unit: 'set of 5',  size: '17 × 27 inches',  gsm: 180,
      badge: 'Fancy',  badgeColor: 'bg-pink-500',
    },
    {
      id: 5,
      name: 'Microfibre Blanket — All Season',
      category: 'blanket',
      image: 'https://images.unsplash.com/photo-1576618148400-f54bed99fcfd?w=400&q=80',
      price: 799,  mrp: 1199,
      unit: 'per piece',  size: '60 × 80 inches',  gsm: 250,
      badge: 'All Season',  badgeColor: 'bg-blue-600',
    },
    {
      id: 6,
      name: 'Woollen Blanket — Winter Heavy',
      category: 'blanket',
      image: 'https://images.unsplash.com/photo-1576618148400-f54bed99fcfd?w=400&q=80',
      price: 1199,  mrp: 1699,
      unit: 'per piece',  size: '60 × 80 inches',  gsm: 500,
      badge: 'Winter',  badgeColor: 'bg-indigo-600',
    },
    {
      id: 7,
      name: 'Cotton Bath Towel — 500 GSM',
      category: 'bath',
      image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&q=80',
      price: 249,  mrp: 349,
      unit: 'per piece',  size: '70 × 140 cm',  gsm: 500,
      badge: null,  badgeColor: null,
    },
    {
      id: 8,
      name: 'Bedroom Combo — Sheet + 2 Pillows + Blanket',
      category: 'set',
      image: 'https://images.unsplash.com/photo-1631049552057-403cdb8f0658?w=400&q=80',
      price: 1299,  mrp: 1899,
      unit: 'set of 4 pcs',  size: 'King Size',  gsm: null,
      badge: '32% Off',  badgeColor: 'bg-red-500',
    },
  ],
};
