/**
 * Aanya Boutique — slug: aanyaboutique  (DEMO · product/retail)
 * Ethnic & fusion womenswear. Rose theme.
 */
export const aanyaBoutiqueConfig = {
  slug:         'aanyaboutique',
  businessType: 'product',
  businessName: 'Aanya Boutique',
  name:         'Aanya Boutique',
  tagline:      'Ethnic & fusion wear, curated for every occasion',
  logo:         null,
  logoEmoji:    '👗',
  coverImage:   'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1600&q=80',

  whatsappNumber: '919876543210',
  whatsapp:       '919876543210',
  phone:   '+91 98765 43210',
  email:   'hello@aanyaboutique.in',
  address: 'Linking Road, Bandra, Mumbai — 400050',
  gst:     'GST No: 27ABCDE1234F1Z5',
  upi:     'aanyaboutique@upi',

  theme: { primary: '#e11d48', primaryDark: '#be123c', accent: '#f59e0b', accentDark: '#d97706' },
  cart:  { taxRate: 0.05, freeShippingAbove: 1499, shippingCharge: 79 },

  promoText: '🎉 Festive Edit is live · Flat 20% off on sarees this week',

  categories: [
    { id: 'all',       label: 'All Pieces', emoji: '🛍️' },
    { id: 'kurta',     label: 'Kurta Sets', emoji: '👚' },
    { id: 'saree',     label: 'Sarees',     emoji: '🥻' },
    { id: 'dress',     label: 'Dresses',    emoji: '👗' },
    { id: 'accessory', label: 'Dupattas',   emoji: '🧣' },
  ],

  features: [
    { emoji: '🪡', title: 'Hand-finished',  desc: 'Boutique-quality stitching' },
    { emoji: '📏', title: 'Free Alterations', desc: 'Perfect fit, guaranteed' },
    { emoji: '🚚', title: 'Pan-India Ship',  desc: 'Delivered in 3–6 days' },
    { emoji: '🔄', title: 'Easy Returns',    desc: '7-day exchange' },
  ],

  products: [
    { id: 1, name: 'Anarkali Kurta Set', category: 'kurta', price: 1899, mrp: 2499, unit: 'with dupatta',
      badge: 'Bestseller', badgeColor: 'bg-brand',
      image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80' },
    { id: 2, name: 'Banarasi Silk Saree', category: 'saree', price: 3499, mrp: 4999, unit: 'with blouse piece',
      badge: '30% Off', badgeColor: 'bg-green-600',
      image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80' },
    { id: 3, name: 'Cotton Printed Kurti', category: 'kurta', price: 799, mrp: 1099, unit: 'per piece',
      image: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=80' },
    { id: 4, name: 'Indo-Western Dress', category: 'dress', price: 1599, unit: 'per piece',
      badge: 'New In', badgeColor: 'bg-rose-500',
      image: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=600&q=80' },
    { id: 5, name: 'Embroidered Dupatta', category: 'accessory', price: 549, mrp: 799, unit: 'per piece',
      image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&q=80' },
    { id: 6, name: 'Festive Lehenga Choli', category: 'dress', price: 4999, mrp: 6999, unit: '3-piece set',
      badge: 'Premium', badgeColor: 'bg-purple-600',
      image: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&q=80' },
  ],
};
