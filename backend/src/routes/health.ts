import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { MCPManager } from '../mcp/manager.js';
import { config } from '../config.js';

interface RegisterHealthRouteOptions {
  mcpManager: MCPManager;
  openAi: OpenAI;
}

export async function registerHealthRoute(app: FastifyInstance<any>, options: RegisterHealthRouteOptions) {
  const { mcpManager, openAi } = options;

  app.get('/health', async () => {
    const health = {
      backend: 'ok' as const,
      mcp: { status: 'unknown' as 'ok' | 'error' | 'unknown', error: undefined as string | undefined },
      openai: {
        status: 'unknown' as 'ok' | 'error' | 'unknown',
        error: undefined as string | undefined,
        model: config.llmModel,
        allowedModels: config.llmAllowedModels,
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
}
