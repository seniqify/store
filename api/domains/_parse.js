// Hostname parsing for custom domains: public-suffix aware, never "count the dots".
//
// Uses tldts (the Public Suffix List, ICANN section only). brand.co.in is an
// apex with three labels; shop.brand.com is a subdomain with three labels --
// only the suffix list can tell them apart. IDN input is converted to its
// punycode (xn--) form first, which is how the database stores every name and
// how browsers send the Host header.
//
// PR-B mapping:
//   brand.com / brand.co.in           -> kind 'apex'      (apex primary, www redirect)
//   www.brand.com / www.brand.co.in   -> kind 'www'       (www primary, apex redirect)
//   anything deeper (shop.brand.com)  -> kind 'subdomain' (one row)
//
// PocketLink TXT ownership record (its value is the group's txt_token, exactly):
//   apex / www group  -> _pocketlink.<registrable domain>   e.g. _pocketlink.brand.com
//   subdomain group   -> _pocketlink.<full subdomain>       e.g. _pocketlink.shop.brand.com
import { parse } from 'tldts';
import { domainToASCII } from 'node:url';

// Same shape rule as public.store_domain_hostname_problem(): LDH labels of
// 1-63 characters, at least two labels, a final label starting with a letter.
const HOST_SHAPE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$/;

/**
 * What a merchant typed -> a bare lowercase ASCII hostname, or null.
 * Accepts a pasted "https://Brand.com/" (scheme and one trailing slash are
 * dropped); anything with a path, port, query, credentials or spaces is refused
 * rather than guessed at.
 */
export function normalizeHostInput(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\.$/, '');
  if (!s || /[\s/:?#@\\]/.test(s)) return null;
  const ascii = domainToASCII(s);
  if (!ascii || ascii.length > 253 || !HOST_SHAPE.test(ascii)) return null;
  return ascii;
}

/**
 * Classify a hostname for a claim.
 *   { ok: true, host, kind, registrable, primary, hostnames, txtName }
 *   { ok: false, reason: 'invalid_hostname' | 'unknown_suffix' }
 */
export function classifyHostname(raw) {
  const host = normalizeHostInput(raw);
  if (!host) return { ok: false, reason: 'invalid_hostname' };

  const p = parse(host, { allowPrivateDomains: false });
  if (p.isIp) return { ok: false, reason: 'invalid_hostname' };
  // Only suffixes the ICANN section of the list knows. An unknown TLD is not
  // guessed at: it could be anything, including an internal name.
  if (p.isIcann !== true || !p.domain || !p.publicSuffix) return { ok: false, reason: 'unknown_suffix' };

  const registrable = p.domain;
  const sub = p.subdomain || '';
  if (sub === '') {
    return { ok: true, host, kind: 'apex', registrable, primary: host,
             hostnames: [host, `www.${host}`], txtName: `_pocketlink.${registrable}` };
  }
  if (sub === 'www') {
    return { ok: true, host, kind: 'www', registrable, primary: host,
             hostnames: [registrable, host], txtName: `_pocketlink.${registrable}` };
  }
  return { ok: true, host, kind: 'subdomain', registrable, primary: host,
           hostnames: [host], txtName: `_pocketlink.${host}` };
}

// DNS names for records the merchant is asked to create may have a leading
// underscore label (_vercel, _pocketlink); values are printable ASCII without
// spaces, quotes or backslashes -- nothing that could break out of a DNS UI or
// be mistaken for more than one value.
const TXT_NAME = /^(_?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$/;
const TXT_VALUE = /^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/;

/**
 * Vercel's own verification challenges for `host`, reduced to what is safe to
 * show a merchant: TXT only, a record name INSIDE the merchant's own registrable
 * domain (never instructions to touch someone else's zone), a bounded printable
 * value, at most three. Vercel's free-text `reason` is never passed on.
 */
export function safeVerificationChallenges(list, host) {
  if (!Array.isArray(list)) return [];
  const registrable = parse(String(host ?? ''), { allowPrivateDomains: false }).domain;
  if (!registrable) return [];
  const out = [];
  for (const c of list.slice(0, 5)) {
    if (!c || c.type !== 'TXT' || typeof c.domain !== 'string' || typeof c.value !== 'string') continue;
    const name = c.domain.trim().toLowerCase().replace(/\.$/, '');
    if (name.length > 253 || !TXT_NAME.test(name)) continue;
    if (name !== registrable && !name.endsWith(`.${registrable}`)) continue;
    if (!TXT_VALUE.test(c.value)) continue;
    if (out.some((o) => o.name === name && o.value === c.value)) continue;
    out.push({ type: 'TXT', name, value: c.value });
    if (out.length === 3) break;
  }
  return out;
}

/** The TXT record name for an existing group, from its database rows. */
export function txtNameForRows(rows) {
  const apex = rows.find((r) => r.kind === 'apex');
  if (apex) return `_pocketlink.${apex.hostname}`;
  const sub = rows.find((r) => r.kind === 'subdomain');
  return sub ? `_pocketlink.${sub.hostname}` : null;
}
