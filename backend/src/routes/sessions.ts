import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSession, listSessions } from '../storage/sessionStore.js';

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

    const session = await loadSession(parsed.data.id);
    if (!session) {
      reply.status(404);
      return { error: 'Session not found' };
    }

    return session;
  });
}
