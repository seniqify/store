/**
 * GlowUp Salon & Spa — slug: glowup  (DEMO · service/agency)
 * Salon & spa, studio or at-home. Purple theme.
 */
export const glowUpConfig = {
  slug:         'glowup',
  businessType: 'service',
  category:     'Beauty',
  businessName: 'GlowUp Salon & Spa',
  name:         'GlowUp Salon & Spa',
  tagline:      'Premium salon & spa — at our studio or your home',
  logo:         null,
  logoEmoji:    '💇',
  coverImage:   'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1600&q=80',

  whatsappNumber: '919876543210',
  whatsapp:       '919876543210',
  phone:   '+91 98765 43210',
  email:   'book@glowup.in',
  address: 'Banjara Hills, Hyderabad — 500034',

  theme: { primary: '#9333ea', primaryDark: '#7e22ce', accent: '#f59e0b', accentDark: '#d97706' },
  cart:  { taxRate: 0, freeShippingAbove: 0, shippingCharge: 0 },

  categories: [{ id: 'all', label: 'All', emoji: '✨' }],

  features: [
    { emoji: '✨', title: 'Expert Stylists', desc: '10+ yrs experience' },
    { emoji: '🏠', title: 'At-home Service', desc: 'We come to you' },
    { emoji: '🗓️', title: 'Easy Booking',    desc: 'Pick your slot' },
    { emoji: '💬', title: 'WhatsApp Support', desc: 'Quick replies' },
  ],

  products: [
    { id: 1, name: 'Signature Haircut & Style', price: 499,
      description: 'Consultation, wash, precision cut and blow-dry by a senior stylist.',
      image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&q=80' },
    { id: 2, name: 'Glow Facial (60 min)', price: 1200,
      description: 'Deep-cleanse, exfoliation and a brightening mask for radiant skin.',
      image: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=600&q=80' },
    { id: 3, name: 'Bridal Makeup Package', price: 8500,
      description: 'HD bridal makeup, draping and a trial session for your big day.',
      image: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&q=80' },
    { id: 4, name: 'Relaxing Spa Massage', price: 1800,
      description: 'Full-body aroma massage to melt away stress and tension.',
      image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&q=80' },
    { id: 5, name: 'Hair Spa & Treatment', price: 999,
      description: 'Nourishing hair spa to repair, hydrate and add shine.',
      image: 'https://images.unsplash.com/photo-1522337660859-02fbefca4702?w=600&q=80' },
    { id: 6, name: 'Manicure & Pedicure', price: 749,
      description: 'Classic mani-pedi with cleanup, polish and a relaxing soak.',
      image: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=600&q=80' },
  ],
};
