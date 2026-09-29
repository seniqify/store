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

/** The TXT record name for an existing group, from its database rows. */
export function txtNameForRows(rows) {
  const apex = rows.find((r) => r.kind === 'apex');
  if (apex) return `_pocketlink.${apex.hostname}`;
  const sub = rows.find((r) => r.kind === 'subdomain');
  return sub ? `_pocketlink.${sub.hostname}` : null;
}
