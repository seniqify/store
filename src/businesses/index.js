/**
 * Business Registry — demo storefronts
 * ─────────────────────────────────────────────────────────────────────────────
 * One polished demo per business type, shown on the landing page (#demos) and
 * reachable at /demo/<slug>. These are NOT real user stores.
 *
 * To add a demo:
 *   1. Create  src/businesses/<slug>.js  (follow the same config shape)
 *   2. Import it below and add one line to REGISTRY
 */

import { aanyaBoutiqueConfig }  from './aanyaboutique';   // product / retail
import { glowUpConfig }         from './glowup';          // service / agency

const REGISTRY = {
  aanyaboutique: aanyaBoutiqueConfig,
  glowup:        glowUpConfig,
};

export default REGISTRY;
