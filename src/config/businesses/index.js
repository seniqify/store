/**
 * Business Registry
 * ───────────────────────────────────────────────────────────���─────────────────
 * Maps URL slug → business config object.
 *
 * To add a new business:
 *   1. Create src/config/businesses/<slug>.js  (same shape as other configs)
 *   2. Import it here and add one line to REGISTRY
 *   3. That's it — no UI code changes needed
 *
 * The slug is also the URL path: /rkenterprises → loads rkConfig
 */

import { softweaveConfig }   from './softweave';
import { sukhsagarConfig }   from './sukhsagartowels';
import { rkConfig }          from './rkenterprises';

const REGISTRY = {
  softweave:       softweaveConfig,
  sukhsagartowels: sukhsagarConfig,
  rkenterprises:   rkConfig,
};

export default REGISTRY;
