import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSession } from '../storage/sessionStore.js';

const SessionParamsSchema = z.object({
  id: z.string().min(1),
});

export async function registerSessionRoutes(app: FastifyInstance<any>) {
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
