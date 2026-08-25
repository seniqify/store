/**
 * Minimal, dependency-free .docx writer — now with embedded images.
 *
 * A .docx is a ZIP of Office Open XML parts. We build a "stored" (uncompressed)
 * ZIP — valid per spec, so Word and document uploaders (incl. Meta / WhatsApp AI
 * knowledge) accept it — and emit UTF-8 XML, so ₹, Marathi/Devanagari and emoji
 * all render (a base-font PDF can't). Product photos are embedded as real image
 * parts (not links).
 *
 * paragraphsToDocxBlob(items) → Blob (a .docx). Each item is either:
 *   { text, bold, size, gap }                         a paragraph
 *   { img: { bytes:Uint8Array, ext:'png'|'jpeg', w, h } }   an inline picture
 */

const enc = new TextEncoder();
const EMU_PER_IN = 914400;
const EMU_PER_PX = 9525;          // at 96 dpi
const MAX_IMG_IN = 2.4;           // cap the displayed picture box

// ── CRC-32 ────────────────────────────────────────────────────────────────────
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

function textParagraphXml(p) {
  if (!p || !String(p.text ?? '').length) return '<w:p/>';
  const rpr = [];
  if (p.bold) rpr.push('<w:b/>');
  if (p.size) rpr.push(`<w:sz w:val="${p.size}"/><w:szCs w:val="${p.size}"/>`);
  const rPr = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
  const pPr = p.gap ? `<w:pPr><w:spacing w:after="${p.gap}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(p.text)}</w:t></w:r></w:p>`;
}

// Fit the picture into a MAX_IMG_IN square, keeping aspect ratio.
function emuSize(wPx, hPx) {
  const cap = MAX_IMG_IN * EMU_PER_IN;
  if (!(wPx > 0) || !(hPx > 0)) return { cx: Math.round(1.8 * EMU_PER_IN), cy: Math.round(1.8 * EMU_PER_IN) };
  let cx = wPx * EMU_PER_PX, cy = hPx * EMU_PER_PX;
  const s = Math.min(cap / cx, cap / cy, 1);
  return { cx: Math.round(cx * s), cy: Math.round(cy * s) };
}

function imageParagraphXml(rid, id, wPx, hPx) {
  const { cx, cy } = emuSize(wPx, hPx);
  return (
    '<w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline>' +
    '</w:drawing></w:r></w:p>'
  );
}

/** Build the raw .docx bytes from an array of text/image items. */
export function paragraphsToDocx(items = []) {
  const media = [];
  const rels = [];
  const exts = new Set();
  let imgN = 0;

  const body = items.map((it) => {
    if (it && it.img && it.img.bytes) {
      imgN++;
      const ext = it.img.ext === 'png' ? 'png' : 'jpeg';
      exts.add(ext);
      const file = `image${imgN}.${ext}`;
      const rid = `rId${imgN}`;
      media.push({ name: `word/media/${file}`, data: it.img.bytes });
      rels.push({ id: rid, target: `media/${file}` });
      return imageParagraphXml(rid, imgN, it.img.w, it.img.h);
    }
    return textParagraphXml(it);
  }).join('');

  const imgDefaults = [...exts].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' + imgDefaults +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`).join('') +
    '</Relationships>';

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    '</w:body></w:document>';

  return zipStore([
    { name: '[Content_Types].xml',            data: enc.encode(contentTypes) },
    { name: '_rels/.rels',                    data: enc.encode(rootRels) },
    { name: 'word/_rels/document.xml.rels',   data: enc.encode(docRels) },
    { name: 'word/document.xml',              data: enc.encode(documentXml) },
    ...media,
  ]);
}

export function paragraphsToDocxBlob(items = []) {
  return new Blob([paragraphsToDocx(items)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
