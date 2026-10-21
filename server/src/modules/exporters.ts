import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { dmy, dmyTime } from '@crm/shared';
import type { Row } from '../db/connection';

/* ============================== branding ============================== */
export interface ExportBrand { company: string; logo?: string; by?: string }
let brandOf: () => ExportBrand = () => ({ company: 'TechSentinals CRM' });
/** The app tells the exporters who the company is (name, logo) once at start-up, so every sheet and PDF carries the same header. */
export const setExportBrand = (fn: () => ExportBrand): void => { brandOf = fn; };

/* ============================== columns ============================== */
/** The columns that matter most per list, in reading order. The PDF shows only these; the Excel file leads with them and then carries every other readable column. */
const MAIN: Record<string, string[]> = {
  leads: ['ref', 'company', 'name', 'phone', 'email', 'department', 'source', 'owner_name', 'priority', 'stage', 'next_followup', 'value'],
  clients: ['ref', 'company', 'status', 'contact_name', 'contact_phone', 'project_count', 'lifetime_received', 'to_get'],
  projects: ['ref', 'name', 'client_name', 'status', 'deadline', 'budget', 'cr_value', 'total_billed', 'total_received', 'to_get'],
  invoices: ['ref', 'client_name', 'project_name', 'status', 'issue_date', 'due_date', 'total', 'paid_amount', 'balance'],
  quotes: ['ref', 'client_name', 'lead_name', 'status', 'issue_date', 'valid_until', 'total'],
  payments: ['ref', 'date', 'client_name', 'invoice_number', 'category', 'method', 'amount', 'tds'],
  expenses: ['ref', 'date', 'vendor', 'description', 'category', 'status', 'amount', 'grant_name', 'project_name'],
  renewals: ['ref', 'name', 'kind', 'scope', 'cycle', 'renewal_date', 'our_cost', 'client_price', 'status'],
  tasks: ['ref', 'title', 'project_name', 'status', 'priority', 'assignee_name', 'due_date'],
  change_requests: ['ref', 'title', 'project_name', 'phase', 'status', 'requested_on', 'estimate_amount', 'billing_status'],
  milestones: ['ref', 'title', 'project_name', 'state', 'due_date', 'amount', 'invoice_number'],
  grants: ['ref', 'name', 'funder', 'status', 'requested', 'received', 'used'],
  documents: ['ref', 'title', 'category', 'entity_name', 'created_at'],
  maintenance_logs: ['ref', 'title', 'project_name', 'status', 'priority', 'reported_on', 'hours'],
  tds: ['date', 'financial_year', 'client', 'invoice', 'received_in_bank', 'tds_deducted', 'gross_billed', 'deduction_rate', 'status'],
};
const HIDE = new Set(['id', 'password_hash', 'created_by', 'updated_at', 'stored_name', 'totp_secret', 'import_key', 'sort_order', 'position']);

const WORDS: Record<string, string> = {
  ref: 'ID', tds: 'TDS', pan: 'PAN', url: 'URL', ifsc: 'IFSC', upi: 'UPI', ip: 'IP', cr: 'CR', amc: 'AMC', fy: 'FY', ay: 'AY',
};
const LABELS: Record<string, string> = {
  client_name: 'Client', project_name: 'Project', owner_name: 'Owner', assignee_name: 'Assigned to', invoice_number: 'Invoice', quote_number: 'Quotation', account_name: 'Account', grant_name: 'Grant',
  manager_name: 'Manager', user_name: 'Person', paid_by_name: 'Paid by', lead_name: 'Lead', entity_name: 'Linked to', renewal_name: 'Recurring item', change_request_title: 'Change request',
  next_followup: 'Next follow-up', last_contact: 'Last contact', created_at: 'Created', reported_on: 'Reported', requested_on: 'Requested', total_billed: 'Invoiced', total_received: 'Received',
  lifetime_received: 'Received to date', to_get: 'Still to get', cr_value: 'Change requests', paid_amount: 'Paid', tds_deducted: 'TDS deducted', received_in_bank: 'Received in bank', gross_billed: 'Cash + TDS',
  deduction_rate: 'TDS rate', financial_year: 'Financial year', pending_amount: 'Invoiced, unpaid', to_invoice: 'Not invoiced yet', tds_total: 'TDS deducted', tds_percent: 'TDS %', tds_status: 'TDS status',
  tds_section: 'TDS section', tds_claimed_on: 'TDS claimed on', method: 'Payment mode', detail: 'Details', at: 'When',
};
export const prettyHeader = (k: string): string => {
  if (LABELS[k]) return LABELS[k] as string;
  const base = k.endsWith('_name') && k !== 'name' ? k.slice(0, -5) : k;
  const s = base.split('_').filter(Boolean).map((w) => WORDS[w.toLowerCase()] ?? w).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Every readable column of a row set: no raw ids, no JSON blobs, the most useful ones first. */
export function allColumns(rows: Row[], table?: string): string[] {
  const first = rows[0];
  if (!first) return [];
  const keys = Object.keys(first).filter((k) => !HIDE.has(k) && !/_id$/.test(k) && !(k === 'number' && first.number === first.ref) && (first[k] === null || typeof first[k] !== 'object'));
  const lead = (MAIN[table ?? ''] ?? []).filter((k) => keys.includes(k));
  const ordered = [...lead, ...keys.filter((k) => !lead.includes(k))];
  return ordered.includes('ref') ? ['ref', ...ordered.filter((k) => k !== 'ref')] : ordered;
}
export function pdfColumns(table: string, rows: Row[]): string[] {
  const all = allColumns(rows, table);
  const main = (MAIN[table] ?? []).filter((c) => all.includes(c));
  return main.length ? main : all.slice(0, 9);
}

/* ============================== value kinds ============================== */
const MONEY = /(amount|total|value|budget|cost|price|received|outstanding|billed|expenses|balance|paid|tds|requested|used|estimate|withdrawal|deposit|subtotal|discount|to_get|to_invoice|invoiced|unpaid)/i;
const NOT_MONEY = /(date|count|status|method|name|number|_on$|_by$|percent|rate|section|financial_year|cycle|kind)/i;
const isMoneyCol = (k: string): boolean => MONEY.test(k) && !NOT_MONEY.test(k);
const isPercentCol = (k: string): boolean => /(percent|_rate$|^rate$)/i.test(k);
const isFlagCol = (k: string): boolean => /^(is_|auto_|billable|active|amount_varies|advance_required|two_factor)/.test(k);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const utc = (s: string): Date => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0)));
const INR_FMT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
/** A database stamp (UTC) as the wall-clock time here, which is what Excel will show for it. */
const localWall = (s: string): Date => { const d = new Date(`${s.replace(' ', 'T')}${s.length <= 16 ? ':00' : ''}Z`); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())); };
const stamp = (): string => dmyTime(new Date().toISOString());

/* ============================== Excel ============================== */
export async function toXlsx(title: string, rows: Row[], note?: string, table?: string, by?: string): Promise<Buffer> {
  const brand = { ...brandOf(), ...(by ? { by } : {}) };
  const wb = new ExcelJS.Workbook();
  wb.creator = brand.company;
  wb.created = new Date();
  wb.title = title;
  const cols = allColumns(rows, table);
  const ncol = Math.max(cols.length, 4);
  const ws = wb.addWorksheet(title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `&L${brand.company.replace(/&/g, '&&')} — confidential&RPage &P of &N` },
  });
  const banner = (r: number, v: string, font: Partial<ExcelJS.Font>, h: number): void => {
    ws.mergeCells(r, 1, r, ncol);
    const c = ws.getCell(r, 1);
    c.value = v;
    c.font = { name: 'Calibri', ...font };
    c.alignment = { vertical: 'middle' };
    ws.getRow(r).height = h;
  };
  banner(1, brand.company, { size: 15, bold: true, color: { argb: 'FF1C1B18' } }, 24);
  banner(2, title, { size: 12, bold: true, color: { argb: 'FF3A3935' } }, 18);
  banner(3, `${note ? `${note} · ` : ''}${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${stamp()}${brand.by ? ` by ${brand.by}` : ''} · amounts in INR`, { size: 9, color: { argb: 'FF75736C' } }, 15);
  const HEAD = 5;
  const head = ws.getRow(HEAD);
  cols.forEach((c, i) => { head.getCell(i + 1).value = prettyHeader(c); });
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1B18' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  const kinds = cols.map((c) => (isMoneyCol(c) ? 'money' : isPercentCol(c) ? 'percent' : 'text'));
  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    cols.forEach((c, i) => {
      const v = r[c];
      let out: ExcelJS.CellValue = '';
      if (v === null || v === undefined || v === '') out = '';
      else if (isFlagCol(c) && (v === 0 || v === 1)) out = v ? 'Yes' : 'No';
      else if (typeof v === 'number') out = v;
      else if (typeof v === 'string' && (DATE.test(v) || STAMP.test(v))) out = DATE.test(v) ? utc(v) : localWall(v);
      else out = typeof v === 'string' ? v : String(v);
      const cell = row.getCell(i + 1);
      cell.value = out; // text stays text: a value that starts with "=" is never turned into a formula
      if (out instanceof Date) cell.numFmt = typeof v === 'string' && STAMP.test(v) ? 'dd mmm yyyy, hh:mm AM/PM' : 'dd mmm yyyy';
      else if (typeof out === 'number' && kinds[i] === 'money') cell.numFmt = INR_FMT;
      else if (typeof out === 'number' && kinds[i] === 'percent') cell.numFmt = '0.0"%"';
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = { vertical: 'top', horizontal: typeof out === 'number' ? 'right' : 'left', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDEDCD5' } } };
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F7F3' } };
    });
  });
  // totals of the money columns: real SUBTOTAL formulas, so the sheet stays right when someone filters it
  const first = HEAD + 1;
  const last = HEAD + rows.length;
  if (rows.length) {
    const tr = ws.getRow(last + 1);
    let any = false;
    cols.forEach((c, i) => {
      if (kinds[i] !== 'money' || !rows.some((r) => typeof r[c] === 'number')) return;
      const letter = ws.getColumn(i + 1).letter;
      const result = rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0);
      const cell = tr.getCell(i + 1);
      cell.value = { formula: `SUBTOTAL(109,${letter}${first}:${letter}${last})`, result: Math.round(result * 100) / 100 };
      cell.numFmt = INR_FMT;
      any = true;
    });
    if (any) {
      tr.getCell(1).value = 'Total (rows shown)';
      for (let n = 1; n <= cols.length; n++) {
        const cell = tr.getCell(n);
        cell.font = { name: 'Calibri', bold: true, size: 10 };
        cell.border = { top: { style: 'thin', color: { argb: 'FF1C1B18' } } };
        cell.alignment = { vertical: 'middle', horizontal: kinds[n - 1] === 'money' ? 'right' : 'left' };
      }
    }
  }
  cols.forEach((c, i) => {
    const sample = rows.slice(0, 300).map((r) => (r[c] === null || r[c] === undefined ? 0 : String(r[c]).length));
    ws.getColumn(i + 1).width = Math.min(isMoneyCol(c) ? 18 : 46, Math.max(prettyHeader(c).length + 3, ...sample.map((n) => n + 2), 9));
  });
  ws.views = [{ state: 'frozen', ySplit: HEAD, xSplit: cols[0] === 'ref' ? 1 : 0, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${HEAD}:${HEAD}`;
  if (rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ============================== PDF ============================== */
const fmtCell = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (isFlagCol(k) && (v === 0 || v === 1)) return v ? 'Yes' : 'No';
  if (typeof v === 'number' && isMoneyCol(k)) return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof v === 'number' && isPercentCol(k)) return `${v}%`;
  const s = String(v);
  if (DATE.test(s)) return dmy(s);
  if (STAMP.test(s)) return dmyTime(s);
  const t = s.replace(/_/g, ' ');
  return /(status|stage|priority|kind|scope|cycle|phase|state)$/.test(k) ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

export function toPdf(title: string, table: string, rows: Row[], note?: string, by?: string): Promise<Buffer> {
  const brand = { ...brandOf(), ...(by ? { by } : {}) };
  return new Promise((resolve, reject) => {
    const M = 30;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, info: { Title: `${brand.company} — ${title}`, Producer: brand.company, Author: brand.by ?? brand.company }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const cols = pdfColumns(table, rows);
    const W = doc.page.width - M * 2;
    const weight = (c: string): number => (isMoneyCol(c) ? 1 : /(date|_on$|ref|number|status|priority|stage|financial_year|rate|percent)/i.test(c) ? 0.9 : /(description|title|name|company|vendor|requirement|detail|client|project|email)/i.test(c) ? 1.7 : 1.2);
    const total = cols.reduce((s, c) => s + weight(c), 0) || 1;
    const widths = cols.map((c) => (W * weight(c)) / total);
    const header = (firstPage: boolean): void => {
      let x = M;
      if (brand.logo && /^data:image\/(png|jpeg);base64,/.test(brand.logo)) {
        try { doc.image(Buffer.from(brand.logo.split(',')[1] as string, 'base64'), M, M - 2, { fit: [90, 26] }); x = M + 100; } catch { x = M; }
      }
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1c1b18').text(brand.company, x, M, { width: W / 2, lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('#75736c').text(`Generated ${stamp()}${brand.by ? ` · ${brand.by}` : ''}`, M, M + 2, { width: W, align: 'right', lineBreak: false });
      doc.moveTo(M, M + 30).lineTo(M + W, M + 30).lineWidth(1.2).strokeColor('#1c1b18').stroke();
      doc.y = M + 38;
      if (firstPage) {
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#1c1b18').text(title, M, doc.y, { width: W });
        doc.font('Helvetica').fontSize(8.5).fillColor('#75736c').text(`${note ? `${note} · ` : ''}${rows.length} row${rows.length === 1 ? '' : 's'} · amounts in INR`, M, doc.y + 1, { width: W });
        doc.moveDown(0.7);
      }
    };
    const tableHead = (): void => {
      const y = doc.y;
      let x = M;
      doc.rect(M, y, W, 20).fill('#1c1b18');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      cols.forEach((c, i) => {
        doc.text(prettyHeader(c), x + 4, y + 6, { width: (widths[i] as number) - 8, height: 12, ellipsis: true, lineBreak: false, align: isMoneyCol(c) ? 'right' : 'left' });
        x += widths[i] as number;
      });
      doc.y = y + 20;
      doc.fillColor('#1c1b18');
    };
    const bottom = doc.page.height - 44;
    header(true);
    tableHead();
    rows.forEach((r, ri) => {
      doc.font('Helvetica').fontSize(8);
      const heights = cols.map((c, i) => doc.heightOfString(fmtCell(c, r[c]), { width: (widths[i] as number) - 8 }));
      const h = Math.min(54, Math.max(14, ...heights)) + 6;
      if (doc.y + h > bottom) { doc.addPage(); header(false); tableHead(); }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(M, y, W, h).fill('#f6f5f1');
      doc.fillColor('#1c1b18').font('Helvetica').fontSize(8);
      let x = M;
      cols.forEach((c, i) => {
        doc.text(fmtCell(c, r[c]), x + 4, y + 3, { width: (widths[i] as number) - 8, height: h - 4, ellipsis: true, align: isMoneyCol(c) && typeof r[c] === 'number' ? 'right' : 'left' });
        x += widths[i] as number;
      });
      doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.3).strokeColor('#dedcd5').stroke();
      doc.y = y + h;
    });
    const moneyIdx = cols.map((c, i) => (isMoneyCol(c) && rows.some((r) => typeof r[c] === 'number') ? i : -1)).filter((i) => i >= 0);
    if (rows.length && moneyIdx.length) {
      if (doc.y + 22 > bottom) { doc.addPage(); header(false); }
      const y = doc.y;
      doc.rect(M, y, W, 20).fill('#ecebe5');
      doc.fillColor('#1c1b18').font('Helvetica-Bold').fontSize(8).text('Total', M + 4, y + 6, { lineBreak: false });
      let x = M;
      cols.forEach((c, i) => {
        if (moneyIdx.includes(i)) {
          const sum = rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0);
          doc.text(fmtCell(c, Math.round(sum * 100) / 100), x + 4, y + 6, { width: (widths[i] as number) - 8, align: 'right', lineBreak: false });
        }
        x += widths[i] as number;
      });
      doc.y = y + 20;
    }
    if (!rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#75736c').text('Nothing matches these filters.', M, doc.y + 12);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // the footer sits inside the bottom margin; without this pdfkit would add a page for it
      doc.moveTo(M, doc.page.height - 30).lineTo(M + W, doc.page.height - 30).lineWidth(0.4).strokeColor('#dedcd5').stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#75736c')
        .text(`${brand.company} — confidential, for internal use`, M, doc.page.height - 24, { width: W / 2, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, M, doc.page.height - 24, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
