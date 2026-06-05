/**
 * The Coral Courtyard — slug: coralcourtyard  (DEMO · lodges & stay)
 * Boutique stay near the Goa coast. Amber/gold theme to match the lodge layout.
 */
export const coralCourtyardConfig = {
  slug:         'coralcourtyard',
  businessType: 'hotel',
  category:     'Resort',
  businessName: 'The Coral Courtyard',
  name:         'The Coral Courtyard',
  tagline:      'A boutique escape moments from the Goan coast',
  logo:         null,
  logoEmoji:    '🏝️',
  coverImage:   'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=80',

  whatsappNumber: '919876543210',
  whatsapp:       '919876543210',
  phone:   '+91 98765 43210',
  email:   'stay@coralcourtyard.in',
  address: 'Calangute, Goa — 403516',
  city:    'Calangute',
  state:   'Goa',

  theme: { primary: '#d97706', primaryDark: '#b45309', accent: '#f59e0b', accentDark: '#92400e' },
  cart:  { taxRate: 0, freeShippingAbove: 0, shippingCharge: 0 },

  categories: [{ id: 'all', label: 'All', emoji: '🛎️' }],

  features: [
    { emoji: '🏊', title: 'Infinity Pool', desc: 'Sunrise to sunset, heated' },
    { emoji: '🍳', title: 'Breakfast',     desc: 'Complimentary, à la carte' },
    { emoji: '📶', title: 'Fast Wi-Fi',    desc: 'Free, full property' },
    { emoji: '🚗', title: 'Free Parking',  desc: 'Valet on arrival' },
  ],

  products: [
    { id: 1, name: 'Garden Deluxe Room', price: 3200,
      description: 'Queen bed opening to a private garden patio. Perfect for couples.',
      image: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=80' },
    { id: 2, name: 'Coral Suite', price: 5400,
      description: 'Spacious suite with a sea-view balcony, lounge area and rain shower.',
      image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80' },
    { id: 3, name: 'Poolside Villa', price: 7800,
      description: 'Standalone villa with direct pool access and an outdoor sit-out.',
      image: 'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=800&q=80' },
    { id: 4, name: 'Family Courtyard Room', price: 4600,
      description: 'Two queen beds around the central courtyard — room for the whole family.',
      image: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800&q=80' },
  ],
};
