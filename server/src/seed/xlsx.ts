import zlib from 'node:zlib';

/** Minimal .xlsx reader (no dependencies): unzip with zlib and return every sheet as rows of strings. */
export interface Sheet {
  name: string;
  rows: string[][];
}

const unxml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unxml(m[1] as string) : null;
};
const texts = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unxml(m[1] ?? '')).join('');

function unzip(buf: Buffer): Record<string, () => string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This does not look like an Excel .xlsx file.');
  const files: Record<string, () => string> = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
      const data = buf.subarray(start, start + size);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
    };
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

export function readWorkbook(buf: Buffer): Sheet[] {
  const z = unzip(buf);
  const read = (n: string): string | null => (z[n] ? (z[n] as () => string)() : null);
  const wb = read('xl/workbook.xml');
  if (!wb) throw new Error('Could not find the sheets in this workbook.');
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const relTarget: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relTarget[attr(m[0], 'Id') ?? ''] = attr(m[0], 'Target') ?? '';
  const ss = read('xl/sharedStrings.xml');
  const shared = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1] ?? '')) : [];
  // which cell styles are dates (so 45200 becomes 2023-09-30)
  const dateXf = new Set<number>();
  const st = read('xl/styles.xml');
  if (st) {
    const custom: Record<string, string> = {};
    for (const m of st.matchAll(/<numFmt\b[^>]*>/g)) custom[attr(m[0], 'numFmtId') ?? ''] = attr(m[0], 'formatCode') ?? '';
    const xfs = (st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) ?? [])[1] ?? '';
    [...xfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => {
      const id = Number(attr(m[0], 'numFmtId'));
      const fmt = custom[String(id)];
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (fmt && /[dy]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g, '')))) dateXf.add(i);
    });
  }
  const colIdx = (ref: string): number => {
    let n = 0;
    for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  const serialDate = (v: string): string => {
    const d = new Date(Math.round((Number(v) - 25569) * 86_400_000));
    return Number.isNaN(d.getTime()) ? v : d.toISOString().slice(0, 10);
  };
  const out: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? 'Sheet';
    const target = (relTarget[attr(m[0], 'r:id') ?? ''] ?? '').replace(/^\/?(xl\/)?/, '');
    const xml = target ? read(`xl/${target}`) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const cells: string[] = [];
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const body = c[2] ?? '';
        const t = attr(tag, 't');
        const v = unxml((body.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1] ?? '');
        let val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? texts(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        if (!t && v !== '' && dateXf.has(Number(attr(tag, 's')))) val = serialDate(v);
        else if (!t && /^-?\d+\.\d{6,}$/.test(val)) val = String(Math.round(Number(val) * 100) / 100);
        cells[colIdx(attr(tag, 'r') ?? '')] = val;
      }
      rows.push(Array.from(cells, (x) => (x ?? '').trim()));
    }
    out.push({ name, rows });
  }
  if (!out.length) throw new Error('Could not read the sheets in this workbook.');
  return out;
}
