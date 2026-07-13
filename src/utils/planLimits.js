export const PLANS = {
  // 'free' is no longer offered to new users — kept as the internal fallback a
  // lapsed paid store degrades to (page stays live, badge returns), and for
  // grandfathered existing free stores.
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
  // Starter — the new paid entry tier (₹129). Same limits as the old Free, but
  // no "Powered by PocketLink" badge (they're paying).
  starter: {
    name:            'Starter',
    products:        10,
    categories:      2,
    badge:           false,
    verified:        false,
    promoBanner:     false,
    discountCodes:   false,
    orderHistory:    false,
    analytics:       false,
    variants:        false,
    prioritySupport: false,
  },
  // 'pro' (₹249) is retired from the offered tiers but kept so any grandfathered
  // Pro store keeps resolving to its old limits.
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
  // ── Growth — the ₹199 entry paid tier (displayed "Growth"). A complete,
  // professional store capped at 50 products, now including the AI product
  // assistant and priority support. (Internal key stays 'business' so the
  // existing Razorpay plan_id mapping and current stores keep working.) ──
  business: {
    name:             'Growth',
    products:         50,
    categories:       10,
    badge:            false,
    verified:         true,
    promoBanner:      true,
    discountCodes:    true,
    orderHistory:     true,
    analytics:        'basic',
    variants:         true,
    prioritySupport:  true,
    aiEmployee:       true,     // Growth now includes the AI product assistant
    abandonedCarts:   true,     // see + recover abandoned checkouts
    offersEngine:     false,
    autoOrderUpdates: false,   // Growth sends order updates one tap at a time
    festivalMode:     false,
    whatsappApi:      false,
  },
  // ── Pro — the ₹599 scale tier (displayed "Pro"; internal key stays 'premium').
  // Unlimited everything plus the full AI dashboard, custom domain, marketplace
  // priority ranking, team members and bulk import. The reasons to step up from
  // Growth. (Some flags below are roadmap intent — copy is shown on the pricing
  // page; enforce/gate them as each feature ships.) ──
  premium: {
    name:              'Pro',
    products:          Infinity,
    categories:        Infinity,
    badge:             false,
    verified:          true,
    promoBanner:       true,
    discountCodes:     true,
    orderHistory:      true,
    analytics:         'full',
    variants:          true,
    prioritySupport:   true,
    aiEmployee:        true,
    abandonedCarts:    true,
    offersEngine:      true,
    autoOrderUpdates:  true,
    aiInsights:        true,    // AI customer/search/sales dashboards
    customDomain:      true,    // roadmap — flip on gate when custom domains ship
    marketplacePriority: true,  // roadmap — higher marketplace ranking
    teamMembers:       true,    // roadmap — multiple logins
    bulkImport:        true,    // roadmap — CSV/bulk product import
    festivalMode:      false,   // Festival Mode ships later — flip when it's built
    whatsappApi:       false,   // WhatsApp API connect is built later — flip when it ships
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

// The "Verified" store badge is a trust signal carried by the offered paid
// tiers (Standard & Premium, plus grandfathered Pro). Gate the badge on this,
// not isPaidPlan.
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
