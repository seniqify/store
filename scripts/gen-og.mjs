// Renders scripts/og-template.html -> public/og-image.jpg (1200x630)
// using headless Chrome/Edge, then optimizes with sharp. Run:  node scripts/gen-og.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const tpl = resolve(here, 'og-template.html');
const raw = resolve(here, '..', 'public', 'og-raw.png');
const out = resolve(here, '..', 'public', 'og-image.jpg');

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const browser = candidates.find(existsSync);
if (!browser) { console.error('No Chrome/Edge found'); process.exit(1); }

console.log('Using', browser);
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--screenshot=' + raw,
  '--window-size=1200,630',
  '--virtual-time-budget=7000',
  pathToFileURL(tpl).href,
], { stdio: 'inherit' });

// optimize: flatten -> mozjpeg, small + WhatsApp/iMessage friendly
await sharp(raw)
  .flatten({ background: '#07110d' })
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toFile(out);
unlinkSync(raw);

const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`Wrote ${out} (${kb} KB)`);
