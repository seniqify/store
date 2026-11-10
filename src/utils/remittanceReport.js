// COD remittance report: which of our AWBs a courier's payout file mentions.
// The shop downloads the report from the Delhivery / Shadowfax panel (CSV or
// Excel) and adds it in Delivery → COD money. Column names differ by courier
// and change over time, so nothing here depends on them: every cell is read as
// text and matched against the AWBs the courier still owes for.

/** Every word-like token of a text, upper-cased (AWBs: digits, or SF… codes). */
export function tokensOf(text) {
  const out = new Set();
  for (const t of String(text || '').toUpperCase().match(/[A-Z0-9]{6,}/g) || []) out.add(t);
  return out;
}

/** The owed rows whose AWB appears in the report text. PURE. */
export function matchRemittance(owed = [], text = '') {
  const seen = tokensOf(text);
  const paid = [];
  const missing = [];
  for (const row of owed) {
    const awb = String(row?.awb || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    (awb && seen.has(awb) ? paid : missing).push(row);
  }
  return { paid, missing };
}

// ── .xlsx: a zip of XML files. Read with the browser's own inflater. ──
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The text of every sheet + the shared strings of an .xlsx (ArrayBuffer). */
export async function xlsxText(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  // End of central directory: the last "PK\x05\x06".
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid Excel file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  let text = '';
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    const xml = dec.decode(method === 8 ? await inflateRaw(raw) : raw);
    text += ` ${xml.replace(/<[^>]+>/g, ' ')}`;
  }
  return text;
}

/** A File (CSV, TXT or XLSX) → its text. */
export async function readReportFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.xls')) throw new Error('Old .xls files can’t be read. Download it as CSV or .xlsx from the courier panel.');
  if (name.endsWith('.xlsx')) return xlsxText(await file.arrayBuffer());
  return file.text();
}
