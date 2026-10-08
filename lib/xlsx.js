/* Minimal .xlsx reader for Node (no dependencies): unzip with zlib, read every sheet as rows of strings.
   Same output as the browser reader in public/js/import.js: [{ name, rows: [[cell, …], …] }]. */
'use strict';
const zlib = require('zlib');

const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unxml(m[1]) : null; };
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unxml(m[1] || '')).join('');

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This does not look like an Excel .xlsx file.');
  const files = {}; let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28); const data = buf.subarray(start, start + size);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    };
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

function readWorkbook(buf) {
  const z = unzip(buf); const read = (n) => (z[n] ? z[n]() : null);
  const wb = read('xl/workbook.xml'); if (!wb) throw new Error('Could not find the sheets in this workbook.');
  const rels = read('xl/_rels/workbook.xml.rels') || '';
  const relTarget = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relTarget[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const ss = read('xl/sharedStrings.xml');
  const shared = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  // which cell styles are dates (so 45200 becomes 2023-09-30), same rule as the browser reader
  const dateXf = new Set(); const st = read('xl/styles.xml');
  if (st) {
    const custom = {}; for (const m of st.matchAll(/<numFmt\b[^>]*>/g)) custom[attr(m[0], 'numFmtId')] = attr(m[0], 'formatCode') || '';
    const xfs = (st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    [...xfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => {
      const id = Number(attr(m[0], 'numFmtId'));
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] && /[dy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, '')))) dateXf.add(i);
    });
  }
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const serialDate = (v) => { const d = new Date(Math.round((Number(v) - 25569) * 86400000)); return isNaN(d) ? v : d.toISOString().slice(0, 10); };
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') || 'Sheet'; const target = (relTarget[attr(m[0], 'r:id')] || '').replace(/^\/?(xl\/)?/, '');
    const xml = target && read('xl/' + target); if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const cells = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = '<c' + c[1] + '>'; const body = c[2] || ''; const t = attr(tag, 't');
        const v = unxml((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
        let val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? texts(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        if (!t && v !== '' && dateXf.has(Number(attr(tag, 's')))) val = serialDate(v);
        else if (!t && /^-?\d+\.\d{6,}$/.test(val)) val = String(Math.round(Number(val) * 100) / 100);
        cells[colIdx(attr(tag, 'r') || '')] = val;
      }
      rows.push(Array.from(cells, (x) => x ?? ''));
    }
    out.push({ name, rows });
  }
  if (!out.length) throw new Error('Could not read the sheets in this workbook.');
  return out;
}

module.exports = { readWorkbook };
