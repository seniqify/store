// Opens a clean, print-ready delivery / packing slip for one order in a new
// window (print / save-as-PDF). Self-contained inline HTML — same pattern as
// storePoster.js. Sized to a 4×6 inch (100×150mm) shipping label — the courier
// / Amazon standard — so it prints on a thermal label printer or plain paper
// without a big empty A4 sheet. The toolbar is hidden on print.
//
// `order` is a row from the `orders` table (customer_name, customer_phone,
// destination [now the full delivery address], payment_method, items[], totals,
// notes, created_at, id). `store` carries the "from" details.

import { formatINR } from './currency';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Short, human order number from a uuid or bigint id.
function orderNo(id) {
  const s = String(id ?? '').replace(/-/g, '');
  return (s.slice(-6) || s).toUpperCase();
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function openDeliverySlip(order = {}, store = {}) {
  if (!order) return;
  const brand   = store.theme?.primary || '#0d9488';
  const name    = store.businessName || 'Store';
  const emoji   = store.logoEmoji || '🏪';
  const logo    = store.logo || '';
  const phone   = String(store.whatsappNumber || '').replace(/\D/g, '');
  const fromAddr = store.address || '';
  const gst     = store.gst || '';

  const cust    = order.customer_name || 'Customer';
  const custPh  = String(order.customer_phone || '').replace(/\D/g, '');
  // `destination` holds the full delivery address (may be comma-separated);
  // split it into stacked lines for a readable "deliver to" block.
  const addrLines = String(order.destination || '')
    .split(/\s*,\s*|\n/).map((l) => l.trim()).filter(Boolean);
  const notes   = order.notes || '';
  const pay     = String(order.payment_method || '').toLowerCase();
  const isCOD   = pay === 'cod';
  const total   = Number(order.total) || 0;

  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.map((it, i) => {
    const variant = it.variant ? ` (${it.variant})` : it.size ? ` (${it.size})` : '';
    const qty  = Number(it.qty) || 0;
    const rate = Number(it.price) || 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name || '')}${esc(variant)}${it.unit ? `<span class="unit"> / ${esc(it.unit)}</span>` : ''}</td>
      <td class="c">${qty}</td>
      <td class="r">${esc(formatINR(rate))}</td>
      <td class="r">${esc(formatINR(rate * qty))}</td>
    </tr>`;
  }).join('');

  const subtotal = Number(order.subtotal);
  const tax      = Number(order.tax);
  const shipping = Number(order.shipping);
  const totalsRows = [
    Number.isFinite(subtotal) && subtotal > 0 ? `<div class="tr"><span>Subtotal</span><span>${esc(formatINR(subtotal))}</span></div>` : '',
    Number.isFinite(tax) && tax > 0           ? `<div class="tr"><span>GST</span><span>${esc(formatINR(tax))}</span></div>` : '',
    Number.isFinite(shipping) && shipping > 0 ? `<div class="tr"><span>Delivery</span><span>${esc(formatINR(shipping))}</span></div>` : '',
  ].filter(Boolean).join('');

  const payBadge = isCOD
    ? `<div class="pay cod">💰 COLLECT ${esc(formatINR(total))} — CASH ON DELIVERY</div>`
    : `<div class="pay paid">✅ PAID — ${esc((pay || 'prepaid').toUpperCase())}</div>`;

  const avatar = logo
    ? `<img src="${esc(logo)}" class="logo" alt="" />`
    : `<div class="logo emoji">${emoji}</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Delivery Slip · ${esc(name)} · #${orderNo(order.id)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
    body{background:#eef2f6;display:flex;flex-direction:column;align-items:center;padding:18px;color:#0f172a}
    .bar{display:flex;gap:10px;margin-bottom:14px}
    .btn{border:0;cursor:pointer;font-weight:700;font-size:14px;padding:10px 18px;border-radius:12px}
    .print{background:${brand};color:#fff}
    .close{background:#fff;color:#475569;border:1px solid #e2e8f0}
    /* On screen the card mirrors a 4×6 label (100×150mm ≈ 3:4.5); content can
       grow taller for long orders, exactly as a label would spill over. */
    .slip{width:384px;max-width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.12)}
    .head{display:flex;justify-content:space-between;gap:10px;padding:8px 11px;border-bottom:2px solid #0f172a}
    .from{display:flex;gap:7px;min-width:0}
    .logo{width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0}
    .logo.emoji{display:flex;align-items:center;justify-content:center;font-size:18px;background:${brand}1a}
    .fname{font-size:12.5px;font-weight:800;line-height:1.15}
    .fmeta{font-size:8px;color:#64748b;margin-top:2px;line-height:1.35}
    .doc{text-align:right;flex-shrink:0}
    .doctitle{font-size:8.5px;font-weight:800;letter-spacing:.07em;color:${brand}}
    .ono{font-size:14px;font-weight:800;margin-top:1px}
    .odate{font-size:8px;color:#64748b;margin-top:1px}
    .to{padding:7px 11px;background:#f8fafc;border-bottom:1px dashed #cbd5e1}
    .label{font-size:7.5px;font-weight:800;letter-spacing:.1em;color:#94a3b8;text-transform:uppercase;margin-bottom:2px}
    .cname{font-size:13.5px;font-weight:800;line-height:1.2}
    .cph{font-size:11px;color:#334155;margin-top:1px;font-weight:600}
    .addr{font-size:11px;color:#334155;margin-top:3px;line-height:1.35}
    .note{font-size:9.5px;color:#475569;margin-top:4px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:3px 6px}
    .note b{color:#0f172a}
    .pay{margin:7px 11px 0;text-align:center;font-size:11.5px;font-weight:800;border-radius:7px;padding:7px}
    .pay.cod{background:#fef3c7;color:#92400e;border:1.5px solid #fcd34d}
    .pay.paid{background:#dcfce7;color:#166534;border:1.5px solid #86efac}
    table{width:100%;border-collapse:collapse;margin-top:7px}
    thead th{font-size:7.5px;letter-spacing:.05em;text-transform:uppercase;color:#94a3b8;text-align:left;padding:3px 11px;border-bottom:1px solid #e2e8f0}
    thead th.c{text-align:center}thead th.r{text-align:right}
    tbody td{font-size:10.5px;padding:3.5px 11px;border-bottom:1px solid #f1f5f9;vertical-align:top}
    tbody td.c{text-align:center;color:#64748b}tbody td.r{text-align:right;font-variant-numeric:tabular-nums}
    .unit{color:#94a3b8;font-size:9px}
    .totals{margin:6px 11px 0;padding-top:5px}
    .tr{display:flex;justify-content:space-between;font-size:10px;color:#64748b;padding:1px 0}
    .grand{display:flex;justify-content:space-between;font-size:13.5px;font-weight:800;color:#0f172a;border-top:2px solid #0f172a;margin-top:5px;padding-top:5px}
    .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 11px 8px;margin-top:7px;border-top:1px dashed #cbd5e1}
    .thanks{font-size:9px;color:#475569;line-height:1.35}
    .thanks b{color:${brand}}
    .pb{font-size:8px;color:#cbd5e1;white-space:nowrap}
    @media print{
      html,body{background:#fff;padding:0;margin:0}
      .bar{display:none}
      .slip{box-shadow:none;border-radius:0;width:100%}
      /* 4×6 inch shipping label; tiny margin so it also prints on plain paper. */
      @page{size:100mm 150mm;margin:3mm}
      /* Direct-thermal 4×6 printers (e.g. Helett/SEZNIK) print BLACK ONLY — light
         colour fills wash out. Force crisp black-on-white so the COD amount, the
         address and totals stay bold and legible on a thermal label. */
      .doctitle,.fname,.cname,.ono,.cph,.grand,.thanks b{color:#000 !important}
      .to{background:#fff !important}
      .logo.emoji{background:#fff !important;border:1px solid #000}
      .pay.cod,.pay.paid{background:#fff !important;color:#000 !important;border:2px solid #000 !important}
      .head,.grand{border-color:#000 !important}
    }
  </style></head>
  <body>
    <div class="bar">
      <button class="btn print" onclick="window.print()">🖨️ Print / Save PDF</button>
      <button class="btn close" onclick="window.close()">Close</button>
    </div>
    <div class="slip">
      <div class="head">
        <div class="from">
          ${avatar}
          <div style="min-width:0">
            <div class="fname">${esc(name)}</div>
            <div class="fmeta">${[fromAddr && esc(fromAddr), phone && ('📞 +91 ' + esc(phone)), gst && esc(gst)].filter(Boolean).join('<br>')}</div>
          </div>
        </div>
        <div class="doc">
          <div class="doctitle">DELIVERY SLIP</div>
          <div class="ono">#${orderNo(order.id)}</div>
          <div class="odate">${esc(fmtDate(order.created_at))}</div>
        </div>
      </div>

      <div class="to">
        <div class="label">Deliver to</div>
        <div class="cname">${esc(cust)}</div>
        ${custPh ? `<div class="cph">📞 +91 ${esc(custPh)}</div>` : ''}
        ${addrLines.length ? `<div class="addr">📍 ${addrLines.map(esc).join('<br>')}</div>` : ''}
        ${notes ? `<div class="note"><b>Note:</b> ${esc(notes)}</div>` : ''}
      </div>

      ${payBadge}

      <table>
        <thead><tr><th class="c">#</th><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:16px">No items</td></tr>'}</tbody>
      </table>

      <div class="totals">
        ${totalsRows}
        <div class="grand"><span>Total${isCOD ? ' to collect' : ''}</span><span>${esc(formatINR(total))}</span></div>
      </div>

      <div class="foot">
        <div class="thanks">Thank you for ordering from <b>${esc(name)}</b>!</div>
        <div class="pb">Powered by PocketLink</div>
      </div>
    </div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
