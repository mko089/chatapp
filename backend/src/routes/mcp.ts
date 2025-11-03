import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MCPManager } from '../mcp/manager.js';
import { filterToolsByPermissions, isServerAllowed, resolveEffectivePermissions } from '../rbac/index.js';
import { loadSession, saveSession } from '../storage/sessionStore.js';
import { recordToolInvocation } from '../services/toolInvocationLogger.js';
import { sendError } from '../utils/errors.js';
import { runWithBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';

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
      return sendError(reply, 400, 'invalid_query', 'Invalid query parameters', parseResult.error.issues);
    }

    try {
      const { serverId, uri } = parseResult.data;
      const permissions = resolveEffectivePermissions(request.auth);
      if (!isServerAllowed(serverId, permissions)) {
        return sendError(reply, 403, 'forbidden', 'Access to this server is not permitted');
      }
      return await mcpManager.readResource(serverId, uri);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read MCP resource');
      return sendError(reply, 400, 'read_failed', (error as Error).message);
    }
  });

  const CallToolBody = z.object({
    name: z.string().min(1),
    // Accept either a raw string (original tool_call arguments) or a parsed object
    rawArgs: z.union([z.string(), z.record(z.any())]).optional(),
    args: z.any().optional(),
    sessionId: z.string().min(1).optional(),
  });

  function tryParseJsonLoose(text: string): any | null {
    if (!text || typeof text !== 'string') return null;
    const attempts: Array<(s: string) => string> = [
      (s) => s,
      (s) => {
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        return (start >= 0 && end > start) ? s.slice(start, end + 1) : s;
      },
      (s) => s.replace(/'/g, '"'),
      (s) => s.replace(/,\s*([}\]])/g, '$1'),
      (s) => s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' '),
    ];
    for (const fix of attempts) {
      const candidate = fix(text);
      try {
        return JSON.parse(candidate);
      } catch {}
    }
    return null;
  }

  app.post('/mcp/tools/call', async (request, reply) => {
    const parsed = CallToolBody.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_body', 'Invalid body', parsed.error.issues);
    }

    const { name, rawArgs, args, sessionId } = parsed.data;
    const permissions = resolveEffectivePermissions(request.auth);
    try {
      const all = await mcpManager.listTools();
      const allowed = filterToolsByPermissions(all, permissions);
      const tool = allowed.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!tool) {
        return sendError(reply, 403, 'forbidden', `Tool ${name} is not permitted or not found`);
      }

      let effectiveArgs: unknown = {};
      if (rawArgs !== undefined) {
        if (typeof rawArgs === 'string') {
          const loose = tryParseJsonLoose(rawArgs);
          effectiveArgs = loose ?? {};
        } else if (rawArgs && typeof rawArgs === 'object') {
          effectiveArgs = rawArgs;
        }
      } else if (args !== undefined) {
        effectiveArgs = args;
      }

      let existingSession: Awaited<ReturnType<typeof loadSession>> | null = null;
      if (sessionId) {
        existingSession = await loadSession(sessionId);
        if (existingSession && existingSession.userId && existingSession.userId !== request.auth?.sub) {
          return sendError(reply, 404, 'not_found', 'Session not found');
        }
      }

      const breakerKey = tool ? `mcp:${tool.serverId}` : 'mcp';
      const result = await runWithBreaker(breakerKey, () => retry(() => mcpManager.callTool(name, effectiveArgs), {
        retries: 1,
        baseDelayMs: 200,
        maxDelayMs: 600,
        shouldRetry: (err) => {
          const anyErr: any = err ?? {};
          const code = String(anyErr?.code ?? '').toUpperCase();
          if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
          const msg = String(anyErr?.message ?? '').toLowerCase();
          return msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('network');
        },
      }));
      const record = {
        name,
        args: effectiveArgs,
        rawArgs: rawArgs ?? null,
        result,
        timestamp: new Date().toISOString(),
      };

      if (sessionId) {
        try {
          const updated = {
            id: sessionId,
            userId: existingSession?.userId ?? request.auth?.sub ?? null,
            accountId: existingSession?.accountId ?? request.auth?.accountId ?? null,
            messages: existingSession?.messages ?? [],
            toolResults: [...(existingSession?.toolResults ?? []), record],
            createdAt: existingSession?.createdAt ?? record.timestamp,
            updatedAt: new Date().toISOString(),
          };
          await saveSession(updated);
        } catch (e) {
          // non-fatal: cannot persist session
        }
      }

      try { recordToolInvocation({ sessionId, toolName: name, args: effectiveArgs, result }); } catch {}

      return { invocation: record };
    } catch (error) {
      request.log.error({ err: error, tool: name }, 'Failed to call MCP tool');
      return sendError(reply, 400, 'tool_call_failed', (error as Error).message);
    }
  });
}
