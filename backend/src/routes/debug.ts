import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { collectAuthDiagnostics, isSuperAdmin } from '../rbac/guards.js';
import { loadSession } from '../storage/sessionStore.js';

const SessionParamsSchema = z.object({
  id: z.string().min(1),
});

export async function registerDebugRoutes(app: FastifyInstance<any>) {
  app.get('/debug/auth', async (request, reply) => {
    const diagnostics = collectAuthDiagnostics(request.auth);

    if (!isSuperAdmin(request.auth)) {
      return reply.code(403).send({
        error: 'Forbidden',
        diagnostics,
      });
    }

    return {
      auth: request.auth ?? null,
      diagnostics,
      config: {
        allowedIps: config.allowedIps,
        rbac: {
          enabled: config.rbac.enabled,
          adminUsers: config.rbac.adminUsers,
          ownerUsers: config.rbac.ownerUsers,
          defaultRoles: config.rbac.defaultRoles,
          fallbackRoles: config.rbac.fallbackRoles ?? [],
          unauthenticatedMode: config.rbac.unauthenticatedMode,
        },
        auth: {
          enabled: config.auth.enabled,
          issuer: config.auth.issuer,
          audience: config.auth.audience,
          rolesPath: config.auth.rolesPath,
          accountClaim: config.auth.accountClaim,
          publicPaths: config.auth.publicPaths,
        },
      },
    };
  });

  app.get('/debug/sessions/:id', async (request, reply) => {
    const diagnostics = collectAuthDiagnostics(request.auth);
    if (!diagnostics.isSuperAdmin) {
      return reply.code(403).send({
        error: 'Forbidden',
        diagnostics,
      });
    }

    const parsed = SessionParamsSchema.safeParse(request.params ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid session id', details: parsed.error.issues });
    }

    const session = await loadSession(parsed.data.id);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found', diagnostics });
    }

    return {
      session,
      diagnostics,
    };
  });
}
