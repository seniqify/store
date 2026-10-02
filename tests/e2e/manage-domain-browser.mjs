// PR-E in a real browser: the owner's "Your own domain" card in Manage → Settings,
// and the shared links that switch to the domain once it is live.
//
// Opt-in (needs Google Chrome):   node tests/e2e/manage-domain-browser.mjs
//
// Builds the SPA (test Supabase settings) into a temporary folder and drives
// headless Chrome. Every request is intercepted over the DevTools protocol:
//   * the SPA's Supabase calls -> the routing world's stand-in (verify_store_pin
//     answers true for the test PIN);
//   * POST /api/domains/manage -> a scripted fake of the domain API below. The
//     real API (PIN gate, pilot list, state machine, SQL) is covered by
//     tests/custom-domains-server.test.mjs; this file proves the CARD: what it
//     shows for each answer, what it sends, and which links it switches.
//   * pages and assets -> the real routing pipeline over the built SPA.
// All real DNS is blackholed, so nothing leaves this machine.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SB, ANON, createDb, createSupabase, createPipeline } from '../helpers/routingWorld.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((p) => existsSync(p));
const PORT = 9339;
const PIN = '2580';
const SLUG = 'brandshop';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. Build ──
const work = mkdtempSync(join(tmpdir(), 'pl-e2e-manage-'));
const dist = join(work, 'dist');
const build = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON },
});
if (build.status !== 0) { console.error(build.stdout, build.stderr); process.exit(1); }
const SHELL = readFileSync(join(dist, 'index.html'), 'utf8');

// ── 2. The world ──
const db = await createDb();
const supabase = createSupabase(db);
const pipeline = createPipeline({ env: { VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON }, supabase, shell: SHELL, distDir: dist });
const hashedPinOf = async (pin) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`snq1_${pin}`)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const HASHED = await hashedPinOf(PIN);

// ── 3. A scripted domain API ──
const api = {
  enabled: false, serving: true, group: null, verifyCalls: 0, refreshCalls: 0, otp: null,
  calls: [],            // every request body, as sent
};
const TOKEN = 'f'.repeat(32);
function group(status, primary = 'brand.test') {
  return {
    status, primary_host: primary, expires_at: '2026-10-05T10:00:00Z',
    hostnames: [{ hostname: 'brand.test', kind: 'apex', role: primary === 'brand.test' ? 'primary' : 'redirect', vercel: 'configured' },
                { hostname: 'www.brand.test', kind: 'www', role: primary === 'brand.test' ? 'redirect' : 'primary', vercel: 'configured' }],
    txt: ['pending', 'verified', 'ready'].includes(status) ? { type: 'TXT', name: '_pocketlink.brand.test', value: TOKEN } : null,
  };
}
function domainApi(body) {
  api.calls.push(body);
  if (body.slug !== SLUG || body.hashedPin !== HASHED) return [403, { outcome: 'unauthorized' }];
  if (!api.enabled) return [200, { outcome: 'feature_disabled' }];
  const g = api.group;
  const view = () => ({ domain: api.group });
  switch (body.action) {
    case 'status': return [200, { outcome: 'ok', ...view(), serving: Boolean(g && g.status === 'connected' && api.serving) }];
    case 'claim':
      if (body.hostname === 'taken.test') return [200, { outcome: 'hostname_in_use' }];
      api.group = group('pending');
      return [200, { outcome: 'claimed', ...view() }];
    case 'verify':
      if (++api.verifyCalls === 1) return [200, { outcome: 'txt_not_found', dns: 'not_found', ...view() }];
      api.group = group('verified');
      return [200, { outcome: 'verified', vercel_verification: [], ...view() }];
    case 'refresh':
      if (++api.refreshCalls === 1) {
        return [200, { outcome: 'ok', vercel_verification: [], ...view(), dns_records: [
          { host: 'brand.test', type: 'A', value: '76.76.21.21' }, { host: 'www.brand.test', type: 'CNAME', value: 'cname.vercel-dns.com' }] }];
      }
      api.group = group('ready');
      return [200, { outcome: 'ok', dns_records: [], vercel_verification: [], ...view() }];
    case 'request_otp':
      api.otp = { purpose: body.otpAction, target: body.hostname || null };
      return [200, { outcome: 'otp_sent', challenge_id: '11111111-2222-3333-4444-555555555555', expires_at: '2026-10-02T10:10:00Z', sent_to: '+91 •••••• 7668' }];
    case 'activate':
      if (body.code !== '123456') return [200, { outcome: 'invalid_code' }];
      api.group = group('connected');
      return [200, { outcome: 'connected', ...view() }];
    case 'set_primary':
      if (body.code !== '123456') return [200, { outcome: 'invalid_code' }];
      api.group = group('connected', body.hostname);
      return [200, { outcome: 'ok', ...view() }];
    case 'disconnect':
      if (g?.status === 'pending' || g?.status === 'disconnecting') { api.group = null; return [200, { outcome: 'disconnected' }]; }
      if (body.code !== '123456') return [200, { outcome: 'invalid_code' }];
      api.group = { ...g, status: 'disconnecting', txt: null };
      return [200, { outcome: 'disconnecting', ...view() }];
    default: return [400, { outcome: 'invalid_action' }];
  }
}

// ── 4. Chrome, every request answered here ──
const profile = join(work, 'profile');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
  '--disable-web-security', '--host-resolver-rules=MAP * ~NOTFOUND', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const pageErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const json = (status, obj) => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(obj)) });

async function answer({ requestId, request }) {
  const u = new URL(request.url);
  try {
    let res;
    if (u.hostname === 'sb.test') {
      if (u.pathname === '/rest/v1/rpc/verify_store_pin') {
        const b = JSON.parse(request.postData || '{}');
        res = json(200, b.p_slug === SLUG && b.p_hashed_pin === HASHED);
      } else {
        const r = await supabase.handle(request.url, { method: request.method, headers: request.headers, body: request.postData });
        res = { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
      }
    } else if (u.hostname === 'www.pocketlink.store' && u.pathname === '/api/domains/manage') {
      const [status, obj] = domainApi(JSON.parse(request.postData || '{}'));
      res = json(status, obj);
    } else if (u.hostname === 'www.pocketlink.store') {
      res = await pipeline.handle({ method: request.method, url: request.url, headers: request.headers });
    } else {
      await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }
    await send('Fetch.fulfillRequest', {
      requestId, responseCode: res.status,
      responseHeaders: Object.entries(res.headers).map(([name, value]) => ({ name, value: String(value) })),
      body: res.body.toString('base64'),
    });
  } catch (e) {
    pageErrors.push(`harness: ${request.url}: ${e.message}`);
    await send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
  }
}
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Fetch.requestPaused') answer(m.params);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] || 'exception');
});
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(120); }
  return false;
}
const card = `document.querySelector('[data-testid="domain-connect"]')`;
const cardText = (s) => `!!${card} && ${card}.innerText.toLowerCase().includes(${JSON.stringify(s.toLowerCase())})`;
const bodyText = (s) => `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(s.toLowerCase())})`;
const clickIn = (root, label) => ev(`(() => {
  const r = ${root}; if (!r) return 'no-root';
  const b = [...r.querySelectorAll('button,a,[role=button]')].find(e => e.innerText.trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
  if (!b) return 'not-found'; b.scrollIntoView({block:'center'}); b.click(); return 'ok';
})()`);
const typeInto = (selector, value) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'not-found';
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok';
})()`);

// Optional: SHOTS=<folder> saves a PNG of the card at each step (for review).
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
async function shot(name) {
  if (!SHOTS) return;
  const r = await ev(`(() => { const el = ${card}; if (!el) return null; el.scrollIntoView({block:'center'});
    const b = el.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
  if (!r) return;
  await sleep(200);
  const pad = 12;
  const out = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(out.result.data, 'base64'));
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` -- ${detail}` : ''}`);
};

async function openSettings() {
  await send('Page.navigate', { url: `https://www.pocketlink.store/${SLUG}/manage` });
  await waitFor(`!!document.querySelector('input[placeholder="• • • •"]') || ${bodyText('settings')}`);
  if (await ev(`!!document.querySelector('input[placeholder="• • • •"]')`)) {
    await typeInto('input[placeholder="• • • •"]', PIN);
    await ev(`document.querySelector('form button[type=submit]').click()`);
  }
  await waitFor(bodyText('settings'));
  await ev(`(() => { const b = [...document.querySelectorAll('button,a')].find(e => e.innerText.trim() === 'Settings'); b && b.click(); })()`);
  await waitFor(bodyText('your page is live'));
  await sleep(400);
}
const heroLink = () => ev(`(() => { const p = [...document.querySelectorAll('p')].find(e => /your page is live/i.test(e.innerText)); const a = p && p.parentElement.querySelector('a'); return a ? { text: a.innerText.trim(), href: a.getAttribute('href') } : null; })()`);
const waShareHref = () => ev(`(() => { const a = [...document.querySelectorAll('a')].find(e => /share on whatsapp/i.test(e.innerText)); return a ? decodeURIComponent(a.getAttribute('href')) : null; })()`);

// ═══ A. Feature off for this store: no card, links exactly as before ═══
await openSettings();
check('feature off: the domain card is not rendered', !(await ev(`!!${card}`)) && !(await ev(bodyText('your own domain'))));
let hero = await heroLink();
check('feature off: hero link is the PocketLink link', hero?.text === `https://www.pocketlink.store/${SLUG}` && hero?.href === `/${SLUG}`, JSON.stringify(hero));
check('feature off: exactly one status call, nothing else', api.calls.length === 1 && api.calls[0].action === 'status', JSON.stringify(api.calls.map((c) => c.action)));

// ═══ B. The full journey ═══
api.enabled = true;
await openSettings();
check('none: card asks for a domain', await waitFor(cardText('connect domain')));
await shot('1-none');

await typeInto(`[data-testid="domain-connect"] input`, 'taken.test');
await clickIn(card, 'connect domain');
check('claim refused: plain message shown', await waitFor(cardText('already connected to another PocketLink shop')));

await typeInto(`[data-testid="domain-connect"] input`, 'brand.test');
await clickIn(card, 'connect domain');
check('pending: step 1 shows the TXT record', await waitFor(cardText('step 1 of 3')) && await ev(cardText(TOKEN)) && await ev(cardText('_pocketlink')));
check('pending: full-name hint for panels that want it', await ev(cardText('_pocketlink.brand.test')));
await shot('2-step1-txt');

await clickIn(card, 'added it');
check('verify (TXT not visible yet): plain message, still step 1', await waitFor(cardText('can’t see the record yet')) && await ev(cardText('step 1 of 3')));
await clickIn(card, 'added it');
check('verified: step 2 shows Vercel\'s records with panel names', await waitFor(cardText('step 2 of 3')) && await waitFor(cardText('76.76.21.21'))
  && await ev(cardText('cname.vercel-dns.com')) && await ev(`${card}.innerText.includes('@')`) && await ev(`/\\bwww\\b/.test(${card}.innerText)`));

await shot('3-step2-dns');
await clickIn(card, 'check again');
check('ready: step 3 offers the WhatsApp code', await waitFor(cardText('step 3 of 3')) && await ev(cardText('send code')));

await clickIn(card, 'send code');
check('code sent: masked owner number shown', await waitFor(cardText('7668')));
await shot('4-step3-code');
await typeInto(`[data-testid="domain-connect"] input[autocomplete="one-time-code"]`, '000000');
await clickIn(card, 'go live');
check('wrong code: plain message; the code box is cleared', await waitFor(cardText('wrong or has expired'))
  && (await ev(`document.querySelector('[data-testid="domain-connect"] input[autocomplete="one-time-code"]').value`)) === '');
await typeInto(`[data-testid="domain-connect"] input[autocomplete="one-time-code"]`, '123456');
await clickIn(card, 'go live');
check('connected: live box with both names', await waitFor(cardText('brand.test is live')) && await ev(cardText('www.brand.test opens it too')));
await shot('5-connected');

hero = await heroLink();
check('connected + served: hero link switches to the domain', hero?.text === 'https://brand.test' && hero?.href === 'https://brand.test', JSON.stringify(hero));
check('connected + served: WhatsApp share uses the domain', (await waShareHref())?.includes('https://brand.test'));
check('connected + served: sidebar shows the domain', await ev(`[...document.querySelectorAll('p')].some(p => p.innerText.trim() === 'brand.test')`));

// Connected but not served (routing off for it): note shown, links stay on PocketLink.
api.serving = false;
await openSettings();
check('connected, not served: amber note', await waitFor(cardText('switch it on for customers soon')));
hero = await heroLink();
check('connected, not served: hero link stays on PocketLink', hero?.text === `https://www.pocketlink.store/${SLUG}`, JSON.stringify(hero));
api.serving = true;
await openSettings();
await waitFor(cardText('brand.test is live'));

// Use www as main address
await clickIn(card, 'use www.brand.test as main address');
check('set primary: confirm explains the change', await waitFor(cardText('make www.brand.test the main address')));
await clickIn(card, 'send code to confirm');
await waitFor(`!!document.querySelector('[data-testid="domain-connect"] input[autocomplete="one-time-code"]')`);
await typeInto(`[data-testid="domain-connect"] input[autocomplete="one-time-code"]`, '123456');
await clickIn(card, 'make it the main address');
check('set primary: www is now the live main address', await waitFor(cardText('www.brand.test is live')));
const sp = api.calls.find((c) => c.action === 'set_primary');
check('set primary: request names the www host and the code', sp?.hostname === 'www.brand.test' && sp?.code === '123456' && /^[0-9a-f-]{36}$/.test(sp?.challengeId || ''));

// Disconnect
await clickIn(card, 'disconnect');
check('disconnect: confirm warns customers will see not connected', await waitFor(cardText('will see “not connected”')));
await shot('6-disconnect-confirm');
await clickIn(card, 'send code to confirm');
await waitFor(`!!document.querySelector('[data-testid="domain-connect"] input[autocomplete="one-time-code"]')`);
await typeInto(`[data-testid="domain-connect"] input[autocomplete="one-time-code"]`, '123456');
await clickIn(card, 'disconnect domain');
check('disconnecting: progress shown', await waitFor(cardText('disconnecting www.brand.test')));
await clickIn(card, 'check again');
check('disconnected: back to "Connect domain"', await waitFor(cardText('connect domain')));
hero = await heroLink();
check('disconnected: hero link back on PocketLink', hero?.text === `https://www.pocketlink.store/${SLUG}`, JSON.stringify(hero));

// ═══ C. What the card sent ═══
check('every request carried the hashed PIN, never the PIN', api.calls.every((c) => c.hashedPin === HASHED && !JSON.stringify(c).includes(`"${PIN}"`)));
check('the PIN is not left in the page', !(await ev(`document.body.innerText.includes(${JSON.stringify(PIN)})`)));
check('the PIN and codes are not stored in the browser', !(await ev(`JSON.stringify({...localStorage, ...sessionStorage}).match(/2580|123456/)`)));
check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
ws.close();
chrome.kill();
await sleep(400);
try { rmSync(work, { recursive: true, force: true }); } catch { /* profile still locked */ }
process.exit(passed === results.length ? 0 : 1);
