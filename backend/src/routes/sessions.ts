import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSession, listSessions, saveSession } from '../storage/sessionStore.js';

const SessionParamsSchema = z.object({
  id: z.string().min(1),
});

const SessionListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function registerSessionRoutes(app: FastifyInstance<any>) {
  app.get('/sessions', async (request, reply) => {
    const parsed = SessionListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query', details: parsed.error.issues };
    }

    const sessions = await listSessions({ limit: parsed.data.limit });
    return { sessions };
  });

  app.get('/sessions/:id', async (request, reply) => {
    const parsed = SessionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid session id', details: parsed.error.issues };
    }

    const id = parsed.data.id;
    const session = await loadSession(id);
    if (!session) {
      const now = new Date().toISOString();
      const stub = { id, messages: [], toolResults: [], createdAt: now, updatedAt: now };
      try {
        await saveSession(stub);
      } catch {}
      return stub;
    }

    return session;
  });
}
