// Server-only configuration for custom merchant domains (PR-C).
//
// Every value here is read from a server-side environment variable on Vercel.
// None is a VITE_* variable, none is ever returned to a browser, and none is
// ever logged -- the only thing that may be reported is WHICH names are
// missing. The underscore prefix keeps this file out of Vercel's route table.
//
// The whole feature is OFF unless CUSTOM_DOMAINS_ENABLED is exactly "true".
// Off means: every merchant endpoint answers feature_disabled before it reads
// the request, and the reconciler makes no Vercel call and no database call.

export const SUPABASE_URL_DEFAULT = 'https://uoyqbexemoheipwrtkcz.supabase.co';

// A shorter HMAC key would still "work", which is exactly why it is refused.
export const MIN_OTP_SECRET_LENGTH = 32;

/** The configuration, from an env object (process.env by default). */
export function domainsConfig(env = process.env) {
  return {
    enabled:         String(env.CUSTOM_DOMAINS_ENABLED ?? '').trim().toLowerCase() === 'true',
    supabaseUrl:     env.SUPABASE_URL || SUPABASE_URL_DEFAULT,
    serviceKey:      env.SUPABASE_SERVICE_ROLE_KEY || '',
    vercelToken:     env.DOMAINS_VERCEL_TOKEN || '',
    vercelProjectId: env.DOMAINS_VERCEL_PROJECT_ID || '',
    vercelTeamId:    env.DOMAINS_VERCEL_TEAM_ID || '',
    otpSecret:       env.DOMAINS_OTP_HMAC_SECRET || '',
    whatsappUrl:     env.SENIQIFY_TEMPLATE_URL || '',
    whatsappKey:     env.SENIQIFY_API_KEY || '',
    cronSecret:      env.CRON_SECRET || '',
  };
}

const REQUIRED = {
  database: [['serviceKey', 'SUPABASE_SERVICE_ROLE_KEY']],
  vercel:   [['vercelToken', 'DOMAINS_VERCEL_TOKEN'], ['vercelProjectId', 'DOMAINS_VERCEL_PROJECT_ID']],
  otp:      [['otpSecret', 'DOMAINS_OTP_HMAC_SECRET'], ['whatsappUrl', 'SENIQIFY_TEMPLATE_URL']],
  cron:     [['cronSecret', 'CRON_SECRET']],
};

/** Names (never values) of the variables a capability still needs. */
export function missingConfig(cfg, capability) {
  const missing = (REQUIRED[capability] || []).filter(([k]) => !cfg[k]).map(([, name]) => name);
  if (capability === 'otp' && cfg.otpSecret && cfg.otpSecret.length < MIN_OTP_SECRET_LENGTH) {
    missing.push('DOMAINS_OTP_HMAC_SECRET (too short)');
  }
  if (capability === 'vercel' && cfg.vercelProjectId && !/^prj_[A-Za-z0-9]+$/.test(cfg.vercelProjectId)) {
    // The project ID, not its name: "attached to THIS project" is decided by
    // comparing Vercel's projectId with this exact value.
    missing.push('DOMAINS_VERCEL_PROJECT_ID (must be the prj_ id)');
  }
  return missing;
}
