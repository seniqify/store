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


// Type-appropriate highlight/amenity suggestions, shared with the onboarding form.
export const FEATURE_SUGGESTIONS = {
  product: [
    { emoji: '🚚', title: 'Fast Delivery',    desc: 'Quick & reliable' },
    { emoji: '📄', title: 'GST Invoice',       desc: 'Proper billing'   },
    { emoji: '✅', title: 'Genuine Products',  desc: '100% authentic'   },
    { emoji: '💬', title: 'WhatsApp Orders',   desc: 'Order on chat'    },
    { emoji: '↩️', title: 'Easy Returns',      desc: 'Hassle-free'      },
    { emoji: '🏷️', title: 'Best Prices',       desc: 'Great value'      },
  ],
  restaurant: [
    { emoji: '🌶️', title: 'Cooked Fresh',      desc: 'Made to order'    },
    { emoji: '🥡', title: 'Hygienic Packing',  desc: 'Sealed & safe'    },
    { emoji: '⚡', title: 'Quick Prep',        desc: 'Hot & fast'       },
    { emoji: '🌿', title: 'Pure Veg',          desc: '100% vegetarian'  },
    { emoji: '🚚', title: 'Home Delivery',     desc: 'To your door'     },
    { emoji: '💬', title: 'WhatsApp Orders',   desc: 'Order on chat'    },
  ],
  service: [
    { emoji: '✨', title: 'Expert Team',       desc: 'Skilled pros'     },
    { emoji: '🏠', title: 'At-home Service',   desc: 'We come to you'   },
    { emoji: '🗓️', title: 'Easy Booking',      desc: 'Pick your slot'   },
    { emoji: '💬', title: 'Free Consultation', desc: 'On WhatsApp'      },
    { emoji: '⭐', title: 'Top Rated',         desc: 'Trusted by many'  },
    { emoji: '💯', title: 'Satisfaction',      desc: 'Guaranteed'       },
  ],
  hotel: [
    { emoji: '🏊', title: 'Swimming Pool',     desc: ''                 },
    { emoji: '🍳', title: 'Breakfast',         desc: 'Complimentary'    },
    { emoji: '📶', title: 'Free Wi-Fi',        desc: 'Full property'    },
    { emoji: '🚗', title: 'Free Parking',      desc: ''                 },
    { emoji: '❄️', title: 'Air Conditioning',  desc: ''                 },
    { emoji: '🛎️', title: 'Room Service',      desc: '24×7'             },
    { emoji: '🍽️', title: 'Restaurant',        desc: 'On-site dining'   },
    { emoji: '🏞️', title: 'Scenic View',       desc: ''                 },
  ],
};

export const DEFAULT_TAGLINES = {
  product:    'Quality products, delivered. Order on WhatsApp.',
  restaurant: 'Fresh, delicious food — order on WhatsApp.',
  service:    'Trusted services, just a message away.',
  hotel:      'A comfortable stay, booked on WhatsApp.',
};

export function buildBusinessConfig(wizardData, existingSlugs = []) {
  const {
    businessType       = 'product',
    category           = '',
    businessName,
    tagline            = '',
    address            = '',
    state              = '',
    city               = '',
    pincode            = '',
    area               = '',
    features           = [],
    whatsappNumber,
    logoEmoji          = '🏪',
    logo               = '',
    coverImage         = '',
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

  const resolvedFeatures = (features && features.length)
    ? features
    : (FEATURE_SUGGESTIONS[businessType] ?? FEATURE_SUGGESTIONS.product).slice(0, 4);

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
    image:       p.image?.trim() || '',
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
    tagline:      tagline.trim() || (DEFAULT_TAGLINES[businessType] ?? DEFAULT_TAGLINES.product),
    logo:         logo?.trim() || null,
    coverImage:   coverImage?.trim() || null,
    logoEmoji,

    whatsappNumber: `91${digits}`,
    phone:          phoneFormatted,
    email:          '',
    address:        address.trim(),
    state:          state.trim(),
    city:           city.trim(),
    pincode:        pincode.trim(),
    area:           area.trim(),
    category:       category.trim(),
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

    features: resolvedFeatures,

    categories: allCategories,
    products:   builtProducts,
  };
}
