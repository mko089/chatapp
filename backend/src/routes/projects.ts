import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProject, getTree, listProjects, readDoc, upsertDoc } from '../projects/fs.js';
import { normalizeRoleName, resolveEffectivePermissions } from '../rbac/index.js';
import { sendError } from '../utils/errors.js';
import { findIdempotencyRecord, saveIdempotencyRecord } from '../db/idempotencyRepository.js';
import { createHash } from 'node:crypto';
import { stableStringify } from '../services/chat/tools.js';

const CreateProjectSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  name: z.string().min(1),
});

const UpsertDocSchema = z.object({
  path: z.string().min(1),
  html: z.string().default(''),
});

export async function registerProjectRoutes(app: FastifyInstance<any>) {
  app.get('/projects', async (request, reply) => {
    const ListQuery = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      cursor: z.string().optional(),
    });
    const parsed = ListQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'projects.invalid_query', 'Invalid query parameters', parsed.error.issues);
    }
    const { limit, cursor } = parsed.data;

    function decodeCursor(value?: string): { updatedAt: string; id: string } | null {
      if (!value || value.trim().length === 0) return null;
      try {
        const raw = Buffer.from(value, 'base64').toString('utf-8');
        const obj = JSON.parse(raw);
        if (obj && typeof obj.updatedAt === 'string' && typeof obj.id === 'string') {
          return { updatedAt: obj.updatedAt, id: obj.id };
        }
      } catch {}
      return null;
    }
    function encodeCursor(item: { updatedAt: string; id: string }): string {
      const raw = JSON.stringify({ updatedAt: item.updatedAt, id: item.id });
      return Buffer.from(raw).toString('base64');
    }

    const all = await listProjects(); // already sorted desc by updatedAt
    let startIndex = 0;
    const cur = decodeCursor(cursor);
    if (cur) {
      const idx = all.findIndex((p) => p.updatedAt === cur.updatedAt && p.id === cur.id);
      if (idx >= 0) startIndex = idx + 1;
    }
    const items = all.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < all.length;
    const next = hasNext ? encodeCursor(items[items.length - 1]) : null;

    // Backward compatible: return `projects` plus `page`
    return { projects: items, page: { next, hasNext } } as const;
  });

  app.post('/projects', async (request, reply) => {
    const idk = (request.headers['idempotency-key'] as string | undefined)?.trim();
    const accountId = ((request as any).auth?.accountId as string | undefined) ?? '';
    const scope = 'projects:create';
    const rawBody = (request.body ?? {}) as any;
    const bodyString = stableStringify(rawBody);
    const bodyHash = createHash('sha256').update(bodyString).digest('hex');

    if (idk) {
      const existing = findIdempotencyRecord(idk, accountId, scope);
      if (existing) {
        reply.header('Idempotency-Key', idk);
        reply.header('Idempotent-Replay', 'true');
        if (existing.bodyHash !== bodyHash) {
          return sendError(reply, 409, 'idempotency_conflict', 'Idempotency-Key already used with a different payload');
        }
        try {
          reply.status(existing.status);
          return JSON.parse(existing.responseJson);
        } catch {
          reply.status(existing.status);
          return { ok: true } as any;
        }
      }
    }
    // lean-auth: mutacje tylko dla admin/owner
    const roles = (request as any).auth?.roles ?? [];
    const normalized = roles.map((r: string) => normalizeRoleName(r));
    const hasTokenAdmin = normalized.some((r: string) => r === 'admin' || r === 'owner');
    if (!hasTokenAdmin) {
      const effective = resolveEffectivePermissions((request as any).auth);
      const hasEffectiveAdmin = effective.appliedRoles.some((r) => r === 'admin' || r === 'owner');
      if (!hasEffectiveAdmin) {
        return sendError(reply, 403, 'forbidden', 'Insufficient permissions');
      }
    }
    const parsed = CreateProjectSchema.safeParse(rawBody);
    if (!parsed.success) {
      const payload = sendError(reply, 400, 'invalid_payload', 'Invalid payload', parsed.error.issues);
      if (idk) {
        try {
          saveIdempotencyRecord({ key: idk, accountId, scope, bodyHash, status: 400, responseJson: JSON.stringify(payload) });
          reply.header('Idempotency-Key', idk);
        } catch {}
      }
      return payload;
    }
    const id = parsed.data.id ?? parsed.data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const info = await ensureProject(id, parsed.data.name);
    const response = { project: info };
    if (idk) {
      try {
        saveIdempotencyRecord({ key: idk, accountId, scope, bodyHash, status: 200, responseJson: JSON.stringify(response) });
        reply.header('Idempotency-Key', idk);
      } catch {}
    }
    return response;
  });

  app.get('/projects/:id/tree', async (request, reply) => {
    const id = String((request.params as any)?.id ?? '');
    if (!id) {
      return sendError(reply, 400, 'invalid_id', 'Invalid id');
    }
    await ensureProject(id);
    const tree = await getTree(id);
    return { id, tree };
  });

  app.get('/projects/:id/doc/*', async (request, reply) => {
    const id = String((request.params as any)?.id ?? '');
    const wildcard = (request.params as any)['*'] as string | undefined;
    if (!id || !wildcard) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }
    const doc = await readDoc(id, wildcard);
    if (!doc) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    const lastModified = new Date(doc.updatedAt);
    const size = Buffer.byteLength(doc.html ?? '', 'utf-8');
    const etag = `W/"${size}-${lastModified.getTime()}"`;

    // Conditional requests support
    const inm = (request.headers['if-none-match'] as string | undefined)?.trim();
    const imsRaw = (request.headers['if-modified-since'] as string | undefined)?.trim();
    const ims = imsRaw ? new Date(imsRaw) : undefined;

    if (inm && inm === etag) {
      reply.code(304);
      return '';
    }
    if (ims && !isNaN(ims.getTime()) && lastModified <= ims) {
      reply.code(304);
      return '';
    }

    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('ETag', etag);
    reply.header('Last-Modified', lastModified.toUTCString());
    reply.header('Cache-Control', 'public, max-age=60');
    return doc.html;
  });

  app.put('/projects/:id/doc', async (request, reply) => {
    // lean-auth: mutacje tylko dla admin/owner
    const roles = (request as any).auth?.roles ?? [];
    const normalized = roles.map((r: string) => normalizeRoleName(r));
    const hasTokenAdmin = normalized.some((r: string) => r === 'admin' || r === 'owner');
    if (!hasTokenAdmin) {
      const effective = resolveEffectivePermissions((request as any).auth);
      const hasEffectiveAdmin = effective.appliedRoles.some((r) => r === 'admin' || r === 'owner');
      if (!hasEffectiveAdmin) {
        return sendError(reply, 403, 'forbidden', 'Insufficient permissions');
      }
    }
    const id = String((request.params as any)?.id ?? '');
    const parsed = UpsertDocSchema.safeParse(request.body ?? {});
    if (!id || !parsed.success) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request', parsed.success ? undefined : parsed.error.issues);
    }
    const res = await upsertDoc(id, parsed.data.path, parsed.data.html);
    return { id, ...res };
  });
}
