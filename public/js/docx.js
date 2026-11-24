// Nebulix 3.0 — Word (.docx) export for Nebulix Docs, with no libraries: the document's (already sanitised) HTML is
// turned into WordprocessingML and packed with the tiny ZIP writer. Covers what the Docs editor can produce: headings,
// paragraphs, quotes, code blocks, bold/italic/underline/strike, sub/superscript, colours, highlight, fonts and sizes,
// alignment and indent, bulleted/numbered (nested) lists, tables (with colspan), links, horizontal lines and images.
import { zipFiles } from './zipwrite.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// XML-escape and drop characters XML 1.0 does not allow
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|HR|LI)$/;
const FONT_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
const MAX_W = 6 * 914400; // 6 inches of page width, in EMU

function hex(c) {
  if (!c) return null; c = String(c).trim().toLowerCase();
  let m = c.match(/^#([0-9a-f]{3})$/); if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
  m = c.match(/^#([0-9a-f]{6})$/); if (m) return m[1].toUpperCase();
  m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) { if (m[4] !== undefined && Number(m[4]) === 0) return null; return [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080' };
  return named[c] || null;
}
function sizePt(v) {
  const m = String(v || '').trim().match(/^([\d.]+)(px|pt|em|rem)?$/); if (!m) return null; const n = Number(m[1]);
  const pt = m[2] === 'pt' ? n : m[2] === 'em' || m[2] === 'rem' ? n * 12 : n * 0.75; return pt >= 4 && pt <= 200 ? pt : null;
}
const firstFont = (f) => String(f || '').split(',')[0].replace(/["']/g, '').trim().replace(/^(system-ui|sans-serif|-apple-system)$/i, 'Calibri').replace(/^(ui-monospace|monospace)$/i, 'Consolas').replace(/^serif$/i, 'Georgia').slice(0, 40) || null;

// run formatting inherited from an element
function runStyle(el, base) {
  const r = { ...base }; const tag = el.tagName; const st = el.style || {};
  if (tag === 'B' || tag === 'STRONG' || tag === 'TH') r.b = true;
  if (tag === 'I' || tag === 'EM') r.i = true;
  if (tag === 'U') r.u = true;
  if (tag === 'S' || tag === 'STRIKE') r.s = true;
  if (tag === 'SUB') r.va = 'subscript'; if (tag === 'SUP') r.va = 'superscript';
  if (tag === 'CODE') r.font = 'Consolas';
  if (tag === 'MARK') r.hl = 'FDE047';
  if (tag === 'FONT') { if (el.getAttribute('color')) r.color = hex(el.getAttribute('color')) || r.color; if (el.getAttribute('face')) r.font = firstFont(el.getAttribute('face')); if (FONT_PT[el.getAttribute('size')]) r.pt = FONT_PT[el.getAttribute('size')]; }
  if (st.fontWeight) r.b = st.fontWeight === 'bold' || Number(st.fontWeight) >= 600;
  if (st.fontStyle) r.i = st.fontStyle === 'italic';
  if (st.textDecoration || st.textDecorationLine) { const d = st.textDecorationLine || st.textDecoration; if (/underline/.test(d)) r.u = true; if (/line-through/.test(d)) r.s = true; }
  if (st.color) r.color = hex(st.color) || r.color;
  if (st.backgroundColor) r.hl = hex(st.backgroundColor) || r.hl;
  if (st.fontFamily) r.font = firstFont(st.fontFamily);
  if (st.fontSize) r.pt = sizePt(st.fontSize) || r.pt;
  return r;
}
function rPr(r) {
  let x = '';
  if (r.link) x += '<w:rStyle w:val="Hyperlink"/>';
  if (r.font) x += `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`;
  if (r.b) x += '<w:b/>'; if (r.i) x += '<w:i/>'; if (r.s) x += '<w:strike/>';
  if (r.color) x += `<w:color w:val="${r.color}"/>`;
  if (r.pt) x += `<w:sz w:val="${Math.round(r.pt * 2)}"/><w:szCs w:val="${Math.round(r.pt * 2)}"/>`;
  if (r.u) x += '<w:u w:val="single"/>';
  if (r.hl) x += `<w:shd w:val="clear" w:color="auto" w:fill="${r.hl}"/>`;
  if (r.va) x += `<w:vertAlign w:val="${r.va}"/>`;
  return x ? '<w:rPr>' + x + '</w:rPr>' : '';
}
const textRun = (txt, r) => `<w:r>${rPr(r)}<w:t xml:space="preserve">${esc(txt)}</w:t></w:r>`;

function pPr(el, o = {}) {
  let x = '';
  if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
  if (o.num) x += `<w:numPr><w:ilvl w:val="${o.num.lvl}"/><w:numId w:val="${o.num.id}"/></w:numPr>`;
  if (o.hr) x += '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="A0A0B0"/></w:pBdr>';
  const st = (el && el.style) || {}; const ind = parseFloat(st.marginLeft || st.paddingLeft || 0);
  if (ind > 0 && !o.num) x += `<w:ind w:left="${Math.min(8000, Math.round(ind * 15))}"/>`;
  const al = (st.textAlign || (el && el.getAttribute && el.getAttribute('align')) || '').toLowerCase();
  const jc = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'both' }[al];
  if (jc) x += `<w:jc w:val="${jc}"/>`;
  return x ? '<w:pPr>' + x + '</w:pPr>' : '';
}

export async function htmlToDocx(html, { title = 'Document', images = new Map() } = {}) {
  const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  const rels = []; const media = []; const nums = []; let pid = 0;
  const rel = (type, target, ext) => { const id = 'rId' + (rels.length + 10); rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ''}/>`); return id; };

  // images are prepared before (async): src → { bytes: Uint8Array, w, h } as PNG
  function imageRun(el) {
    const im = images.get(el.getAttribute('src')); if (!im) return el.getAttribute('alt') ? textRun('[' + el.getAttribute('alt') + ']', {}) : '';
    let cx = Math.round(im.w * 9525); let cy = Math.round(im.h * 9525); if (cx > MAX_W) { cy = Math.round(cy * MAX_W / cx); cx = MAX_W; }
    const n = media.length + 1; media.push({ path: `word/media/image${n}.png`, bytes: im.bytes }); const id = rel('image', `media/image${n}.png`); pid += 1;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pid}" name="Picture ${pid}"${el.getAttribute('alt') ? ` descr="${esc(el.getAttribute('alt').slice(0, 200))}"` : ''}/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pid}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  // inline content → runs
  function runs(node, r, pre) {
    let x = '';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        let txt = ch.nodeValue; if (!pre) txt = txt.replace(/[ \t\n\r\f]+/g, ' ');
        if (!txt) continue;
        if (pre) { txt.split('\n').forEach((line, i) => { if (i) x += '<w:r><w:br/></w:r>'; if (line) x += textRun(line, r); }); } else x += textRun(txt, r);
      } else if (ch.nodeType === 1) {
        const tag = ch.tagName;
        if (tag === 'BR') x += '<w:r><w:br/></w:r>';
        else if (tag === 'IMG') x += imageRun(ch);
        else if (tag === 'A') {
          const href = (ch.getAttribute('href') || '').trim(); const inner = runs(ch, { ...runStyle(ch, r), link: /^(https?:|mailto:)/i.test(href) }, pre);
          x += /^(https?:|mailto:)/i.test(href) ? `<w:hyperlink r:id="${rel('hyperlink', href, true)}" w:history="1">${inner}</w:hyperlink>` : inner;
        } else if (BLOCK.test(tag)) x += runs(ch, r, pre); // a stray block inside inline content: keep its text
        else x += runs(ch, runStyle(ch, r), pre);
      }
    }
    return x;
  }
  const para = (el, o, r, pre) => `<w:p>${pPr(el, o)}${runs(el, r || {}, pre)}</w:p>`;

  // a container whose children mix inline and block content
  function blocks(node, ctx = {}) {
    let out = ''; let inline = [];
    const flush = () => {
      if (!inline.length) return; const holder = doc.createElement('span'); inline.forEach((n) => holder.appendChild(n.cloneNode(true)));
      if ((holder.textContent || '').trim() || holder.querySelector('img,br')) out += `<w:p>${pPr(ctx.el, ctx.p || {})}${runs(holder, ctx.r || {})}</w:p>`;
      inline = [];
    };
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 1 && BLOCK.test(ch.tagName)) { flush(); out += block(ch, ctx); } else if (ch.nodeType === 1 || ch.nodeType === 3) inline.push(ch);
    }
    flush(); return out;
  }
  function list(el, ctx) {
    const lvl = ctx.list ? Math.min(8, ctx.list.lvl + 1) : 0; const ordered = el.tagName === 'OL';
    let id = ctx.list && ctx.list.ordered === ordered ? ctx.list.id : 0;
    if (!id) { nums.push(ordered ? 2 : 1); id = nums.length; }
    let out = '';
    for (const li of el.children) {
      if (li.tagName !== 'LI') { out += block(li, ctx); continue; }
      const sub = { ...ctx, list: { id, lvl, ordered }, p: { num: { id, lvl } }, el: li };
      // the item's own text is one paragraph; nested lists follow as their own paragraphs
      let inline = []; let first = true;
      const flush = () => { const holder = doc.createElement('span'); inline.forEach((n) => holder.appendChild(n.cloneNode(true))); if (first || (holder.textContent || '').trim()) { out += `<w:p>${pPr(li, first ? sub.p : { style: 'ListParagraph' })}${runs(holder, ctx.r || {})}</w:p>`; first = false; } inline = []; };
      for (const ch of [...li.childNodes]) {
        if (ch.nodeType === 1 && (ch.tagName === 'UL' || ch.tagName === 'OL')) { flush(); out += list(ch, sub); } else if (ch.nodeType === 1 && BLOCK.test(ch.tagName)) { inline.push(...ch.childNodes); } else inline.push(ch);
      }
      if (inline.length || first) flush();
    }
    return out;
  }
  function table(el, ctx) {
    const rows = [...el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')]; if (!rows.length) return '';
    const cols = Math.max(1, ...rows.map((tr) => [...tr.children].reduce((a, td) => a + Math.max(1, Math.min(20, Number(td.getAttribute('colspan')) || 1)), 0)));
    const w = Math.floor(9000 / cols); const bd = '<w:top w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8B8C8"/>';
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>`;
    for (const tr of rows) {
      x += '<w:tr>'; let used = 0;
      for (const td of tr.children) {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
        const span = Math.max(1, Math.min(cols - used, Number(td.getAttribute('colspan')) || 1)); if (span < 1) break; used += span;
        const bg = hex(td.style && td.style.backgroundColor);
        const inner = blocks(td, { r: td.tagName === 'TH' ? { b: true } : {}, el: td }) || '<w:p/>';
        x += `<w:tc><w:tcPr><w:tcW w:w="${w * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
      }
      if (used < cols) x += `<w:tc><w:tcPr><w:tcW w:w="${w * (cols - used)}" w:type="dxa"/>${cols - used > 1 ? `<w:gridSpan w:val="${cols - used}"/>` : ''}</w:tcPr><w:p/></w:tc>`;
      x += '</w:tr>';
    }
    return x + '</w:tbl><w:p/>';
  }
  function block(el, ctx) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return para(el, { style: 'Heading' + Math.min(4, Number(tag[1])) }, ctx.r);
    if (tag === 'P') return para(el, ctx.p || {}, ctx.r);
    if (tag === 'PRE') return para(el, { style: 'Code' }, { ...ctx.r, font: 'Consolas' }, true);
    if (tag === 'BLOCKQUOTE') return blocks(el, { ...ctx, p: { style: 'Quote' }, el });
    if (tag === 'HR') return `<w:p>${pPr(null, { hr: true })}</w:p>`;
    if (tag === 'UL' || tag === 'OL') return list(el, ctx);
    if (tag === 'TABLE') return table(el, ctx);
    if (tag === 'LI') return para(el, {}, ctx.r);
    return blocks(el, { ...ctx, el }); // DIV
  }

  const body = blocks(doc.body) || '<w:p/>';
  const documentXml = `${HEAD}<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const lvls = (fmt) => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt === 'bullet' ? 'bullet' : ['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="${fmt === 'bullet' ? ['•', '◦', '▪'][i % 3] : '%' + (i + 1) + '.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const numberingXml = `${HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum>` +
    nums.map((a, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${a}"/>${a === 2 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`).join('') + '</w:numbering>';
  const ps = (id, name, extra, rpr, based = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:next w:val="Normal"/><w:qFormat/>${extra ? '<w:pPr>' + extra + '</w:pPr>' : ''}${rpr ? '<w:rPr>' + rpr + '</w:rPr>' : ''}</w:style>`;
  const stylesXml = `${HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    ps('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="1F2A55"/><w:sz w:val="40"/><w:szCs w:val="40"/>') +
    ps('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="2B3A7A"/><w:sz w:val="32"/><w:szCs w:val="32"/>') +
    ps('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:color w:val="34448C"/><w:sz w:val="26"/><w:szCs w:val="26"/>') +
    ps('Heading4', 'heading 4', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="3"/>', '<w:b/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/>') +
    ps('Quote', 'Quote', '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="8B7BFF"/></w:pBdr><w:ind w:left="360"/>', '<w:i/><w:color w:val="555566"/>') +
    ps('Code', 'Code', '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/>') +
    ps('ListParagraph', 'List Paragraph', '<w:ind w:left="720"/><w:contextualSpacing/>', '') +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style></w:styles>';
  const docRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>`;
  const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Nebulix Docs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const pkgRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const f = (path, data) => ({ path, file: new Blob([data]) });
  return zipFiles([f('[Content_Types].xml', types), f('_rels/.rels', pkgRels), f('docProps/core.xml', core), f('word/document.xml', documentXml), f('word/styles.xml', stylesXml), f('word/numbering.xml', numberingXml), f('word/_rels/document.xml.rels', docRels), ...media.map((m) => f(m.path, m.bytes))]);
}

// Load every image of the document once and re-encode it as PNG (Word reads PNG everywhere); images that cannot be
// read (other sites without CORS) are left out and replaced by their alt text.
export async function prepareImages(root) {
  const out = new Map();
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src'); if (!src || out.has(src)) continue;
    try {
      const im = new Image(); im.crossOrigin = 'anonymous'; im.src = src; await im.decode();
      const w = im.naturalWidth; const hh = im.naturalHeight; if (!w || !hh) continue;
      const scale = Math.min(1, 2000 / Math.max(w, hh)); const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(hh * scale);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png')); if (!blob) continue;
      const shown = img.width && img.height ? [img.width, img.height] : [w, hh];
      out.set(src, { bytes: new Uint8Array(await blob.arrayBuffer()), w: shown[0], h: shown[1] });
    } catch { /* skip this image */ }
  }
  return out;
}
