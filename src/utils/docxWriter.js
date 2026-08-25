/**
 * Minimal, dependency-free .docx writer.
 *
 * A .docx is just a ZIP of Office Open XML parts. We build the ZIP with the
 * "stored" (uncompressed) method — valid per spec, so Word and document
 * uploaders (incl. Meta / WhatsApp AI knowledge) accept it — and emit UTF-8 XML,
 * so ₹, Devanagari/Marathi and emoji all render correctly (a base-font PDF can't
 * do that without embedding fonts). Reused by the Bot Knowledge generator; kept
 * generic so anything else can produce a Word doc from paragraphs.
 *
 * paragraphsToDocxBlob([{ text, bold, size, gap }]) → Blob (a .docx file).
 *   size = half-points (22 = 11pt); gap = twips of space after the paragraph.
 *   A paragraph with empty text renders as a blank line.
 */

const enc = new TextEncoder();

// ── CRC-32 (needed in every ZIP entry) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Stored ZIP from [{ name, data:Uint8Array }] ───────────────────────────────
function zipStore(files) {
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ]);
    parts.push(local, name, f.data);
    central.push({ name, crc, size, offset });
    offset += local.length + name.length + size;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const c of central) {
    const rec = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset),
    ]);
    centralParts.push(rec, c.name);
    centralSize += rec.length + c.name.length;
  }
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const all = [...parts, ...centralParts, end];
  let total = 0;
  for (const a of all) total += a.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const xmlEscape = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

function paragraphXml(p) {
  if (!p || !String(p.text ?? '').length) return '<w:p/>';
  const rpr = [];
  if (p.bold) rpr.push('<w:b/>');
  if (p.size) rpr.push(`<w:sz w:val="${p.size}"/><w:szCs w:val="${p.size}"/>`);
  const rPr = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
  const pPr = p.gap ? `<w:pPr><w:spacing w:after="${p.gap}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(p.text)}</w:t></w:r></w:p>`;
}

/** Build the raw .docx bytes from an array of paragraph descriptors. */
export function paragraphsToDocx(paras = []) {
  const body = paras.map(paragraphXml).join('');
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    '</w:body></w:document>';

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels',         data: enc.encode(ROOT_RELS) },
    { name: 'word/document.xml',   data: enc.encode(documentXml) },
  ]);
}

/** Same, wrapped as a downloadable .docx Blob. */
export function paragraphsToDocxBlob(paras = []) {
  return new Blob([paragraphsToDocx(paras)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
