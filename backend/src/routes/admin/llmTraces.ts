import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listLlmTraces } from '../../services/llmTraceLogger.js';
import { normalizeRoleName, resolveEffectivePermissions } from '../../rbac/index.js';
import { sendError } from '../../utils/errors.js';

const ADMIN_ROLES = new Set(['owner', 'admin']);

function ensureAdmin(request: any) {
  const roles = request.auth?.roles ?? [];
  const normalized = roles.map((role: string) => normalizeRoleName(role));
  const hasTokenAdmin = normalized.some((role: string) => ADMIN_ROLES.has(role));
  if (hasTokenAdmin) {
    return;
  }

  const effective = resolveEffectivePermissions(request.auth);
  const hasEffectiveAdmin = effective.appliedRoles.some((role) => ADMIN_ROLES.has(role));
  if (!hasEffectiveAdmin) {
    throw request.httpErrors.forbidden('Insufficient permissions to access LLM traces');
  }
}

const QuerySchema = z.object({
  sessionId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function registerAdminLlmTracesRoutes(app: FastifyInstance<any>) {
  app.get('/admin/llm-traces', async (request, reply) => {
    ensureAdmin(request);
    const parsed = QuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_query', 'Invalid query', parsed.error.issues);
    }
    const { sessionId, limit } = parsed.data;
    const items = listLlmTraces(sessionId, limit ?? 200);
    return { items };
  });
}
