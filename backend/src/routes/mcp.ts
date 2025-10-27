import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MCPManager } from '../mcp/manager.js';
import { filterToolsByPermissions, isServerAllowed, resolveEffectivePermissions } from '../rbac/index.js';

interface RegisterMcpRoutesOptions {
  mcpManager: MCPManager;
}

export async function registerMcpRoutes(app: FastifyInstance<any>, options: RegisterMcpRoutesOptions) {
  const { mcpManager } = options;

  app.get('/mcp/tools', async (request) => {
    const permissions = resolveEffectivePermissions(request.auth);
    const tools = await mcpManager.listTools();
    const filtered = filterToolsByPermissions(tools, permissions);
    return filtered.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      serverId: tool.serverId,
    }));
  });

  app.get('/mcp/resources', async (request) => {
    const permissions = resolveEffectivePermissions(request.auth);
    const resources = await mcpManager.listResources();
    return resources.filter((resource) => isServerAllowed(resource.serverId, permissions));
  });

  const ReadResourceQuery = z.object({
    serverId: z.string().min(1),
    uri: z.string().min(1),
  });

  app.get('/mcp/resources/read', async (request, reply) => {
    const parseResult = ReadResourceQuery.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parseResult.error.issues };
    }

    try {
      const { serverId, uri } = parseResult.data;
      const permissions = resolveEffectivePermissions(request.auth);
      if (!isServerAllowed(serverId, permissions)) {
        reply.status(403);
        return { error: 'Access to this server is not permitted' };
      }
      return await mcpManager.readResource(serverId, uri);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read MCP resource');
      reply.status(400);
      return { error: (error as Error).message };
    }
  });
}
