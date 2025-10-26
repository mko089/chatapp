import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv();

const allowedIpsFromEnv = (process.env.ALLOWED_IPS ?? '192.168.2.145,192.168.4.170')
  .split(',')
  .map((ip) => ip.trim())
  .filter((ip) => ip.length > 0);

const llmModelsFromEnv = (process.env.LLM_MODELS ?? '')
  .split(',')
  .map((model) => model.trim())
  .filter((model) => model.length > 0);

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
  chatMaxIterations: z
    .coerce.number()
    .int()
    .positive()
    .max(12)
    .optional()
    .default(process.env.CHAT_MAX_ITERATIONS ? Number.parseInt(process.env.CHAT_MAX_ITERATIONS, 10) : 6),
  promptTokenCostUsd: z
    .coerce.number()
    .nonnegative()
    .optional()
    .default(process.env.PROMPT_TOKEN_COST_USD ? Number.parseFloat(process.env.PROMPT_TOKEN_COST_USD) : 0.0),
  completionTokenCostUsd: z
    .coerce.number()
    .nonnegative()
    .optional()
    .default(process.env.COMPLETION_TOKEN_COST_USD ? Number.parseFloat(process.env.COMPLETION_TOKEN_COST_USD) : 0.0),
  llmAllowedModels: z.array(z.string().min(1)).default(llmModelsFromEnv.length ? llmModelsFromEnv : [process.env.LLM_MODEL ?? 'gpt-4.1']),
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
  chatMaxIterations: process.env.CHAT_MAX_ITERATIONS,
  promptTokenCostUsd: process.env.PROMPT_TOKEN_COST_USD,
  completionTokenCostUsd: process.env.COMPLETION_TOKEN_COST_USD,
  llmAllowedModels: llmModelsFromEnv,
});

export type AppConfig = typeof parsed;

export const config: AppConfig = parsed;
