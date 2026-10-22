/**
 * Customer contact export → CSV.
 * ────────────────────────────────────────────────────────────────────────────
 * Turns the store's OWN orders (which the owner already fetches, PIN-checked)
 * into a downloadable contact list for re-marketing: everyone who ordered,
 * deduped by phone. Abandoned-cart customers are not included - only PocketLink
 * holds their numbers. No new data is collected; this just packages what the
 * store already owns so the owner can import it into WhatsApp / their contacts
 * and win repeat sales.
 *
 * Phones are emitted as `91XXXXXXXXXX` (country code, no +, no spaces) — the
 * format WhatsApp broadcast tools and contact imports expect.
 */

import { buildCustomers } from './customers.js';

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

/**
 * Build one contact row per customer who ordered (from buildCustomers).
 *
 * Abandoned-cart customers are NOT exported (founder, 2026-10-22): their
 * numbers are PocketLink's, and the shop reaches them through the paid reminder
 * in the Abandoned tab. Any abandoned row handed in is ignored.
 *
 * @param {Array} allOrders  the store's orders
 */
export function buildContactRows(allOrders = []) {
  const ordered = (Array.isArray(allOrders) ? allOrders : [])
    .filter((o) => String(o?.status ?? '').toLowerCase() !== 'abandoned');
  return buildCustomers(ordered).map((c) => {
    const latest = c.history[0] || {};
    return {
      name:    c.name || '',
      phone:   '91' + c.phone,
      type:    c.orderCount >= 2 ? 'Repeat customer' : 'Customer',
      orders:  c.orderCount,
      spent:   c.totalSpent,
      last:    fmtDate(c.lastOrderAt),
      area:    latest.destination || '',
      pincode: latest.pincode || '',
      buys:    c.topItems.map((i) => i.name).join(' · '),
    };
  });
}

/** Render contact rows as CSV text (UTF-8 BOM so Excel reads Marathi/Hindi names). */
export function contactsToCsv(rows = []) {
  const headers = [
    'Name', 'Phone', 'Type', 'Orders',
    'Total spent (INR)', 'Last order', 'Area / City', 'Pincode', 'Usually buys',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      cell(r.name), cell(r.phone), cell(r.type), cell(r.orders),
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
