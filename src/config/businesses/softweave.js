/**
 * SoftWeave Towels — slug: softweave
 * Source of truth: spread from the master businessConfig and add slug.
 * All data lives in businessConfig.js; no duplication.
 */
import { BUSINESS_CONFIG } from '../businessConfig';

export const softweaveConfig = {
  ...BUSINESS_CONFIG,
  slug: 'softweave',
};
