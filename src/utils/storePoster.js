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
  const qr      = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=12&qzone=1&color=111827&data=${encodeURIComponent(url)}`;

  const avatar = logo
    ? `<img src="${esc(logo)}" style="width:84px;height:84px;border-radius:20px;object-fit:cover;border:3px solid #fff;box-shadow:0 8px 24px rgba(0,0,0,.18)" />`
    : `<div style="width:84px;height:84px;border-radius:20px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:44px">${emoji}</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(name)} — QR Poster</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
    body{background:#f1f5f9;display:flex;flex-direction:column;align-items:center;padding:24px;min-height:100vh}
    .bar{display:flex;gap:10px;margin-bottom:18px}
    .btn{border:0;cursor:pointer;font-weight:700;font-size:14px;padding:10px 18px;border-radius:12px}
    .print{background:${brand};color:#fff}
    .close{background:#fff;color:#475569;border:1px solid #e2e8f0}
    .poster{width:420px;max-width:100%;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.14)}
    .top{background:linear-gradient(135deg,${brand},${brand}d0);padding:28px 24px 22px;text-align:center;color:#fff}
    .name{font-size:24px;font-weight:800;margin-top:12px;letter-spacing:-.4px}
    .tag{font-size:13px;opacity:.92;margin-top:5px}
    .body{padding:26px 24px 22px;text-align:center}
    .h{font-size:18px;font-weight:800;color:#0f172a}
    .sub{font-size:13px;color:#64748b;margin-top:5px;margin-bottom:18px}
    .qrwrap{display:inline-block;padding:14px;border-radius:20px;border:2px solid #f1f5f9}
    .qr{width:236px;height:236px;display:block}
    .url{font-size:13px;font-weight:600;color:#64748b;margin-top:16px;word-break:break-all}
    .foot{font-size:11px;color:#cbd5e1;margin-top:14px}
    @media print{ body{background:#fff;padding:0} .bar{display:none} .poster{box-shadow:none;border:1px solid #eee} }
  </style></head>
  <body>
    <div class="bar">
      <button class="btn print" onclick="window.print()">🖨️ Print / Save PDF</button>
      <button class="btn close" onclick="window.close()">Close</button>
    </div>
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
