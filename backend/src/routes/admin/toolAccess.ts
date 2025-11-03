import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPermissionsVersion } from '../../db/toolAccessRepository.js';
import { normalizeRoleName, resolveEffectivePermissions } from '../../rbac/index.js';
import {
  applyToolAccessChanges,
  getToolAccessMatrix,
  listToolAccessAuditEntries,
} from '../../services/toolPermissionService.js';
import { syncToolCatalogFromMcp } from '../../services/toolCatalogService.js';
import type { MCPManager } from '../../mcp/manager.js';
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
    throw request.httpErrors.forbidden('Insufficient permissions to manage tool access');
  }
}

const ChangeSchema = z.object({
  type: z.enum(['group', 'tool']),
  role: z.string().min(1),
  targetId: z.string().min(1),
  scope: z.enum(['global']).optional(),
  allowed: z.boolean().nullable(),
  reason: z.string().max(200).nullable().optional(),
});

const PatchPayloadSchema = z.object({
  changes: z.array(ChangeSchema).min(1),
  version: z.number().int().nonnegative().optional(),
});

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

type ToolAccessRouteDeps = {
  mcpManager: MCPManager;
};

export async function registerAdminToolAccessRoutes(app: FastifyInstance<any>, deps: ToolAccessRouteDeps) {
  const { mcpManager } = deps;

  app.get('/admin/tool-access', async (request) => {
    ensureAdmin(request);
    const matrix = getToolAccessMatrix();
    return { matrix };
  });

  app.patch('/admin/tool-access', async (request, reply) => {
    ensureAdmin(request);
    const body = PatchPayloadSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'invalid_payload', 'Invalid payload', body.error.issues);
    }

    const currentVersion = getPermissionsVersion();
    if (body.data.version !== undefined && body.data.version !== currentVersion) {
      reply.status(409);
      return { error: 'Version mismatch', code: 'version_mismatch', currentVersion } as any;
    }

    const actor = {
      email: request.auth?.email,
      username: request.auth?.username,
      sub: request.auth?.sub,
    };
    const result = applyToolAccessChanges(body.data.changes, actor);
    const matrix = getToolAccessMatrix();
    return { updated: result.updated, version: result.version, matrix };
  });

  app.post('/admin/tool-access/sync', async (request, reply) => {
    ensureAdmin(request);
    try {
      const tools = await mcpManager.listTools(true);
      await syncToolCatalogFromMcp(tools);
      const matrix = getToolAccessMatrix();
      return { ok: true, matrix };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to synchronise MCP tool catalog');
      return sendError(reply, 500, 'sync_failed', 'Nie udało się zsynchronizować katalogu narzędzi MCP');
    }
  });

  app.get('/admin/tool-access/audit', async (request, reply) => {
    ensureAdmin(request);
    const query = AuditQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return sendError(reply, 400, 'invalid_query', 'Invalid query parameters', query.error.issues);
    }
    const { limit, offset } = query.data;
    const entries = listToolAccessAuditEntries(limit, offset);
    return { entries };
  });
}
