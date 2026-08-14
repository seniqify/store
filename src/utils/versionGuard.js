/**
 * Version guard — reload a stale tab to the latest deployed build.
 *
 * Why: a browser tab left open across a deploy keeps running the OLD JavaScript
 * in memory. On a storefront that means a customer could place an order on
 * outdated code (which, before the save-first fix, could silently lose the
 * order). There's no service worker here, so a fresh navigation always gets the
 * newest code — but an already-open tab does not. This closes that gap.
 *
 * How: each build is stamped with __APP_VERSION__ and writes /version.json with
 * the same id. When the tab regains focus (the moment someone returns to an old
 * tab to order) — or on a slow poll — we compare, and if a newer build is live
 * we reload. We never reload while the user is actively typing, so a checkout in
 * progress is never interrupted.
 */

const RUNNING = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
let reloading = false;

async function fetchLatest() {
  try {
    const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.v ? String(d.v) : null;
  } catch {
    return null;   // offline / transient — do nothing
  }
}

async function checkAndMaybeReload() {
  if (reloading || RUNNING === 'dev') return;
  const latest = await fetchLatest();
  if (!latest || latest === RUNNING) return;   // current, unknown, or failed → leave alone

  // Loop-breaker: version.json is edge-cached and can momentarily disagree with
  // the served bundle. NEVER reload more than once toward a given target version,
  // and cap total reloads per session — so a stale cache can never cause a
  // reload loop / black screen.
  try {
    const st = JSON.parse(sessionStorage.getItem('pl_vg') || '{}');
    if (st.to === latest || (st.n || 0) >= 2) return;
    sessionStorage.setItem('pl_vg', JSON.stringify({ to: latest, n: (st.n || 0) + 1 }));
  } catch { /* storage blocked — the module-level `reloading` flag still applies */ }

  // Never yank the page out from under someone who's mid-typing (e.g. checkout).
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (typing) return;

  reloading = true;
  window.location.reload();
}

export function startVersionGuard() {
  if (RUNNING === 'dev' || typeof document === 'undefined') return;

  // The key moment: returning to a tab that was left open (before ordering).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAndMaybeReload();
  });
  window.addEventListener('focus', checkAndMaybeReload);

  // Belt-and-suspenders: an early check, then a gentle poll while the tab is open.
  setTimeout(checkAndMaybeReload, 15000);
  setInterval(() => {
    if (document.visibilityState === 'visible') checkAndMaybeReload();
  }, 5 * 60 * 1000);
}
