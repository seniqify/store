/**
 * PIN hashing — SHA-256 via Web Crypto API (available in all modern browsers)
 * Salt prevents rainbow table attacks on 4-digit PINs.
 */
const SALT = 'snq1_';

export async function hashPin(pin) {
  const encoder    = new TextEncoder();
  const data       = encoder.encode(SALT + String(pin));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
