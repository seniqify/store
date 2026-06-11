export const PLANS = {
  free: {
    name:            'Free',
    products:        10,
    categories:      2,
    badge:           true,
    verified:        false,
    promoBanner:     false,
    discountCodes:   false,
    orderHistory:    false,
    analytics:       false,
    variants:        false,
    prioritySupport: false,
  },
  pro: {
    name:            'Pro',
    products:        50,
    categories:      10,
    badge:           false,
    verified:        true,
    promoBanner:     true,
    discountCodes:   false,
    orderHistory:    true,
    analytics:       'basic',
    variants:        false,
    prioritySupport: false,
  },
  business: {
    name:            'Business',
    products:        Infinity,
    categories:      Infinity,
    badge:           false,
    verified:        true,
    promoBanner:     true,
    discountCodes:   true,
    orderHistory:    true,
    analytics:       'full',
    variants:        true,
    prioritySupport: true,
    whatsappApi:     false,   // WhatsApp API number connect is Premium-only
  },
  premium: {
    name:            'Premium',
    products:        Infinity,
    categories:      Infinity,
    badge:           false,
    verified:        true,
    promoBanner:     true,
    discountCodes:   true,
    orderHistory:    true,
    analytics:       'full',
    variants:        true,
    prioritySupport: true,
    whatsappApi:     false,   // WhatsApp API connect is built later — flip when it ships
  },
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
// Used to gate premium-only UI like the "Verified" store badge.
export function isPaidPlan(plan) {
  return !showBrandBadge(plan);
}

// The "Verified" store badge is a trust signal reserved for the higher tiers
// (Pro & Business). Starter is paid but does NOT get Verified — gate the badge
// on this, not isPaidPlan.
export function isVerified(plan) {
  return getPlanLimits(plan).verified === true;
}

// The plan a store is *currently entitled to*, accounting for a lapsed free
// trial. A paid plan with a `planExpiresAt` in the past reverts to 'free'
// (the page loses its paid features until the owner pays). Pass the config.
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
