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
import { registerAdminBudgetsRoutes } from './routes/admin/budgets.js';
import { initDatabase } from './db/index.js';
import { buildAuthHook, logAuthStartupDetails } from './middleware/auth.js';

async function bootstrap() {
  if (!config.openAiApiKey) {
    logger.warn('OPENAI_API_KEY is not set — LLM calls will fail');
  }

  const app = Fastify({ logger: logger as any });
  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (request, reply) => {
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
  await mcpManager.init();

  const openAi = new OpenAI({ apiKey: config.openAiApiKey });

  await registerMcpRoutes(app as any, { mcpManager });
  await registerChatRoutes(app as any, { mcpManager, openAi });
  await registerChatStreamRoutes(app as any, { mcpManager, openAi });
  await registerHealthRoute(app as any, { mcpManager, openAi });
  await registerSessionRoutes(app as any);
  await registerMetricsRoutes(app as any);
  await registerAdminBudgetsRoutes(app as any);

  app.addHook('onClose', async () => {
    await mcpManager.shutdown();
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
