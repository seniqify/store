// ── ONE PLAN (2026-09) ────────────────────────────────────────────────────────
// PocketLink is a SINGLE subscription — ₹1,099/mo or ₹9,999/yr — that includes
// every feature. There are no tiers, no upsells and no feature gates to explain:
// if a store is paid, it gets everything. That keeps the pitch to one sentence.
//
// The legacy keys below (starter / pro / business / premium) are kept ONLY so
// existing stores and their live Razorpay mandates keep resolving. They now all
// map to the SAME full feature set, so grandfathered customers simply get
// everything too — nothing to migrate, nothing to support-explain.
//
// 'free' remains the limited fallback a lapsed or grandfathered store degrades
// to (page stays live, brand badge returns) until the owner pays again.

// The single paid feature set. Flags for features that are not built yet stay
// false — we never gate on a promise.
const EVERYTHING = {
  name:                'PocketLink',
  products:            Infinity,
  categories:          Infinity,
  badge:               false,   // no "Powered by PocketLink" badge — they pay
  verified:            true,
  promoBanner:         true,
  discountCodes:       true,
  orderHistory:        true,
  analytics:           'full',
  variants:            true,
  prioritySupport:     true,
  aiEmployee:          true,
  abandonedCarts:      true,
  offersEngine:        true,
  autoOrderUpdates:    true,
  aiInsights:          true,
  metaPixel:           true,
  onlinePayments:      true,
  shipping:            true,
  customDomain:        true,
  marketplacePriority: true,
  teamMembers:         true,
  bulkImport:          true,
  festivalMode:        false,   // not built yet — flip when it ships
  whatsappApi:         false,   // not built yet — flip when it ships
};

// Price — the single source of truth. Display everywhere reads from this so the
// pricing page, checkout and landing can never drift apart. NOTE: the amount
// actually DEBITED comes from the Razorpay plan_id in
// supabase/functions/create-razorpay-subscription — these must match it.
export const PRICE = { monthly: 1099, yearly: 9999, currency: '₹' };

export const PLANS = {
  // Lapsed / grandfathered free stores.
  free: {
    name:            'Free',
    products:        10,
    categories:      3,
    badge:           true,
    verified:        false,
    promoBanner:     false,
    discountCodes:   false,
    orderHistory:    false,
    analytics:       false,
    variants:        false,
    prioritySupport: false,
  },

  // The one live plan. New subscriptions record the store as 'premium' (the key
  // already wired through Razorpay notes + the webhook), so nothing downstream
  // needed changing when we collapsed the tiers.
  premium: { ...EVERYTHING },

  // Grandfathered keys — same everything, kept so old configs/mandates resolve.
  starter:  { ...EVERYTHING },
  pro:      { ...EVERYTHING },
  business: { ...EVERYTHING },
};

export function getPlanLimits(plan = 'free') {
  return PLANS[plan] ?? PLANS.free;
}

export function canAddProduct(plan, currentCount) {
  const limit = getPlanLimits(plan).products;
  return limit === Infinity || currentCount < limit;
}

export function canAddCategory(plan, currentCount) {
  const limit = getPlanLimits(plan).categories;
  return limit === Infinity || currentCount < limit;
}

export function hasFeature(plan, feature) {
  return Boolean(getPlanLimits(plan)[feature]);
}

export function showBrandBadge(plan) {
  return getPlanLimits(plan).badge === true;
}

// A paid plan is any plan that no longer carries the PocketLink brand badge.
export function isPaidPlan(plan) {
  return !showBrandBadge(plan);
}

// The "Verified" store badge — carried by every paid store.
export function isVerified(plan) {
  return getPlanLimits(plan).verified === true;
}

// The plan a store is *currently entitled to*, accounting for a lapsed plan.
// A paid plan with a `planExpiresAt` in the past reverts to 'free' (the page
// loses its paid features until the owner pays). Pass the config.
export function effectivePlan(config) {
  const plan = config?.plan ?? 'free';
  const exp  = config?.planExpiresAt;
  if (plan !== 'free' && exp && new Date(exp).getTime() < Date.now()) return 'free';
  return plan;
}

// Whole days left on a trial (`planExpiresAt`). null if no expiry; 0 if past.
export function trialDaysLeft(config) {
  const exp = config?.planExpiresAt;
  if (!exp) return null;
  const ms = new Date(exp).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}
