/**
 * Spice Route Kitchen — slug: spiceroute  (DEMO · restaurant/food)
 * Authentic North Indian, cooked fresh. Orange theme.
 */
export const spiceRouteConfig = {
  slug:         'spiceroute',
  businessType: 'restaurant',
  category:     'Restaurant',
  businessName: 'Spice Route Kitchen',
  name:         'Spice Route Kitchen',
  tagline:      'Authentic North Indian, cooked fresh to order',
  logo:         null,
  logoEmoji:    '🍛',
  coverImage:   'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&q=80',

  whatsappNumber: '919876543210',
  whatsapp:       '919876543210',
  phone:   '+91 98765 43210',
  email:   'orders@spiceroute.in',
  address: 'Koramangala 5th Block, Bengaluru — 560095',
  city:    'Bengaluru',
  state:   'Karnataka',
  upi:     'spiceroute@upi',

  theme: { primary: '#ea580c', primaryDark: '#c2410c', accent: '#f59e0b', accentDark: '#d97706' },
  cart:  { taxRate: 0.05, freeShippingAbove: 499, shippingCharge: 39 },

  categories: [
    { id: 'all',     label: 'Full Menu', emoji: '🍽️' },
    { id: 'starter', label: 'Starters',  emoji: '🥘' },
    { id: 'main',    label: 'Mains',     emoji: '🍛' },
    { id: 'bread',   label: 'Breads',    emoji: '🫓' },
    { id: 'dessert', label: 'Desserts',  emoji: '🍮' },
  ],

  features: [
    { emoji: '🌶️', title: 'Cooked Fresh',  desc: 'Made to order' },
    { emoji: '🥡', title: 'Hygienic Pack', desc: 'Sealed & safe' },
    { emoji: '⚡', title: '30-min Prep',   desc: 'Hot & quick' },
    { emoji: '💬', title: 'WhatsApp',      desc: 'Order on chat' },
  ],

  products: [
    { id: 1, name: 'Paneer Tikka', category: 'starter', price: 240, mrp: 280, unit: 'serves 2',
      badge: 'Bestseller', badgeColor: 'bg-brand',
      image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=600&q=80' },
    { id: 2, name: 'Butter Chicken', category: 'main', price: 320, unit: 'serves 2',
      image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&q=80' },
    { id: 3, name: 'Dal Makhani', category: 'main', price: 220, unit: 'serves 2',
      image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&q=80' },
    { id: 4, name: 'Veg Biryani', category: 'main', price: 260, mrp: 300, unit: 'serves 1',
      badge: '13% Off', badgeColor: 'bg-green-600',
      image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80' },
    { id: 5, name: 'Garlic Naan', category: 'bread', price: 60, unit: 'per piece',
      image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&q=80' },
    { id: 6, name: 'Gulab Jamun', category: 'dessert', price: 90, unit: '2 pieces',
      image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&q=80' },
  ],
};
