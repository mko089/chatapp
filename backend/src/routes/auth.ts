import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { collectAuthDiagnostics } from '../rbac/guards.js';

export async function registerAuthRoutes(app: FastifyInstance<any>) {
  app.get('/auth/profile', async (request, reply) => {
    if (!request.auth) {
      reply.status(401);
      return { error: 'Unauthorized' };
    }

    const diagnostics = collectAuthDiagnostics(request.auth);

    return {
      user: {
        sub: request.auth.sub,
        email: request.auth.email ?? null,
        name: request.auth.name ?? null,
        username: request.auth.username ?? null,
        accountId: request.auth.accountId ?? null,
        roles: request.auth.roles ?? [],
        issuedAt: request.auth.issuedAt?.toISOString() ?? null,
        expiresAt: request.auth.expiresAt?.toISOString() ?? null,
      },
      diagnostics,
      config: {
        rbac: {
          ownerUsers: config.rbac.ownerUsers ?? [],
          adminUsers: config.rbac.adminUsers ?? [],
          defaultRoles: config.rbac.defaultRoles,
          fallbackRoles: config.rbac.fallbackRoles ?? [],
        },
        auth: {
          issuer: config.auth.issuer ?? null,
          audience: config.auth.audience ?? null,
          optionalAuthPaths: config.auth.optionalAuthPaths,
          publicPaths: config.auth.publicPaths,
        },
      },
    };
  });
}
