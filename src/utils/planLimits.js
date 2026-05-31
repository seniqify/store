export const PLANS = {
  free: {
    name:            'Free',
    products:        2,
    categories:      1,
    badge:           true,
    promoBanner:     false,
    discountCodes:   false,
    orderHistory:    false,
    analytics:       false,
    variants:        false,
    prioritySupport: false,
  },
  pro: {
    name:            'Pro',
    products:        20,
    categories:      5,
    badge:           false,
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
    promoBanner:     true,
    discountCodes:   true,
    orderHistory:    true,
    analytics:       'full',
    variants:        true,
    prioritySupport: true,
  },
  // legacy aliases so old stores don't break
  starter: {
    name:            'Starter',
    products:        10,
    categories:      5,
    badge:           false,
    promoBanner:     true,
    discountCodes:   false,
    orderHistory:    true,
    analytics:       'basic',
    variants:        false,
    prioritySupport: false,
  },
  growth: {
    name:            'Growth',
    products:        50,
    categories:      15,
    badge:           false,
    promoBanner:     true,
    discountCodes:   true,
    orderHistory:    true,
    analytics:       'full',
    variants:        true,
    prioritySupport: true,
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
