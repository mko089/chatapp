import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteSession, loadSession, listSessions, saveSession } from '../storage/sessionStore.js';
import { collectAuthDiagnostics, isSuperAdmin } from '../rbac/guards.js';

const SessionParamsSchema = z.object({
  id: z.string().min(1),
});

const SessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
  scope: z.enum(['all']).optional(),
  userId: z.string().min(1).optional(),
});

const UpdateContextSchema = z.object({
  projectId: z.string().min(1).optional().nullable(),
  currentDocPath: z.string().min(1).optional().nullable(),
});

export async function registerSessionRoutes(app: FastifyInstance<any>) {
  app.get('/sessions', async (request, reply) => {
    const parsed = SessionListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query', details: parsed.error.issues };
    }

    const isAdmin = isSuperAdmin(request.auth);
    const requestUserId = request.auth?.sub ?? null;

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

    if (!isAdmin) {
      const all = await listSessions({ userId: requestUserId, includeUnassigned: !requestUserId });
      const cur = decodeCursor(parsed.data.cursor);
      let startIndex = 0;
      if (cur) {
        const idx = all.findIndex((s) => s.updatedAt === cur.updatedAt && s.id === cur.id);
        if (idx >= 0) startIndex = idx + 1;
      }
      const limit = parsed.data.limit ?? 50;
      const items = all.slice(startIndex, startIndex + limit);
      const hasNext = startIndex + limit < all.length;
      const next = hasNext ? encodeCursor(items[items.length - 1]) : null;
      return { sessions: items, page: { next, hasNext } };
    }

    const requestedScope = parsed.data.scope;
    const requestedUserRaw = parsed.data.userId?.trim();
    let targetUserId: string | undefined;
    if (requestedScope === 'all') {
      targetUserId = undefined;
    } else if (requestedUserRaw && requestedUserRaw.length > 0) {
      targetUserId = requestedUserRaw;
    } else if (requestUserId) {
      targetUserId = requestUserId;
    }

    const all = await listSessions({
      userId: targetUserId ?? undefined,
      includeUnassigned: requestedScope === 'all' || !targetUserId,
    });
    const cur = decodeCursor(parsed.data.cursor);
    let startIndex = 0;
    if (cur) {
      const idx = all.findIndex((s) => s.updatedAt === cur.updatedAt && s.id === cur.id);
      if (idx >= 0) startIndex = idx + 1;
    }
    const limit = parsed.data.limit ?? 50;
    const items = all.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < all.length;
    const next = hasNext ? encodeCursor(items[items.length - 1]) : null;
    return { sessions: items, page: { next, hasNext } };
  });

  app.get('/sessions/:id', async (request, reply) => {
    const parsed = SessionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid session id', details: parsed.error.issues };
    }

    const id = parsed.data.id;
    const userId = request.auth?.sub ?? null;
    const accountId = request.auth?.accountId ?? null;
    const isAdmin = isSuperAdmin(request.auth);
    const session = await loadSession(id);
    if (!session) {
      const now = new Date().toISOString();
      const stub = {
        id,
        userId: isAdmin ? null : userId,
        accountId: isAdmin ? null : accountId,
        messages: [],
        toolResults: [],
        createdAt: now,
        updatedAt: now,
      };
      try {
        await saveSession(stub);
      } catch {}
      return stub;
    }

    if (!isAdmin && session.userId && session.userId !== userId) {
      request.log.warn(
        {
          event: 'session_access_denied',
          reason: 'owner_mismatch',
          sessionId: id,
          sessionOwner: session.userId,
          requester: request.auth ?? null,
          diagnostics: collectAuthDiagnostics(request.auth),
        },
        'Denied session access: requester is not allowed to view this session',
      );
      reply.status(404);
      return { error: 'Session not found' };
    }

    if (!isAdmin && !session.userId && userId) {
      const adopted = {
        ...session,
        userId,
        accountId: session.accountId ?? accountId ?? null,
      };
      try {
        await saveSession(adopted);
      } catch {}
      return adopted;
    }

    return session;
  });

  app.delete('/sessions/:id', async (request, reply) => {
    const parsed = SessionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid session id', details: parsed.error.issues };
    }

    const id = parsed.data.id;
    const isAdmin = isSuperAdmin(request.auth);
    const userId = request.auth?.sub ?? null;

    const session = await loadSession(id);
    if (!session) {
      reply.status(404);
      return { error: 'Session not found' };
    }

    if (!isAdmin) {
      if (session.userId && session.userId !== userId) {
        reply.status(404);
        return { error: 'Session not found' };
      }
    }

    const removed = await deleteSession(id);
    if (!removed) {
      reply.status(404);
      return { error: 'Session not found' };
    }

    return { ok: true };
  });

  app.post('/sessions/:id/context', async (request, reply) => {
    const parsedParams = SessionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      reply.status(400);
      return { error: 'Invalid session id', details: parsedParams.error.issues };
    }

    const parsedBody = UpdateContextSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      reply.status(400);
      return { error: 'Invalid payload', details: parsedBody.error.issues };
    }

    const id = parsedParams.data.id;
    const isAdmin = isSuperAdmin(request.auth);
    const userId = request.auth?.sub ?? null;
    const accountId = request.auth?.accountId ?? null;

    const session = await loadSession(id);
    if (session && !isAdmin && session.userId && session.userId !== userId) {
      reply.status(404);
      return { error: 'Session not found' };
    }

    const now = new Date().toISOString();
    const next = {
      id,
      userId: session?.userId ?? (isAdmin ? null : userId),
      accountId: session?.accountId ?? (isAdmin ? null : accountId),
      projectId: parsedBody.data.projectId ?? (session?.projectId ?? null),
      currentDocPath: parsedBody.data.currentDocPath ?? (session?.currentDocPath ?? null),
      messages: session?.messages ?? [],
      toolResults: session?.toolResults ?? [],
      createdAt: session?.createdAt ?? now,
      updatedAt: now,
    } as any;

    await saveSession(next);
    return next;
  });
}
