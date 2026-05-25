/**
 * Business Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps URL slug → business config object.
 *
 * To register a new business:
 *   1. Create  src/businesses/<slug>.js  (follow the same config shape)
 *   2. Import it below and add one line to REGISTRY
 *   3. Done — routing, theming, and the storefront all adapt automatically
 *
 * The slug is the URL path:  /<slug>  →  loads the matching config
 */

import { softweaveConfig }      from './softweave';
import { rkElectronicsConfig }  from './rkelectronics';
import { defaultConfig }        from './default';

const REGISTRY = {
  softweave:    softweaveConfig,
  rkelectronics: rkElectronicsConfig,
  default:      defaultConfig,
};

export default REGISTRY;
