/**
 * planLimits — defines what each plan can and cannot do.
 * Single source of truth for enforcement across onboarding + manage store.
 */

export const PLANS = {
  free: {
    name:             'Free',
    price:            0,
    products:         3,
    categories:       2,
    badge:            true,   // "Powered by Ordify" shown
    customDomain:     false,
    promoBanner:      false,
    discountCodes:    false,
    orderHistory:     false,
    analytics:        false,
    variants:         false,
    bulkUpload:       false,
    prioritySupport:  false,
  },
  starter: {
    name:             'Starter',
    price:            299,
    products:         10,
    categories:       5,
    badge:            false,
    customDomain:     false,
    promoBanner:      true,
    discountCodes:    false,
    orderHistory:     true,
    analytics:        'basic',
    variants:         false,
    bulkUpload:       false,
    prioritySupport:  false,
  },
  growth: {
    name:             'Growth',
    price:            699,
    products:         50,
    categories:       15,
    badge:            false,
    customDomain:     true,
    promoBanner:      true,
    discountCodes:    true,
    orderHistory:     true,
    analytics:        'full',
    variants:         true,
    bulkUpload:       true,
    prioritySupport:  true,
  },
  pro: {
    name:             'Pro',
    price:            1499,
    products:         200,
    categories:       Infinity,
    badge:            false,
    customDomain:     true,
    promoBanner:      true,
    discountCodes:    true,
    orderHistory:     true,
    analytics:        'full',
    variants:         true,
    bulkUpload:       true,
    prioritySupport:  true,
  },
};

export function getPlanLimits(plan = 'free') {
  return PLANS[plan] ?? PLANS.free;
}

export function canAddProduct(plan, currentCount) {
  return currentCount < getPlanLimits(plan).products;
}

export function canAddCategory(plan, currentCount) {
  const limit = getPlanLimits(plan).categories;
  return limit === Infinity || currentCount < limit;
}

export function hasFeature(plan, feature) {
  return Boolean(getPlanLimits(plan)[feature]);
}

export function showOrdifyBadge(plan) {
  return getPlanLimits(plan).badge === true;
}
