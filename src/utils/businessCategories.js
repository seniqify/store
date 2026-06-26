/**
 * Sub-categories under each of the 4 main business types. The chosen sub-category
 * becomes the store's marketplace `category` (richer than the old 8 buckets), and
 * powers the marketplace filter pills, tiles and card chips.
 */

export const SUBCATEGORIES = {
  product: [
    ['Grocery & Kirana', '🛒'],
    ['Clothing & Fashion', '👗'],
    ['Electronics', '📱'],
    ['Mobile & Accessories', '📲'],
    ['Construction & Hardware', '🏗️'],
    ['Textiles & Fabrics', '🧵'],
    ['Jewellery', '💍'],
    ['Footwear', '👟'],
    ['Pharmacy & Medical', '💊'],
    ['Books & Stationery', '📚'],
    ['Home & Furniture', '🛋️'],
    ['Beauty & Cosmetics', '💄'],
    ['Sports & Fitness', '⚽'],
    ['Gifts & Toys', '🎁'],
    ['Auto & Parts', '🚗'],
    ['Agriculture & Farming', '🌾'],
    ['Pet Supplies', '🐾'],
    ['Wholesale & Manufacturing', '🏭'],
    ['Other Retail', '🏪'],
  ],
  service: [
    ['Salon & Beauty', '💇'],
    ['Repairs & Maintenance', '🔧'],
    ['Home Services', '🏠'],
    ['Education & Tuition', '📚'],
    ['Healthcare & Clinic', '🏥'],
    ['Consulting & Professional', '💼'],
    ['Photography & Video', '📷'],
    ['Events & Decor', '🎉'],
    ['Fitness & Gym', '🏋️'],
    ['Travel & Tours', '✈️'],
    ['Logistics & Courier', '🚚'],
    ['Other Services', '🧰'],
  ],
};

// A colourful rotating palette so the marketplace tiles/chips stay vibrant.
const PALETTE = [
  ['#fb7185', '#e11d48'], ['#f472b6', '#db2777'], ['#60a5fa', '#2563eb'],
  ['#c084fc', '#9333ea'], ['#4ade80', '#16a34a'], ['#818cf8', '#4f46e5'],
  ['#fbbf24', '#d97706'], ['#2dd4bf', '#0d9488'], ['#fb923c', '#ea580c'],
  ['#a3e635', '#65a30d'], ['#38bdf8', '#0284c7'], ['#f59e0b', '#b45309'],
];

// Legacy / food / hospitality categories some existing stores use that aren't
// offered as onboarding sub-categories. Listed here so the marketplace styles
// them with a real emoji + colour instead of the grey "🏪" fallback.
const EXTRA_CATEGORIES = [
  ['Restaurant', '🍽️'], ['Cafe & Tea', '☕'], ['Bakery & Cakes', '🍰'],
  ['Sweets & Bakery', '🧁'], ['Cloud Kitchen', '🍱'], ['Food & Beverage', '🍔'],
  ['Home & Textiles', '🧺'], ['Lodge & Stay', '🏨'], ['Homestay', '🏡'], ['Hotel', '🏨'],
];

// Categories hidden from the consumer marketplace — hospitality + dining don't
// fit the WhatsApp-order model, so businesses in these categories aren't listed
// (and their tiles/chips don't appear).
export const MARKETPLACE_HIDDEN_CATEGORIES = new Set([
  'Restaurant', 'Cafe & Tea', 'Cloud Kitchen', 'Food & Beverage',
  'Lodge & Stay', 'Homestay', 'Hotel',
]);

// Generic / B2B catch-all categories — kept in the marketplace but always sorted
// to the END (never leading the chips/tiles), even when they have the most stores.
export const MARKETPLACE_DEPRIORITIZED_CATEGORIES = new Set([
  'Other Retail', 'Other Services',
  'Wholesale & Manufacturing', 'Manufacturer', 'Wholesaler', 'Wholesale', 'Manufacturing',
]);

// Flat lookup: category id -> { emoji, grad, type }
const META = {};
let _i = 0;
for (const [type, list] of Object.entries(SUBCATEGORIES)) {
  for (const [id, emoji] of list) {
    META[id] = { emoji, grad: PALETTE[_i % PALETTE.length], type };
    _i++;
  }
}
for (const [id, emoji] of EXTRA_CATEGORIES) {
  if (!META[id]) { META[id] = { emoji, grad: PALETTE[_i % PALETTE.length], type: 'product' }; _i++; }
}

/** Emoji + gradient for a category id (falls back to a neutral chip). */
export function categoryMeta(id) {
  return META[id] || { emoji: '🏪', grad: ['#94a3b8', '#475569'], type: 'product' };
}

/** Sub-category options for a business type, as [{ id, emoji }]. */
export function subcategoriesForType(type) {
  return (SUBCATEGORIES[type] || SUBCATEGORIES.product).map(([id, emoji]) => ({ id, emoji }));
}

/** Default category when a store hasn't picked one yet. */
export const DEFAULT_CATEGORY = {
  product: 'Other Retail',
  service: 'Other Services',
};

// Curated icon suggestions per sub-category (first one = the smart default).
const CATEGORY_ICONS = {
  // product
  'Grocery & Kirana':        ['🛒', '🥬', '🥦', '🥕', '🧅', '🥔', '🍅', '🌽', '🍆', '🫑', '🍎', '🍌', '🍊', '🍇', '🍉', '🥛', '🍞', '🥚', '🧀', '🍚', '🌾', '🫘', '🧂', '🧺', '🛍️', '🏪'],
  'Clothing & Fashion':      ['👗', '👕', '👚', '👖', '🧥', '👔', '🧣', '🧤', '🧦', '👜', '👛', '🛍️', '🥻', '🧢', '👒', '🩳', '👙', '🦺', '🥼', '👘'],
  'Electronics':             ['📱', '💻', '🖥️', '⌨️', '🖱️', '🖨️', '📷', '📹', '🎧', '🔊', '📺', '🕹️', '💾', '💿', '🔌', '🔋', '🪫', '💡', '📡', '⌚', '🔦', '🖲️'],
  'Mobile & Accessories':    ['📲', '📱', '🎧', '🔌', '🔋', '🪫', '🔈', '📳', '💽', '🕶️', '⌚', '🔦'],
  'Construction & Hardware': ['🏗️', '🔧', '🔨', '⚒️', '🛠️', '🪓', '🪚', '🪛', '🔩', '⚙️', '🧱', '🪵', '🪜', '🧰', '🪤', '🚧', '🦺', '⛏️', '🔗', '🪟', '🚪', '🧯'],
  'Textiles & Fabrics':      ['🧵', '🪡', '🧶', '🧣', '🧥', '👗', '🥻', '🎽', '🪢', '🧺', '✂️', '🧤', '🧦'],
  'Jewellery':               ['💍', '💎', '📿', '👑', '⌚', '✨', '🪙', '👜', '🥇', '💛', '🔆', '🪞'],
  'Footwear':                ['👟', '👞', '👠', '🥿', '👢', '🩴', '🥾', '👡', '🧦', '👣'],
  'Pharmacy & Medical':      ['💊', '🩺', '🏥', '💉', '🩹', '🌡️', '🧬', '🩻', '🦷', '🧪', '😷', '♿', '🧫', '🥼', '🧴', '🚑'],
  'Books & Stationery':      ['📚', '📖', '📕', '📗', '📘', '📙', '✏️', '✒️', '🖊️', '🖋️', '📝', '📒', '📐', '📏', '🖍️', '📎', '✂️', '🗂️', '📓', '🖌️'],
  'Home & Furniture':        ['🛋️', '🪑', '🛏️', '🚪', '🪞', '🪟', '🧹', '🧺', '🛁', '🚿', '🕯️', '🖼️', '🏠', '🪴', '💡', '🧴', '🪣'],
  'Beauty & Cosmetics':      ['💄', '💅', '🧴', '💋', '🪞', '✨', '🧖', '💆', '🧼', '🪥', '🌸', '💇', '🧽'],
  'Sports & Fitness':        ['⚽', '🏏', '🏸', '🏀', '🏐', '🏈', '🎾', '🏓', '🥊', '🥋', '🏋️', '🚴', '⛳', '🛹', '🏑', '🥅', '🏆', '🤸', '🛼', '🎯'],
  'Gifts & Toys':            ['🎁', '🧸', '🎈', '🪅', '🎀', '🪀', '🧩', '🎮', '🪁', '🎏', '🪆', '🃏', '🎲', '🎠', '🪄'],
  'Auto & Parts':            ['🚗', '🚙', '🛻', '🏍️', '🛺', '🚲', '🛞', '🔧', '🛠️', '⛽', '🔋', '🚘', '🚜', '🧰'],
  'Agriculture & Farming':   ['🌾', '🚜', '🌱', '🌿', '🍃', '🪴', '🥕', '🌽', '🥔', '🐄', '🐓', '🐑', '🪱', '🧑‍🌾', '🪣', '🌻', '🍅', '🐝'],
  'Pet Supplies':            ['🐾', '🐕', '🐈', '🐶', '🐱', '🦴', '🐦', '🐠', '🐹', '🐰', '🦜', '🐢', '🪶', '🐟', '🦮'],
  'Wholesale & Manufacturing': ['🏭', '📦', '🏗️', '🧵', '⚙️', '🚛', '🏬', '🪙', '📊', '🧱', '🛢️', '🔩'],
  'Other Retail':            ['🏪', '🛒', '🛍️', '📦', '🏬', '🧺', '🪙', '🧾'],
  // service
  'Salon & Beauty':          ['💇', '💅', '💄', '✂️', '🧖', '💆', '🪒', '💈', '🧴', '🪞', '🌸', '💋', '🧼'],
  'Repairs & Maintenance':   ['🔧', '🛠️', '🔩', '⚙️', '🪛', '🔌', '🪚', '🔨', '🧰', '🪤', '⚡', '🧯', '🔦'],
  'Home Services':           ['🏠', '🧹', '🧰', '🪣', '🚿', '🔧', '🧽', '🧼', '🪠', '🛠️', '🪜', '💡', '🪟'],
  'Education & Tuition':      ['📚', '✏️', '🎓', '📝', '🧑‍🏫', '📖', '🔬', '🧮', '📐', '🌍', '🖍️', '💡', '🖊️', '📓'],
  'Healthcare & Clinic':     ['🏥', '🩺', '💊', '💉', '🦷', '🧑‍⚕️', '🩻', '🌡️', '🩹', '👶', '🧠', '♿', '🚑'],
  'Consulting & Professional':['💼', '📊', '📈', '📋', '🤝', '🧑‍💼', '💵', '🏦', '📑', '⚖️', '🖋️', '💹'],
  'Photography & Video':     ['📷', '📸', '🎥', '🎬', '🖼️', '📹', '🎞️', '💡', '🖥️', '🎤', '🎛️'],
  'Events & Decor':          ['🎉', '🎈', '🎊', '💐', '🎀', '🪩', '🎂', '🎆', '🎇', '🕯️', '🎵', '💒', '🪅', '🍾'],
  'Fitness & Gym':           ['🏋️', '💪', '🧘', '🤸', '🥊', '🚴', '🤾', '⛹️', '🏃', '🧗', '🥋', '🤺', '🛼', '🏆'],
  'Travel & Tours':          ['✈️', '🧳', '🗺️', '🏖️', '🚌', '🛫', '🏔️', '🗽', '🛳️', '🚆', '🛂', '🌏', '📸', '⛰️'],
  'Logistics & Courier':     ['🚚', '📦', '🛵', '📮', '🚛', '🏷️', '📬', '🗳️', '✉️', '🛻', '📫'],
  'Other Services':          ['🧰', '🛠️', '💼', '🤝', '🔧', '📋'],
};

/** Curated icon suggestions for a category (empty array if none). */
export function iconSuggestions(category) {
  return CATEGORY_ICONS[category] || [];
}

/** The smart-default icon for a category (its first suggestion). */
export function defaultIcon(category) {
  return CATEGORY_ICONS[category]?.[0] || '🏪';
}

/** A broad emoji set for the business-icon picker (onboarding + Manage). */
export const ICON_EMOJIS = [
  '🏪', '🛒', '🛍️', '👗', '👕', '👟', '👜', '💍', '⌚', '🕶️', '📱', '💻',
  '🔌', '📷', '🎧', '🖨️', '🏗️', '🔧', '🔩', '🧱', '🪚', '🧰', '🧵', '🪡',
  '🍽️', '☕', '🍰', '🧁', '🍩', '🍕', '🍔', '🍜', '🍱', '🥗', '🍦', '🍬',
  '🧃', '🥤', '🍷', '💊', '🩺', '🏥', '💉', '🌿', '🪴', '🌸', '💐', '🌳',
  '💄', '💅', '💇', '💆', '🧴', '🧼', '🏨', '🛏️', '🌴', '🏖️', '✈️', '🚗',
  '🛺', '🔑', '📚', '✏️', '🎨', '🎸', '🎯', '⚽', '🏋️', '🧘', '🐾', '🐕',
  '🌾', '🚜', '🧺', '💼', '🏦', '📦', '⚙️', '🔨', '🪙', '🎁', '🪞', '🛠️',
];
