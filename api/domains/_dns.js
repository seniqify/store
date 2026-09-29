// PocketLink TXT ownership check.
//
// A live DNS query every time: verification and activation never rely on a
// result remembered by the app. The resolver is injectable so tests never touch
// real DNS.
//
// Outcomes (lookupTxt):
//   found     values: every TXT record, its character-strings joined in order
//             (a long record arrives as several <=255-byte chunks)
//   nxdomain  the name does not exist
//   no_txt    the name exists but has no TXT record
//   timeout   no answer in time
//   error     anything else (code bounded)
// Only an EXACT, whole-record match of the token proves ownership. A timeout or
// an error is never a pass.
import { Resolver } from 'node:dns/promises';

export const DNS_TIMEOUT_MS = 8000;
const TOKEN = /^[0-9a-f]{32}$/;

/** Default resolver: public recursive resolvers, short per-try timeout. */
export function systemResolveTxt({ servers = ['1.1.1.1', '8.8.8.8'], timeoutMs = 3000, tries = 2 } = {}) {
  return async (name) => {
    const r = new Resolver({ timeout: timeoutMs, tries });
    r.setServers(servers);
    try {
      return await r.resolveTxt(name);
    } finally {
      r.cancel();
    }
  };
}

export async function lookupTxt(name, { resolveTxt = systemResolveTxt(), timeoutMs = DNS_TIMEOUT_MS } = {}) {
  let timer;
  try {
    const records = await Promise.race([
      resolveTxt(name),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })), timeoutMs);
      }),
    ]);
    const values = (Array.isArray(records) ? records : [])
      .map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks ?? '')));
    return { status: 'found', values };
  } catch (e) {
    const code = typeof e?.code === 'string' ? e.code : '';
    if (code === 'ENOTFOUND') return { status: 'nxdomain' };
    if (code === 'ENODATA') return { status: 'no_txt' };
    if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') return { status: 'timeout' };
    return { status: 'error', code: code.slice(0, 32) || 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is `token` published at `name` right now?
 *   { proved: true, token }                     exact match found
 *   { proved: false, status }                   anything else (never a pass)
 */
export async function proveTxtToken(name, token, opts = {}) {
  if (!name || !TOKEN.test(String(token ?? ''))) return { proved: false, status: 'bad_request' };
  const r = await lookupTxt(name, opts);
  if (r.status !== 'found') return { proved: false, status: r.status };
  if (r.values.some((v) => v === token)) return { proved: true, token };
  return { proved: false, status: r.values.length ? 'token_mismatch' : 'no_txt' };
}
