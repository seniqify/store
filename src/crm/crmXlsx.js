// Read the first sheet of an Excel .xlsx file in the browser, with no library:
// an .xlsx is a zip of XML files. Unzips with the browser's own
// DecompressionStream, reads shared strings + the first worksheet, and
// returns rows as arrays of strings. Old binary .xls is not supported.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel .xlsx file. Save it as .xlsx or .csv and try again.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(bytes, p) === 0x02014b50; n++) {
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(bytes, e) {
  const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
  const data = bytes.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('This Excel file uses a format we cannot read. Save it as .csv and try again.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const colIndex = (ref) => {
  const letters = String(ref || '').replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Rows of the first worksheet: string[][] (empty rows dropped). */
export async function readXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const files = zipEntries(bytes);
  const get = async (name) => (files.has(name) ? readEntry(bytes, files.get(name)) : '');
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

  // The first sheet in the workbook's own order.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = parse(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...parse(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheetXml = await get(sheetPath);
  if (!sheetXml) throw new Error('No sheet found in this file.');

  const shared = [];
  const ss = await get('xl/sharedStrings.xml');
  if (ss) {
    for (const si of parse(ss).getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }

  const rows = [];
  for (const r of parse(sheetXml).getElementsByTagName('row')) {
    const row = [];
    let next = 0;
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(v) ? String(Number(v)) : v;
      row[i] = String(val ?? '').trim();
    }
    for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}
