/**
 * Customer contact export → CSV.
 * ────────────────────────────────────────────────────────────────────────────
 * Turns the store's OWN orders (which the owner already fetches, PIN-checked)
 * into a downloadable contact list for re-marketing: everyone who ordered, PLUS
 * everyone who reached checkout but didn't finish (abandoned carts) — deduped by
 * phone. No new data is collected; this just packages what the store already owns
 * so the owner can import it into WhatsApp / their contacts and win repeat sales.
 *
 * Phones are emitted as `91XXXXXXXXXX` (country code, no +, no spaces) — the
 * format WhatsApp broadcast tools and contact imports expect.
 */

import { buildCustomers } from './customers';

// Quote a CSV cell only when it contains a comma, quote or newline.
function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtDate(tsOrIso) {
  if (!tsOrIso) return '';
  const d = new Date(tsOrIso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Group abandoned-checkout rows by phone (kept separate from real customers).
function groupAbandoned(orders) {
  const m = new Map();
  for (const o of orders) {
    const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) continue;
    const t = new Date(o.created_at).getTime() || 0;
    let g = m.get(phone);
    if (!g) { g = { phone, name: '', _nameAt: -1, count: 0, lastAt: 0, last: null }; m.set(phone, g); }
    g.count += 1;
    const nm = String(o.customer_name || '').trim();
    if (nm && t >= g._nameAt) { g.name = nm; g._nameAt = t; }
    if (t >= g.lastAt) { g.lastAt = t; g.last = o; }
  }
  return m;
}

/**
 * Build one contact row per unique phone number.
 *   • Buyers first (from buildCustomers), with an `abandoned` count if the same
 *     number also has an abandoned cart.
 *   • Abandoned-only leads (never completed an order) after, flagged as such.
 * @param {Array} allOrders  orders INCLUDING abandoned (fetchOrders includeAbandoned:true)
 */
export function buildContactRows(allOrders = []) {
  const ordered   = allOrders.filter((o) => o.status !== 'abandoned');
  const abandoned = allOrders.filter((o) => o.status === 'abandoned');
  const customers = buildCustomers(ordered);
  const abMap     = groupAbandoned(abandoned);

  const rows = [];

  for (const c of customers) {
    const latest = c.history[0] || {};
    const ab = abMap.get(c.phone);
    rows.push({
      name:      c.name || '',
      phone:     '91' + c.phone,
      type:      c.orderCount >= 2 ? 'Repeat customer' : 'Customer',
      orders:    c.orderCount,
      abandoned: ab ? ab.count : 0,
      spent:     c.totalSpent,
      last:      fmtDate(c.lastOrderAt),
      area:      latest.destination || '',
      pincode:   latest.pincode || '',
      buys:      c.topItems.map((i) => i.name).join(' · '),
    });
    if (ab) abMap.delete(c.phone);   // folded into the buyer's row
  }

  for (const g of abMap.values()) {
    const last = g.last || {};
    rows.push({
      name:      g.name || '',
      phone:     '91' + g.phone,
      type:      'Abandoned cart',
      orders:    0,
      abandoned: g.count,
      spent:     0,
      last:      fmtDate(g.lastAt),
      area:      last.destination || '',
      pincode:   last.pincode || '',
      buys:      (last.items || []).map((i) => i.name).join(' · '),
    });
  }

  return rows;
}

/** Render contact rows as CSV text (UTF-8 BOM so Excel reads Marathi/Hindi names). */
export function contactsToCsv(rows = []) {
  const headers = [
    'Name', 'Phone', 'Type', 'Orders', 'Abandoned carts',
    'Total spent (INR)', 'Last activity', 'Area / City', 'Pincode', 'Usually buys',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      cell(r.name), cell(r.phone), cell(r.type), cell(r.orders), cell(r.abandoned),
      cell(r.spent), cell(r.last), cell(r.area), cell(r.pincode), cell(r.buys),
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/** Trigger a browser download of `csv` as `filename`. */
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A safe, dated filename like "royal-foods-contacts-2026-08-24.csv". */
export function contactsFilename(businessName, slug) {
  const base = String(businessName || slug || 'store')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'store';
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-contacts-${date}.csv`;
}
