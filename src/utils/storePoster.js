// Opens a clean, printable "Scan to order on WhatsApp" poster for a store, in a
// new window (print / save-as-PDF / screenshot). Self-contained inline HTML —
// the QR is rendered by the free goqr.me API from the live store URL.

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function openStorePoster(config = {}) {
  const slug    = config.slug;
  if (!slug) return;
  const origin  = window.location.origin;
  const url     = `${origin}/${slug}`;
  const brand   = config.theme?.primary || '#0d9488';
  const name    = config.businessName || 'My Store';
  const emoji   = config.logoEmoji || '🏪';
  const logo    = config.logo || '';
  const tagline = config.tagline || 'Order on WhatsApp';
  const qr      = `https://api.qrserver.com/v1/create-qr-code/?size=720x720&margin=8&qzone=1&color=111827&data=${encodeURIComponent(url)}`;

  const avatar = logo
    ? `<img src="${esc(logo)}" style="width:84px;height:84px;border-radius:20px;object-fit:cover;border:3px solid #fff;box-shadow:0 8px 24px rgba(0,0,0,.18)" />`
    : `<div style="width:84px;height:84px;border-radius:20px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:44px">${emoji}</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(name)} — QR Poster (4×6)</title>
  <style>
    /* The printable is an exact 4in × 6in sticker, so it drops straight onto a
       4×6 label printer with no scaling. print-color-adjust keeps the coloured
       header from being stripped white by the browser's print path. */
    @page{ size:4in 6in; margin:0 }
    *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{background:#e2e8f0;display:flex;flex-direction:column;align-items:center;padding:22px;min-height:100vh}
    .bar{display:flex;gap:10px;margin-bottom:14px}
    .btn{border:0;cursor:pointer;font-weight:700;font-size:14px;padding:10px 18px;border-radius:12px}
    .print{background:${brand};color:#fff}
    .close{background:#fff;color:#475569;border:1px solid #e2e8f0}
    .hint{font-size:12px;color:#64748b;margin-bottom:16px;text-align:center;max-width:4in}
    .poster{width:4in;height:6in;background:#fff;border-radius:16px;overflow:hidden;
      display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.18)}
    .top{flex:0 0 auto;background:linear-gradient(135deg,${brand},${brand}d0);color:#fff;
      padding:.32in .28in .26in;text-align:center;display:flex;flex-direction:column;align-items:center}
    .name{font-size:25px;font-weight:800;margin-top:11px;letter-spacing:-.4px;line-height:1.1}
    .tag{font-size:12.5px;opacity:.93;margin-top:5px}
    .body{flex:1;padding:.2in .28in .22in;text-align:center;display:flex;flex-direction:column;
      align-items:center;justify-content:center}
    .h{font-size:16.5px;font-weight:800;color:#0f172a}
    .sub{font-size:11.5px;color:#64748b;margin-top:4px;margin-bottom:.15in}
    .qrwrap{display:inline-block;padding:11px;border-radius:16px;border:2px solid #eef2f7}
    .qr{width:214px;height:214px;display:block}
    .url{font-size:12px;font-weight:700;color:#475569;margin-top:.15in;word-break:break-all}
    .foot{font-size:10px;color:#94a3b8;margin-top:.1in}
    @media print{
      html,body{width:4in;height:6in;background:#fff;padding:0;margin:0;overflow:hidden}
      .bar,.hint{display:none}
      .poster{width:4in;height:6in;border-radius:0;box-shadow:none;border:none}
    }
  </style></head>
  <body>
    <div class="bar">
      <button class="btn print" onclick="window.print()">🖨️ Print / Save PDF</button>
      <button class="btn close" onclick="window.close()">Close</button>
    </div>
    <div class="hint">Sized for a 4″ × 6″ label. In the print dialog set paper to <b>4×6</b> and margins to <b>None</b>.</div>
    <div class="poster">
      <div class="top">
        ${avatar}
        <div class="name">${esc(name)}</div>
        <div class="tag">${esc(tagline)}</div>
      </div>
      <div class="body">
        <div class="h">📲 Scan to order on WhatsApp</div>
        <div class="sub">Point your phone camera at the code</div>
        <div class="qrwrap"><img class="qr" src="${qr}" alt="QR code" /></div>
        <div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>
        <div class="foot">No app needed · Powered by PocketLink</div>
      </div>
    </div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
