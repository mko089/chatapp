import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { MCPManager } from '../mcp/manager.js';
import { config } from '../config.js';
import { isModelAllowed, resolveEffectivePermissions } from '../rbac/index.js';
import { getDb } from '../db/index.js';

interface RegisterHealthRouteOptions {
  mcpManager: MCPManager;
  openAi: OpenAI;
}

export async function registerHealthRoute(app: FastifyInstance<any>, options: RegisterHealthRouteOptions) {
  const { mcpManager, openAi } = options;

  app.get('/health', async (request) => {
    const permissions = resolveEffectivePermissions(request.auth);
    const allowedModelsByRbac = config.llmAllowedModels.filter((model) => isModelAllowed(model, permissions));
    const exposedAllowedModels = allowedModelsByRbac.length > 0 ? allowedModelsByRbac : config.llmAllowedModels;

    const health = {
      backend: 'ok' as const,
      mcp: { status: 'unknown' as 'ok' | 'error' | 'unknown', error: undefined as string | undefined },
      openai: {
        status: 'unknown' as 'ok' | 'error' | 'unknown',
        error: undefined as string | undefined,
        model: config.llmModel,
        allowedModels: exposedAllowedModels,
      },
      rbac: {
        enabled: config.rbac.enabled,
        roles: permissions.appliedRoles,
      },
      flags: {
        llmTraceEnabled: config.llmTraceEnabled,
        chatInferArgsEnabled: config.chatInferArgsEnabled,
        chatMaxIterations: config.chatMaxIterations,
      },
    };

    try {
      await mcpManager.listTools(true);
      health.mcp.status = 'ok';
    } catch (error) {
      health.mcp.status = 'error';
      health.mcp.error = error instanceof Error ? error.message : String(error);
    }

    try {
      await openAi.models.retrieve(config.llmModel);
      health.openai.status = 'ok';
    } catch (error) {
      health.openai.status = 'error';
      health.openai.error = error instanceof Error ? error.message : String(error);
    }

    return health;
  });

  // Readiness probe: returns 200 when critical dependencies are initialised
  app.get('/ready', async (request, reply) => {
    try {
      // DB initialised
      const db = getDb();
      db.prepare('SELECT 1').get();
      // MCP initialised (at least one server attempted)
      await mcpManager.listTools(false);
      reply.code(200);
      return { status: 'ready' } as const;
    } catch (error) {
      reply.code(503);
      return { status: 'not-ready', error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
}
