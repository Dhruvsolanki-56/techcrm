import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Row } from '../db/connection';

/** The columns that matter most per list, in reading order (used for the PDF; the Excel file carries every column). */
const MAIN: Record<string, string[]> = {
  leads: ['ref', 'company', 'name', 'phone', 'email', 'department', 'source', 'owner_name', 'priority', 'stage', 'next_followup', 'value'],
  clients: ['ref', 'company', 'status', 'contact_name', 'contact_phone', 'project_count', 'lifetime_received', 'outstanding'],
  projects: ['ref', 'name', 'client_name', 'status', 'deadline', 'budget', 'cr_value', 'total_billed', 'total_received'],
  invoices: ['number', 'client_name', 'project_name', 'status', 'issue_date', 'due_date', 'total', 'paid_amount', 'balance'],
  quotes: ['number', 'client_name', 'lead_name', 'status', 'issue_date', 'valid_until', 'total'],
  payments: ['ref', 'date', 'client_name', 'invoice_number', 'category', 'method', 'amount', 'tds'],
  expenses: ['ref', 'date', 'vendor', 'description', 'category', 'status', 'amount', 'grant_name', 'project_name'],
  renewals: ['ref', 'name', 'kind', 'scope', 'cycle', 'renewal_date', 'our_cost', 'client_price', 'status'],
  tasks: ['ref', 'title', 'project_name', 'status', 'priority', 'assignee_name', 'due_date'],
  change_requests: ['ref', 'title', 'project_name', 'phase', 'status', 'requested_on', 'estimate_amount', 'billing_status'],
  milestones: ['ref', 'title', 'project_name', 'state', 'due_date', 'amount', 'invoice_number'],
  grants: ['ref', 'name', 'funder', 'status', 'requested', 'received', 'used'],
  documents: ['ref', 'title', 'category', 'entity_name', 'created_at'],
  maintenance_logs: ['ref', 'title', 'project_name', 'status', 'priority', 'reported_on', 'hours'],
};
const HIDE = new Set(['id', 'password_hash', 'created_by', 'updated_at', 'stored_name', 'totp_secret', 'import_key', 'sort_order']);

const ACRONYMS = new Set(['tds', 'gstin', 'gst', 'pan', 'url', 'hsn', 'sac', 'ifsc', 'upi']);
export const prettyHeader = (k: string): string => {
  const s = k.split('_').map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w)).join(' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Every readable column of a row set: no raw ids, no JSON blobs. */
export function allColumns(rows: Row[]): string[] {
  const first = rows[0];
  if (!first) return [];
  const keys = Object.keys(first).filter((k) => !HIDE.has(k) && !/_id$/.test(k) && !(k === 'number' && first.number === first.ref) && (first[k] === null || typeof first[k] !== 'object'));
  return keys.includes('ref') ? ['ref', ...keys.filter((k) => k !== 'ref')] : keys;
}
export function pdfColumns(table: string, rows: Row[]): string[] {
  const all = allColumns(rows);
  const main = (MAIN[table] ?? []).filter((c) => all.includes(c));
  return main.length ? main : all.slice(0, 9);
}

const MONEY = /(amount|total|value|budget|cost|price|received|outstanding|billed|expenses|balance|paid|tds|requested|used|estimate|withdrawal|deposit|subtotal|discount)/i;
const isMoneyCol = (k: string): boolean => MONEY.test(k) && !/(date|count|status|method|name|number|_on|_by)/i.test(k);

export async function toXlsx(title: string, rows: Row[], note?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TechSentinals CRM';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31) || 'Export', { views: [{ state: 'frozen', ySplit: note ? 3 : 1 }] });
  const cols = allColumns(rows);
  if (note) {
    ws.addRow([note]);
    ws.addRow([]);
  }
  const head = ws.addRow(cols.map(prettyHeader));
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F0EC' } };
  for (const r of rows) {
    ws.addRow(cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      return typeof v === 'number' || typeof v === 'string' ? v : String(v);
    }));
  }
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(48, Math.max(10, prettyHeader(c).length + 2, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2)));
    if (isMoneyCol(c)) col.numFmt = '#,##0.00';
  });
  if (rows.length) ws.autoFilter = { from: { row: note ? 3 : 1, column: 1 }, to: { row: note ? 3 : 1, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const fmtCell = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && isMoneyCol(k)) return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(v);
};

export function toPdf(title: string, table: string, rows: Row[], note?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, info: { Title: title, Producer: 'TechSentinals CRM' }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const cols = pdfColumns(table, rows);
    const W = doc.page.width - 56;
    // wider columns for text, narrower for numbers and dates
    const weight = (c: string): number => (isMoneyCol(c) ? 0.9 : /(date|_on|ref|number|status|priority|stage)/i.test(c) ? 0.9 : /(description|title|name|company|vendor|requirement|notes)/i.test(c) ? 1.8 : 1.2);
    const total = cols.reduce((s, c) => s + weight(c), 0) || 1;
    const widths = cols.map((c) => (W * weight(c)) / total);
    const drawHeader = (): void => {
      let x = 28;
      const y = doc.y;
      doc.rect(28, y - 3, W, 18).fill('#f1f0ec').fillColor('#1c1b18');
      doc.font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => { doc.text(prettyHeader(c), x + 3, y + 1, { width: (widths[i] as number) - 6, height: 12, ellipsis: true, lineBreak: false }); x += widths[i] as number; });
      doc.y = y + 18;
    };
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1c1b18').text(title);
    doc.font('Helvetica').fontSize(8).fillColor('#66645d').text(`${note ? `${note} · ` : ''}${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${new Date().toLocaleString('en-IN')} · amounts in INR`);
    doc.moveDown(0.8);
    drawHeader();
    doc.font('Helvetica').fontSize(7.5).fillColor('#1c1b18');
    for (const r of rows) {
      const heights = cols.map((c, i) => doc.heightOfString(fmtCell(c, r[c]), { width: (widths[i] as number) - 6 }));
      const h = Math.min(60, Math.max(13, ...heights)) + 4;
      if (doc.y + h > doc.page.height - 36) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(7.5).fillColor('#1c1b18'); }
      const y = doc.y;
      let x = 28;
      cols.forEach((c, i) => {
        const right = isMoneyCol(c) && typeof r[c] === 'number';
        doc.text(fmtCell(c, r[c]), x + 3, y + 2, { width: (widths[i] as number) - 6, height: h - 4, ellipsis: true, align: right ? 'right' : 'left' });
        x += widths[i] as number;
      });
      doc.moveTo(28, y + h - 1).lineTo(28 + W, y + h - 1).lineWidth(0.3).strokeColor('#dedcd5').stroke();
      doc.y = y + h;
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#75736c').text(`Page ${i + 1} of ${range.count}`, 28, doc.page.height - 22, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
