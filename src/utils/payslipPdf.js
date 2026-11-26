// Opens one payslip as a clean A4 page in a new window, to save as PDF (or
// print). Self-contained inline HTML, the same pattern as statementPdf.js:
// the browser draws ₹ and every script a name is typed in, and its print box
// saves the PDF. The page title is the PDF's file name in Chrome.
//
// `slip` is a payroll_slips row as Admin or sales_my_pay() returns it.
// Every value is escaped: names and reasons are typed by people.
import { monthLabel, dateLabel, rupees, rupeesInWords, orderedLines, PAID_BY, maskPayTo } from './payroll.js';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ROLE = { manager: 'Sales manager', caller: 'Calling executive', field: 'Field executive', ads: 'Ads & leads executive' };
const days = (n) => String(Number(n) || 0).replace(/\.0$/, '');

/** The payslip page, as one HTML document. */
export function payslipHtml(slip, { company = '', address = '', employeeNo = '', payTo = '', joinedOn = '', approvedBy = '' } = {}) {
  const d = slip.days || {};
  const month = monthLabel(slip.month);
  const title = `Payslip ${slip.name} ${month}`;
  const earn = orderedLines(slip.lines).filter((l) => l.amount > 0 || l.kind === 'base');
  const ded = orderedLines(slip.lines).filter((l) => l.amount < 0 || (l.kind === 'tax' && l.amount === 0));
  const row = (l) => `<tr><td>${esc(l.label)}<div class="how">${esc(l.how || '')}</div></td><td class="n">${esc(rupees(Math.abs(l.amount)))}</td></tr>`;
  const box = (label, value, on) => `<div class="box${on ? ' on' : ''}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const incs = (slip.incentives || []).map((i) => `<tr><td>${esc(i.shop || 'A shop')}</td><td>${i.plan === 'yearly' ? 'Yearly' : 'Monthly'}</td><td>${esc(dateLabel(String(i.won_at || '').slice(0, 10)))}</td><td class="n">${esc(rupees(i.amount))}</td></tr>`).join('');
  const paid = slip.status === 'paid';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; color: #111827; font: 13px/1.45 Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.page { max-width: 794px; margin: 16px auto; background: #fff; padding: 40px 48px; }
header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #111827; }
.co { flex: 1; } .co b { font-size: 18px; display: block; } .co span { color: #4b5563; font-size: 12.5px; }
.ttl { text-align: right; } .ttl .brand { font-weight: 800; color: #15803d; } .ttl h1 { margin: 4px 0 0; font-size: 22px; } .ttl div { color: #374151; font-weight: 600; }
.k { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #4b5563; }
.who { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 18px; margin: 18px 0; }
.who .v { font-weight: 600; margin-top: 2px; }
.att { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden; margin-bottom: 18px; }
.box { padding: 9px 6px; text-align: center; border-right: 1px solid #e5e7eb; } .box b { display: block; font-size: 17px; } .box span { font-size: 10.5px; font-weight: 700; color: #4b5563; } .box.on { background: #f0fdf4; }
.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #374151; background: #f3f4f6; padding: 7px 9px; border-bottom: 1px solid #d1d5db; }
td { padding: 7px 9px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.how { font-size: 11px; color: #4b5563; }
tfoot td { font-weight: 800; border-top: 1.5px solid #111827; border-bottom: 0; }
.net { display: flex; align-items: center; gap: 16px; margin: 18px 0; padding: 14px 18px; border-radius: 12px; background: #f0fdf4; border: 1.5px solid #15803d; color: #14532d; }
.net div { flex: 1; } .net b { font-size: 28px; }
.pay { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 12px 0; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; margin-top: 18px; }
footer { margin-top: 18px; font-size: 11px; color: #4b5563; }
.bar { max-width: 794px; margin: 12px auto 0; display: flex; gap: 8px; justify-content: flex-end; }
.bar button { height: 40px; padding: 0 16px; border-radius: 10px; border: 0; background: #15803d; color: #fff; font: 700 14px inherit; cursor: pointer; }
@media print { body { background: #fff; } .page { margin: 0; padding: 0; max-width: none; } .bar { display: none; } }
@media (max-width: 640px) { .page { padding: 20px 16px; } .who, .two, .pay { grid-template-columns: 1fr; } }
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">Save as PDF</button></div>
<div class="page">
<header>
  <div class="co"><b>${esc(company || 'PocketLink')}</b><span>${esc(address || '')}</span></div>
  <div class="ttl"><div class="brand">PocketLink</div><h1>Payslip</h1><div>${esc(month)}</div></div>
</header>
<section class="who">
  <div><div class="k">Name</div><div class="v">${esc(slip.name)}</div></div>
  <div><div class="k">Role</div><div class="v">${esc(ROLE[slip.role] || slip.role || '')}</div></div>
  <div><div class="k">Employee no.</div><div class="v">${esc(employeeNo || '—')}</div></div>
  <div><div class="k">Joined</div><div class="v">${esc(joinedOn ? dateLabel(joinedOn) : '—')}</div></div>
  <div><div class="k">Paid to</div><div class="v">${esc(payTo ? (payTo.includes('•') ? payTo : maskPayTo(payTo)) : '—')}</div></div>
  <div><div class="k">Paid leave left</div><div class="v">${esc(days(d.leave_left))} ${Number(d.leave_left) === 1 ? 'day' : 'days'}</div></div>
</section>
<section class="att" aria-label="Days">
  ${box('Days in month', days(d.in_month))}${box('Paid days', days(d.paid), true)}${box('Present', days((d.present || 0) + (d.late || 0) + (d.precrm || 0)))}${box('Half day', days(d.half))}${box('Paid leave', days(d.leave_paid))}${box('Weekly off', days(d.off))}${box('Holidays', days(d.holiday))}${box('Not paid', days(d.unpaid))}
</section>
<div class="two">
  <table><thead><tr><th>Earnings</th><th class="n">₹</th></tr></thead><tbody>${earn.map(row).join('')}</tbody>
    <tfoot><tr><td>Total earnings</td><td class="n">${esc(rupees(slip.earnings))}</td></tr></tfoot></table>
  <table><thead><tr><th>Deductions</th><th class="n">₹</th></tr></thead><tbody>${ded.map(row).join('') || '<tr><td>None</td><td class="n">₹0</td></tr>'}</tbody>
    <tfoot><tr><td>Total deductions</td><td class="n">${esc(rupees(slip.deductions))}</td></tr></tfoot></table>
</div>
<section class="net"><div><div class="k" style="color:#14532d">Net pay</div><div>${esc(rupeesInWords(slip.net))}</div></div><b>${esc(rupees(slip.net))}</b></section>
${incs ? `<section><div class="k" style="margin-bottom:6px">Incentive details</div><table><thead><tr><th>Shop</th><th>Plan</th><th>Shop paid on</th><th class="n">₹</th></tr></thead><tbody>${incs}</tbody></table></section>` : ''}
<section class="pay">
  <div><div class="k">${paid ? 'Paid on' : 'Status'}</div><div class="v">${esc(paid ? dateLabel(slip.paid_on) : 'Approved, not paid yet')}</div></div>
  <div><div class="k">Paid by</div><div class="v">${esc(paid ? (PAID_BY[slip.paid_method] || '') : '—')}</div></div>
  <div><div class="k">Reference</div><div class="v">${esc(paid ? (slip.paid_ref || '—') : '—')}</div></div>
</section>
<footer>Worked out by PocketLink from CRM attendance and incentives${approvedBy ? `, approved by ${esc(approvedBy)}` : ''}.<br>This payslip is made by computer and needs no signature. Questions: ask your manager in the CRM.</footer>
</div></body></html>`;
}

/** Open the payslip in a new window. False when the browser blocked it. */
export function openPayslip(slip, opts) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(payslipHtml(slip, opts));
  w.document.close();
  return true;
}
