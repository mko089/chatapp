import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv();

const allowedIpsFromEnv = (process.env.ALLOWED_IPS ?? '192.168.2.145,192.168.4.170')
  .split(',')
  .map((ip) => ip.trim())
  .filter((ip) => ip.length > 0);

const ConfigSchema = z.object({
  nodeEnv: z.string().optional().default(process.env.NODE_ENV ?? 'development'),
  port: z.coerce.number().int().positive().default(4025),
  logLevel: z
    .string()
    .optional()
    .default(process.env.LOG_LEVEL ?? 'info'),
  openAiApiKey: z.string().min(1, 'OPENAI_API_KEY is required'),
  llmModel: z.string().optional().default(process.env.LLM_MODEL ?? 'gpt-4.1'),
  requestTimeoutMs: z.coerce.number().int().positive().optional().default(20000),
  mcpConfigPath: z
    .string()
    .optional()
    .default(process.env.MCP_CONFIG ?? path.resolve('backend/mcp.config.json')),
  allowedIps: z.array(z.string().min(1)).default(allowedIpsFromEnv.length ? allowedIpsFromEnv : ['192.168.2.145']),
});

const parsed = ConfigSchema.parse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  logLevel: process.env.LOG_LEVEL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  llmModel: process.env.LLM_MODEL,
  requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
  mcpConfigPath: process.env.MCP_CONFIG,
  allowedIps: allowedIpsFromEnv,
});

export type AppConfig = typeof parsed;

export const config: AppConfig = parsed;
