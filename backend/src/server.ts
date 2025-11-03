import Fastify from 'fastify';
import OpenAI from 'openai';
import cors from '@fastify/cors';
import { config } from './config.js';
import logger from './logger.js';
import { MCPManager } from './mcp/manager.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerChatStreamRoutes } from './routes/chatStream.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerAdminBudgetsRoutes } from './routes/admin/budgets.js';
import { registerAdminLlmTracesRoutes } from './routes/admin/llmTraces.js';
import { registerAdminToolAccessRoutes } from './routes/admin/toolAccess.js';
import { registerPrometheusMetricsRoute } from './routes/metricsExporter.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerAuthRoutes } from './routes/auth.js';
import { initDatabase } from './db/index.js';
import { buildAuthHook, logAuthStartupDetails } from './middleware/auth.js';
import { syncToolCatalogFromMcp } from './services/toolCatalogService.js';
import { recordHttpRequest } from './metrics/prometheus.js';
import { createFixedWindowRateLimiter } from './middleware/rateLimit.js';

async function bootstrap() {
  if (!config.openAiApiKey) {
    logger.warn('OPENAI_API_KEY is not set — LLM calls will fail');
  }

  const app = Fastify({ logger: logger as any });
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['x-budget-warning'],
  });

  // Basic rate-limit for mutating methods in LAN (Lean Auth)
  const rl = createFixedWindowRateLimiter({ windowMs: 10_000, limit: 10 });

  app.addHook('onRequest', async (request, reply) => {
    // mark start time for metrics
    try {
      // @ts-ignore
      (request as any).metricsStart = process.hrtime.bigint();
      // backward-compatible ms start
      // @ts-ignore
      (request as any).startTime = Date.now();
    } catch {}
    // Propagate request identifier to clients for easier debugging/correlation
    try {
      // Fastify exposes request.id; set it as a response header
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reply.header('x-request-id', (request as any).id ?? '');
    } catch {}
    // Allow CORS preflight and allowlist wildcard
    if (request.method?.toUpperCase() === 'OPTIONS') {
      return;
    }
    if (config.allowedIps.includes('*')) {
      return;
    }
    const headerIp = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const rawIp = headerIp || request.ip;
    const normalizedIp = rawIp?.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
    // Rate-limit only mutating methods
    const method = (request.method || '').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const key = `${normalizedIp || 'unknown'}`;
      const res = rl.tryConsume(key);
      try {
        reply.header('X-RateLimit-Limit', String(res.state.limit));
        reply.header('X-RateLimit-Remaining', String(res.state.remaining));
        reply.header('X-RateLimit-Reset', String(res.state.resetEpochSeconds));
      } catch {}
      if (!res.allowed) {
        const retryAfter = Math.max(0, res.state.resetEpochSeconds - Math.ceil(Date.now() / 1000));
        try { reply.header('Retry-After', String(retryAfter)); } catch {}
        reply.code(429);
        return reply.send({ error: 'Too Many Requests', code: 'rate_limit.exceeded' });
      }
    }
    const allowed = config.allowedIps.includes(normalizedIp ?? '');
    if (!allowed) {
      request.log.warn({ ip: normalizedIp }, 'Blocked request from disallowed IP');
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });

  logAuthStartupDetails();

  if (config.auth.enabled) {
    const authHook = buildAuthHook();
    app.addHook('onRequest', authHook);
  }

  await initDatabase(config.databasePath);

  const mcpManager = new MCPManager(config.mcpConfigPath);
  // Initialise MCP servers, but do not block backend startup if some fail
  try {
    await mcpManager.init();
    try {
      const tools = await mcpManager.listTools();
      await syncToolCatalogFromMcp(tools);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to synchronise tool catalog from MCP');
    }
  } catch (error) {
    logger.warn({ err: error }, 'Continuing without fully initialised MCP servers');
  }

  const openAi = new OpenAI({ apiKey: config.openAiApiKey });

  await registerMcpRoutes(app as any, { mcpManager });
  await registerChatRoutes(app as any, { mcpManager, openAi });
  if (config.chatStreamingEnabled) {
    await registerChatStreamRoutes(app as any, { mcpManager, openAi });
  } else {
    logger.info('Streaming chat disabled by CHAT_STREAM_ENABLED=false');
  }
  await registerHealthRoute(app as any, { mcpManager, openAi });
  await registerAuthRoutes(app as any);
  await registerSessionRoutes(app as any);
  await registerMetricsRoutes(app as any);
  await registerPrometheusMetricsRoute(app as any);
  await registerProjectRoutes(app as any);
  await registerAdminBudgetsRoutes(app as any);
  await registerAdminLlmTracesRoutes(app as any);
  await registerAdminToolAccessRoutes(app as any, { mcpManager });
  await registerDebugRoutes(app as any);

  app.addHook('onClose', async () => {
    await mcpManager.shutdown();
  });

  // Collect basic HTTP metrics
  app.addHook('onResponse', async (request, reply) => {
    try {
      // @ts-ignore Fastify v4
      const routePath: string = (request as any).routeOptions?.url || (request as any).routerPath || request.url || '';
      const method = (request.method || '').toUpperCase();
      const status = reply.statusCode || 0;
      const startHr: bigint | undefined = (request as any)._startAt || (request as any).metricsStart;
      let durationMs = 0;
      if (startHr && typeof startHr === 'bigint') {
        const diff = Number(process.hrtime.bigint() - startHr);
        durationMs = diff / 1_000_000; // ns -> ms
      } else if ((request as any).startTime) {
        durationMs = Date.now() - (request as any).startTime;
      }
      recordHttpRequest({ method, route: routePath, status }, durationMs);
    } catch {}
  });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port }, 'chatapi listening');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
