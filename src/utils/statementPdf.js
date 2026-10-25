// Opens the Hisaab sales statement as a clean A4 page in a new window, to
// save as PDF (or print). Self-contained inline HTML, the same pattern as
// deliverySlip.js and storePoster.js: the browser draws every script a
// customer typed their name in, ₹ included, and the print box saves the PDF.
//
// The page title is the PDF's file name in Chrome's Save as PDF. Every value
// from an order is escaped: customers type their names and addresses, and this
// page opens on the shop's own origin.
//
// `st` is buildStatement's result (salesStatement.js); `store` carries the
// header: businessName, logo, logoEmoji, whatsappNumber, address, city, gst,
// theme.primary.

import {
  STATE_LABEL, PAY_FILTERS, rangeLabel, dateLabel, maskPhone, statementFileName,
} from './salesStatement.js';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const num = (n) => `${n < 0 ? '−' : ''}${inr.format(Math.abs(Math.round(Number(n) || 0)))}`;
const rs = (n) => `${n < 0 ? '−' : ''}₹${inr.format(Math.abs(Math.round(Number(n) || 0)))}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dm = (key) => dateLabel(key).replace(/ \d{4}$/, '');
const CHIP = { paid: 'ok', collected: 'ok', came_back: 'bad', on_way: 'wait', not_sent: 'new', not_paid: 'wait' };

/** The whole statement page, as one HTML document. */
export function statementHtml(st, {
  store = {}, slug = '', showCosts = true, showPhones = false, withExpenses = false, madeAt = '',
} = {}) {
  const t = st.totals;
  const name = store.businessName || 'Shop';
  const brand = /^#[0-9a-f]{3,8}$/i.test(store.theme?.primary || '') ? store.theme.primary : '#0d9488';
  const logo = /^https:\/\//i.test(store.logo || '') ? store.logo : '';
  const phone = String(store.whatsappNumber || '').replace(/\D/g, '');
  const range = rangeLabel(st.from, st.to);
  const title = statementFileName(name, st.from, st.to);
  const payWord = (PAY_FILTERS.find((p) => p.key === st.pay) || PAY_FILTERS[0]).label;
  const who = (p) => (showPhones ? p : maskPhone(p));
  const link = slug ? `pocketlink.store/${slug}` : '';

  const items = (r) => r.items.map((it) => `${esc(it.name)}${it.variant ? ` <span class="m-in">(${esc(it.variant)})</span>` : ''} × ${it.qty}`).join('<br>');
  const customer = (r) => `<b>${esc(r.name)}</b>${r.place || r.pincode ? `<span class="m">${esc([r.place, r.pincode].filter(Boolean).join(' '))}</span>` : ''}${r.phone ? `<span class="m">${esc(who(r.phone))}</span>` : ''}`;
  const when = (r) => `<b>${esc(dm(r.day))}</b><span class="m">${esc(r.time)}</span><span class="m">#${esc(r.no)}</span>`;
  const payment = (r) => `${esc(r.methodLabel)}<br><span class="chip ${CHIP[r.state]}">${esc(STATE_LABEL[r.state])}</span>`;

  const rows = st.rows.map((r) => {
    const coupon = r.coupon ? `<span class="cp">${esc(r.coupon.code)} −₹${inr.format(r.coupon.off)}</span>` : '';
    const delivery = r.deliveryCharged ? num(r.deliveryCharged) : 'Free';
    const cells = [`<td>${when(r)}</td>`, `<td>${customer(r)}</td>`, `<td>${items(r)}${coupon}</td>`, `<td>${payment(r)}</td>`];
    if (showCosts) {
      cells.push(`<td class="n">${num(r.total)}</td>`, `<td class="n">${delivery}</td>`,
        `<td class="n${r.courierGuess ? ' guess' : ''}">${r.courierGuess ? '~' : ''}${num(r.courier)}</td>`,
        `<td class="n">${r.state === 'came_back' ? '—' : r.costMissing ? `${num(r.productCost)}<span class="m">no cost price</span>` : num(r.productCost)}</td>`,
        `<td class="n${r.profit < 0 ? ' loss' : ''}"><b>${num(r.profit)}</b></td>`);
    } else {
      cells.push(`<td class="n">${delivery}</td>`, `<td class="n"><b>${num(r.total)}</b></td>`);
    }
    return `<tr${r.state === 'came_back' ? ' class="back"' : ''}>${cells.join('')}</tr>`;
  }).join('');

  const cols = showCosts
    ? [['Date', 58], ['Customer', 108], ['What they ordered', 0], ['Payment', 88], ['Order<br>value', 56, 1], ['Delivery<br>charged', 56, 1], ['Courier<br>paid', 54, 1], ['Product<br>cost', 54, 1], ['Profit', 54, 1]]
    : [['Date', 62], ['Customer', 130], ['What they ordered', 0], ['Payment', 110], ['Delivery<br>charged', 64, 1], ['Order<br>value', 70, 1]];
  const totalRow = showCosts
    ? `<tr class="total"><td colspan="4">${plural(t.count, 'order', 'orders')}</td><td class="n">${num(t.sold)}</td><td class="n">${num(t.deliveryCharged)}</td><td class="n">${num(t.courier)}</td><td class="n">${num(t.productCost)}</td><td class="n${t.profit < 0 ? ' loss' : ''}">${num(t.profit)}</td></tr>`
    : `<tr class="total"><td colspan="4">${plural(t.count, 'order', 'orders')}</td><td class="n">${num(t.deliveryCharged)}</td><td class="n">${num(t.sold)}</td></tr>`;
  const ordersTable = st.rows.length ? `
    <div class="sec"><h4>Orders</h4><span>oldest first · amounts in ₹</span></div>
    <table class="ot"><colgroup>${cols.map((c) => `<col${c[1] ? ` style="width:${c[1]}px"` : ''}>`).join('')}</colgroup>
      <thead><tr>${cols.map((c) => `<th${c[2] ? ' class="n"' : ''}>${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${rows}${totalRow}</tbody></table>` : '<p class="empty">No orders between these dates.</p>';

  const where = showCosts ? `<div class="blk"><h4>Where the money went</h4><table class="ledger">
      <tr><td>Sales</td><td>${rs(t.sold)}</td></tr>
      ${t.returns ? `<tr><td>Parcels that came back (${t.returnedCount})</td><td>−${rs(t.returns)}</td></tr>` : ''}
      <tr><td>Product cost</td><td>−${rs(t.productCost)}</td></tr>
      <tr><td>Courier and delivery you paid</td><td>−${rs(t.courier)}</td></tr>
      ${t.packing ? `<tr><td>Packing</td><td>−${rs(t.packing)}</td></tr>` : ''}
      <tr class="sum"><td>Profit on these orders</td><td>${rs(t.profit)}</td></tr>
      ${withExpenses ? `${st.expenses.map((x) => `<tr class="sub"><td>${esc(dm(x.day))} · ${esc(x.label)}</td><td>−${rs(x.amount)}</td></tr>`).join('') || '<tr class="sub"><td>No shop expenses in these dates</td><td>—</td></tr>'}
        <tr class="sum"><td>You kept after shop expenses</td><td>${rs(t.kept)}</td></tr>` : ''}
    </table>${t.coupons ? `<p class="note">Already taken off sales: ${rs(t.coupons)} in coupons on ${plural(t.couponCount, 'order', 'orders')}.</p>` : ''}</div>` : '';
  const how = `<div class="blk"><h4>How customers paid</h4><table class="ledger">
      ${st.methods.map((m) => `<tr><td>${esc(m.label)} · ${m.count}</td><td>${rs(m.amount)}</td></tr>
        ${m.unpaid ? `<tr class="sub"><td>not paid yet</td><td>${rs(m.unpaid)}</td></tr>` : ''}
        ${m.cameBack ? `<tr class="sub"><td>came back</td><td>${rs(m.cameBack)}</td></tr>` : ''}`).join('') || '<tr><td>No orders</td><td>—</td></tr>'}
    </table>
    <h4 class="gap">Delivery</h4><table class="ledger">
      <tr><td>Customers paid you for delivery</td><td>${rs(t.deliveryCharged)}</td></tr>
      ${showCosts ? `<tr><td>You paid the courier and rider</td><td>${rs(t.courier)}</td></tr>
      <tr class="sum"><td>${t.deliveryCharged >= t.courier ? 'Delivery earned you' : 'Delivery cost you'}</td><td>${rs(Math.abs(t.deliveryCharged - t.courier))}</td></tr>` : ''}
    </table>
    <p class="note">${plural(t.customers, 'customer', 'customers')}${t.customers ? `, ${t.returning} of them bought before` : ''}.</p></div>`;

  const products = st.products.length ? `
    <div class="sec"><h4>Products sold</h4><span>parcels that came back are left out · amounts in ₹</span></div>
    <table class="ot"><colgroup><col><col style="width:70px"><col style="width:90px">${showCosts ? '<col style="width:90px"><col style="width:100px">' : ''}</colgroup>
      <thead><tr><th>Product</th><th class="n">Sold</th><th class="n">Sales</th>${showCosts ? '<th class="n">Your cost</th><th class="n">Margin</th>' : ''}</tr></thead>
      <tbody>${st.products.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="n">${p.qty}</td><td class="n">${num(p.sales)}</td>${showCosts
        ? (p.cost == null ? '<td class="n m-in">no cost price</td><td class="n">—</td>'
          : `<td class="n">${num(p.cost)}</td><td class="n">${num(p.sales - p.cost)} <span class="m-in">${num(p.sales > 0 ? ((p.sales - p.cost) / p.sales) * 100 : 0)}%</span></td>`)
        : ''}</tr>`).join('')}</tbody></table>` : '';

  const odd = [...st.rows.filter((r) => r.state === 'came_back').map((r) => ({ ...r, kind: 'back' })), ...st.cancelled.map((r) => ({ ...r, kind: 'cancelled' }))]
    .sort((a, b) => a.at - b.at);
  const oddTable = odd.length ? `
    <div class="sec"><h4>Came back and cancelled</h4><span>${t.returnedCount} came back · ${st.cancelled.length} cancelled</span></div>
    <table class="ot"><colgroup><col style="width:80px"><col style="width:150px"><col><col style="width:130px"><col style="width:80px"></colgroup>
      <thead><tr><th>Date</th><th>Customer</th><th>What happened</th><th>Payment</th><th class="n">Order value</th></tr></thead>
      <tbody>${odd.map((r) => `<tr><td><b>${esc(dm(r.day))}</b><span class="m">#${esc(r.no)}</span></td><td><b>${esc(r.name)}</b>${r.place ? `<span class="m">${esc(r.place)}</span>` : ''}</td>
        <td>${r.kind === 'back' ? `The parcel came back to you${showCosts && r.courier ? `; courier ₹${inr.format(r.courier)}` : ''}` : 'Cancelled; not counted in sales'}</td>
        <td>${esc(r.methodLabel)}</td><td class="n">${num(r.total)}</td></tr>`).join('')}</tbody></table>` : '';

  const notes = [
    showCosts && 'Product cost uses the cost prices saved in Products. Courier paid is what the courier charged for that parcel, else your delivery cost per order from Settings.',
    showCosts && t.courierGuessCount && '~ No courier charge was saved for this order, so your delivery cost per order from Settings is used.',
    showCosts && t.costMissingCount && `${plural(t.costMissingCount, 'order has', 'orders have')} a product with no cost price, so the profit shown is higher than it really is.`,
    'Money received counts the orders paid so far. Cash on delivery counts when the parcel was delivered.',
  ].filter(Boolean).map((n) => `<span>${esc(n)}</span>`).join('');

  const showing = `Showing <b>${esc(payWord === 'All' ? 'every payment mode' : payWord)}</b>.`
    + ` Cancelled orders are not counted${st.cancelled.length ? ` (${st.cancelled.length} listed at the end)` : ''}.`
    + (st.includesToday ? ` Today's orders are counted up to ${esc(madeAt.replace(/^.*, /, ''))}.` : '');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=840">
  <title>${esc(title)}</title>
  <style>
    @page{size:A4;margin:12mm 10mm 14mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt system-ui,sans-serif;color:#66726d}}
    *{box-sizing:border-box}
    html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#e8ecea;color:#1b2420;font:10.5px/1.4 Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans','Noto Sans Devanagari',sans-serif}
    td,th,.v{font-variant-numeric:tabular-nums}
    .bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:#fff;border-bottom:1px solid #dfe5e2}
    .btn{border:0;border-radius:12px;padding:12px 18px;font:700 14px system-ui,sans-serif;cursor:pointer}
    .save{background:${brand};color:#fff}
    .close{background:#f3f4f6;color:#111827}
    .hint{font:13px system-ui,sans-serif;color:#4b5563}
    .page{width:794px;margin:18px auto;background:#fff;padding:34px 32px 26px;box-shadow:0 1px 3px rgba(0,0,0,.12),0 16px 32px -20px rgba(0,0,0,.35)}
    .ph{display:flex;justify-content:space-between;gap:24px;padding-bottom:16px;border-bottom:2px solid ${brand}}
    .shop{display:flex;gap:12px;align-items:center;min-width:0}
    .logo{width:46px;height:46px;border-radius:12px;background:${brand};color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex:0 0 auto;overflow:hidden}
    .logo img{width:100%;height:100%;object-fit:cover}
    h1{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em}
    .sub{color:#66726d;font-size:10.5px;margin-top:2px}
    .right{text-align:right;flex:0 0 auto}
    .k{font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#064e3b}
    .rng{font-size:18px;font-weight:800;margin-top:3px}
    .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
    .tile{background:#f2f6f4;border-radius:10px;padding:10px 12px}
    .tile .k{color:#66726d;letter-spacing:.08em;font-weight:700}
    .tile .v{font-size:18px;font-weight:800;margin-top:4px}
    .tile .s{font-size:9.5px;color:#66726d;margin-top:2px}
    .cols{display:grid;grid-template-columns:1.1fr 1fr;gap:26px;margin-top:18px}
    .cols.one{grid-template-columns:1fr}
    h4{margin:0 0 6px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#064e3b}
    h4.gap{margin-top:14px}
    .ledger{width:100%;border-collapse:collapse}
    .ledger td{padding:4px 0;border-bottom:1px solid #e2e7e4}
    .ledger td:last-child{text-align:right;font-weight:600;white-space:nowrap;padding-left:10px}
    .ledger tr.sum td{border-bottom:0;border-top:1.5px solid #1b2420;font-weight:800;font-size:11.5px;padding-top:6px}
    .ledger tr.sub td{color:#66726d;font-size:10px}
    .ledger tr.sub td:first-child{padding-left:10px}
    .note{margin:6px 0 0;color:#66726d;font-size:9.5px}
    .showing{margin-top:16px;padding:7px 10px;border-radius:8px;background:#f2f6f4;color:#66726d;font-size:9.5px}
    .showing b{color:#1b2420}
    .sec{margin:18px 0 7px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
    .sec h4{margin:0}
    .sec span{color:#66726d;font-size:9.5px}
    .ot{width:100%;border-collapse:collapse;table-layout:fixed}
    .ot thead{display:table-header-group}
    .ot th{text-align:left;font-size:8px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#66726d;padding:6px 5px;background:#f2f6f4;border-bottom:1px solid #e2e7e4;vertical-align:bottom;line-height:1.25}
    .ot td{padding:6px 5px;border-bottom:1px solid #e2e7e4;vertical-align:top;overflow-wrap:anywhere}
    .ot tr{break-inside:avoid}
    .ot .n{text-align:right;white-space:nowrap}
    .ot td b{font-weight:700}
    .m{display:block;color:#66726d;font-size:9px;margin-top:1px}
    .m-in{color:#66726d;font-size:9px}
    .cp{display:block;color:#047857;font-size:9px;margin-top:1px;font-weight:600}
    .chip{display:inline-block;margin-top:2px;font-size:8.5px;font-weight:800;padding:1px 6px;border-radius:999px}
    .chip.ok{background:#ecfdf5;color:#047857}
    .chip.wait{background:#fffbeb;color:#b45309}
    .chip.bad{background:#fff1f2;color:#be123c}
    .chip.new{background:#f0f9ff;color:#0369a1}
    .ot tr.back td{background:#fffafa}
    .loss{color:#be123c}
    .guess{color:#66726d}
    .ot tr.total td{border-top:1.5px solid #1b2420;border-bottom:0;font-weight:800;font-size:10.5px;background:#f2f6f4}
    .empty{margin:24px 0;text-align:center;color:#66726d;font-size:12px}
    .foot{margin-top:16px;padding-top:12px;border-top:1px solid #e2e7e4;color:#66726d;font-size:9px;display:flex;flex-direction:column;gap:3px}
    .made{margin-top:10px;display:flex;justify-content:space-between;gap:16px;color:#66726d;font-size:9px}
    .tiles,.cols,.ph{break-inside:avoid}
    @media print{
      body{background:#fff}
      .bar{display:none}
      .page{width:auto;margin:0;padding:0;box-shadow:none}
    }
  </style></head><body>
    <div class="bar">
      <button class="btn save" onclick="window.print()">Save as PDF</button>
      <button class="btn close" onclick="window.close()">Close</button>
      <span class="hint">In the print box, choose <b>Save as PDF</b>. Then send it on WhatsApp from your Downloads.</span>
    </div>
    <div class="page">
      <div class="ph">
        <div class="shop"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc(store.logoEmoji || name.slice(0, 1).toUpperCase())}</div>
          <div style="min-width:0"><h1>${esc(name)}</h1>
            ${store.address || store.city ? `<div class="sub">${esc(store.address || store.city)}</div>` : ''}
            <div class="sub">${esc([phone && `+91 ${phone.slice(-10)}`, link].filter(Boolean).join(' · '))}</div>
            ${store.gst ? `<div class="sub">GSTIN ${esc(store.gst)}</div>` : ''}</div></div>
        <div class="right"><div class="k">Sales statement</div><div class="rng">${esc(range)}</div>
          <div class="sub">${plural(st.days, 'day', 'days')} · made ${esc(madeAt)}</div></div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">Orders</div><div class="v">${t.count}</div><div class="s">${t.returnedCount ? `${plural(t.returnedCount, 'parcel', 'parcels')} came back` : 'none came back'}</div></div>
        <div class="tile"><div class="k">Sales</div><div class="v">${rs(t.sold)}</div><div class="s">order value, with delivery</div></div>
        <div class="tile"><div class="k">Money received</div><div class="v">${rs(t.received)}</div><div class="s">${plural(t.receivedCount, 'order', 'orders')} paid</div></div>
        <div class="tile"><div class="k">Not paid yet</div><div class="v">${rs(t.unpaid)}</div><div class="s">${t.unpaidCount ? plural(t.unpaidCount, 'order', 'orders') : 'nothing pending'}</div></div>
      </div>
      <div class="cols${showCosts ? '' : ' one'}">${where}${how}</div>
      <div class="showing">${showing}</div>
      ${ordersTable}
      ${products}
      ${oddTable}
      <div class="foot">${notes}</div>
      <div class="made"><span>Made with PocketLink${link ? ` · ${esc(link)}` : ''}</span><span>${esc(name)} · ${esc(range)}</span></div>
    </div>
  </body></html>`;
}

/** Open the statement in a new window. False when the browser blocked it. */
export function openStatement(st, opts) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(statementHtml(st, opts));
  w.document.close();
  return true;
}
