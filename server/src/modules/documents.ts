import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { validDate } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Engine } from '../crud/engine';
import { forbidden, HttpError, need, notFound } from '../shared/errors';
import { intOrNull, str } from '../http/validate';
import { isFounder, type User } from '../security/permissions';

const DOC_ENTITIES: Record<string, string> = { client: 'clients', lead: 'leads', project: 'projects', task: 'tasks', invoice: 'invoices', quote: 'quotes', change_request: 'change_requests' };
const INLINE_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

/** Files (stored under random names, always served as downloads) and links to documents kept elsewhere. */
export function documentRoutes(ctx: AppContext, engine: Engine): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const upload = multer({
    storage: multer.diskStorage({ destination: ctx.config.uploadDir, filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')) }),
    limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  });
  const user = (req: Request): User => req.user as User;

  /** Who may attach a document (file or link) to what. */
  function target(req: Request): { type: string; eid: number | null; expiry: string | null } {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const type = String(b.entity_type || 'general');
    const eid = intOrNull(b.entity_id);
    if (type === 'general' || type === 'expense') {
      if (!isFounder(user(req))) throw forbidden();
    } else {
      need(Object.hasOwn(DOC_ENTITIES, type) && eid, 'Unknown attachment target.');
      if (!engine.scoped(DOC_ENTITIES[type] as string, eid as number, user(req))) throw forbidden();
      if (!isFounder(user(req)) && !['project', 'task'].includes(type)) throw forbidden();
    }
    const expiry = str(b.expiry_date, 10);
    need(!expiry || validDate(expiry), 'Expiry date must be a real date.');
    return { type, eid, expiry };
  }

  // a document that lives somewhere else (Google Drive, Dropbox …): saved as a link, no upload
  router.post('/documents/link', (req: Request, res: Response) => {
    const { type, eid, expiry } = target(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    let url = str(b.url, 1000);
    need(url, 'Paste the link to the document.');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    need(/^https?:\/\/[^\s<>"]+\.[^\s<>"]+$/i.test(url), 'That link does not look like a web address.');
    const title = str(b.title);
    need(title, 'Give the document a name.');
    const id = Number(db.prepare("INSERT INTO documents(title,category,entity_type,entity_id,filename,stored_name,mime,size,notes,uploaded_by,url,expiry_date) VALUES(?,?,?,?,'','','text/uri-list',0,?,?,?,?)")
      .run(title, str(b.category, 60) || 'Other', type, eid, str(b.notes, 2000), user(req).id, url, expiry).lastInsertRowid);
    ctx.audit(user(req), 'upload', 'documents', id, `Link: ${title} → ${type}${eid ? ` #${eid}` : ''}`, req.ip);
    res.status(201).json({ id });
  });

  router.post('/documents/upload', upload.single('file'), (req: Request, res: Response) => {
    const f = req.file;
    const cleanup = (): void => {
      if (f) try { fs.unlinkSync(f.path); } catch { /* ok */ }
    };
    try {
      need(f, 'Choose a file to upload.');
      const { type, eid, expiry } = target(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      // eslint-disable-next-line no-control-regex
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
      const title = str(b.title) || original;
      const id = Number(db.prepare('INSERT INTO documents(title,category,entity_type,entity_id,filename,stored_name,mime,size,notes,uploaded_by,expiry_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(title, str(b.category, 60) || 'Other', type, eid, original, f.filename, f.mimetype, f.size, str(b.notes, 2000), user(req).id, expiry).lastInsertRowid);
      ctx.audit(user(req), 'upload', 'documents', id, `${title} → ${type}${eid ? ` #${eid}` : ''}`, req.ip);
      res.status(201).json({ id });
    } catch (e) {
      cleanup();
      throw e;
    }
  });

  router.get('/files/:id', (req: Request, res: Response) => {
    const hit = engine.scoped('documents', String(req.params.id), user(req));
    if (!hit) throw new HttpError(404, 'File not found (or you do not have access).');
    const d = hit.row;
    if (!d.stored_name) throw new HttpError(404, 'This document is a link, not an uploaded file.');
    const file = path.join(ctx.config.uploadDir, d.stored_name);
    if (!fs.existsSync(file)) throw new HttpError(410, 'The file is missing from disk.');
    const inline = req.query.inline === '1' && INLINE_OK.has(d.mime);
    res.setHeader('Content-Type', inline ? d.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.filename)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    ctx.audit(user(req), 'download', 'documents', d.id, d.title, req.ip);
    fs.createReadStream(file).pipe(res);
  });
  void notFound;
  return router;
}
