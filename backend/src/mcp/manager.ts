import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import logger from '../logger.js';

const ServerConfigSchema = z.object({
  id: z.string().min(1),
  transport: z.enum(['stdio', 'ws', 'wss']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  allowedTools: z.array(z.string()).optional(),
  blockedTools: z.array(z.string()).optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
});

const MCPConfigSchema = z.object({
  servers: z.array(ServerConfigSchema).min(1),
});

export type MCPServerConfig = z.infer<typeof ServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export interface NamespacedToolDefinition {
  name: string;
  description?: string;
  parameters: unknown;
  serverId: string;
  originalName: string;
}

export interface ResourceItem {
  serverId: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

type MCPClient = any;

interface ClientEntry {
  client: MCPClient;
  config: MCPServerConfig;
}

export class MCPManager {
  private readonly configPath: string;
  private config?: MCPConfig;
  private clients = new Map<string, ClientEntry>();
  private toolCache: NamespacedToolDefinition[] | null = null;
  private toolNameMap = new Map<string, { serverId: string; originalName: string }>();

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
  }

  async init() {
    this.config = await this.loadConfig();
    for (const server of this.config.servers) {
      try {
        await this.startServer(server);
      } catch (error) {
        logger.warn({ err: error, serverId: server.id }, 'Skipping failed MCP server and continuing');
      }
    }
  }

  async shutdown() {
    for (const { client, config } of this.clients.values()) {
      try {
        await client.close?.();
      } catch (error) {
        logger.warn({ err: error, serverId: config.id }, 'Failed to close MCP client');
      }
    }
    this.clients.clear();
  }

  async listTools(forceRefresh = false): Promise<NamespacedToolDefinition[]> {
    if (!forceRefresh && this.toolCache) {
      return this.toolCache;
    }

    const defs: NamespacedToolDefinition[] = [];
    this.toolNameMap.clear();

    for (const [serverId, entry] of this.clients.entries()) {
      try {
        if (typeof entry.client.listTools !== 'function') {
          throw new Error('Client does not support listing tools');
        }
        const response = await entry.client.listTools({});
        let tools = Array.isArray(response?.tools) ? response.tools : response?.tools ?? [];

        // Fallback: if a minimal server fails to expose tool list, synthesize known definitions
        if ((!tools || tools.length === 0) && serverId === 'datetime') {
          tools = [
            { name: 'datetime_now', description: 'Current date and time', inputSchema: { type: 'object', properties: { tz: { type: 'string' } } } },
            { name: 'date_today', description: 'Today date with local start/end', inputSchema: { type: 'object', properties: { tz: { type: 'string' } } } },
            { name: 'timeframe', description: 'Compute {from,to} for common presets', inputSchema: { type: 'object', properties: { preset: { type: 'string' }, tz: { type: 'string' } } } },
            { name: 'iso_timestamp', description: 'UTC ISO timestamp now', inputSchema: { type: 'object', properties: {} } },
            { name: 'week_range', description: 'Current week range (Mon–Sun)', inputSchema: { type: 'object', properties: { tz: { type: 'string' } } } },
            { name: 'month_range', description: 'Month range (1..last day)', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, tz: { type: 'string' } } } },
            { name: 'timezone_offset', description: 'Timezone offset (±HH:MM, minutes)', inputSchema: { type: 'object', properties: { tz: { type: 'string' } } } },
            { name: 'format_datetime', description: 'Format datetime with tokens', inputSchema: { type: 'object', properties: { iso: { type: 'string' }, tz: { type: 'string' }, pattern: { type: 'string' }, locale: { type: 'string' } } } },
          ];
        }

        const filtered = entry.config.allowedTools?.length
          ? tools.filter((tool: any) => entry.config.allowedTools?.includes(tool.name))
          : tools;

        const blockedMatchers = (entry.config.blockedTools ?? []).map((pattern) => this.createMatcher(pattern));

        for (const tool of filtered ?? []) {
          if (blockedMatchers.some((matcher) => matcher(tool.name))) {
            logger.debug({ serverId, tool: tool.name }, 'Skipping tool blocked by configuration');
            continue;
          }
          const encodedName = this.generateToolName(serverId, tool.name);
          this.toolNameMap.set(encodedName, { serverId, originalName: tool.name });
          defs.push({
            name: encodedName,
            description: tool.description,
            parameters: tool.inputSchema ?? tool.parameters ?? { type: 'object', properties: {} },
            serverId,
            originalName: tool.name,
          });
        }
      } catch (error) {
        logger.error({ err: error, serverId }, 'Failed to list MCP tools');
        // As a last resort, synthesize datetime tools if listing fails
        if (serverId === 'datetime') {
          for (const t of [
            { name: 'datetime_now', description: 'Current date and time' },
            { name: 'date_today', description: 'Today date with local start/end' },
            { name: 'timeframe', description: 'Compute {from,to} for common presets' },
            { name: 'iso_timestamp', description: 'UTC ISO timestamp now' },
            { name: 'week_range', description: 'Current week range (Mon–Sun)' },
            { name: 'month_range', description: 'Month range (1..last day)' },
            { name: 'timezone_offset', description: 'Timezone offset (±HH:MM, minutes)' },
            { name: 'format_datetime', description: 'Format datetime with tokens' },
          ]) {
            const encodedName = this.generateToolName(serverId, t.name);
            this.toolNameMap.set(encodedName, { serverId, originalName: t.name });
            defs.push({ name: encodedName, description: t.description, parameters: { type: 'object', properties: {} }, serverId, originalName: t.name });
          }
        }
      }
    }

    this.toolCache = defs;
    return defs;
  }

  async listResources(): Promise<ResourceItem[]> {
    const items: ResourceItem[] = [];

    for (const [serverId, entry] of this.clients.entries()) {
      try {
        if (typeof entry.client.listResources !== 'function') {
          continue;
        }
        const response = await entry.client.listResources({});
        const resources = Array.isArray(response?.resources) ? response.resources : response?.resources ?? [];
        for (const resource of resources ?? []) {
          items.push({
            serverId,
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          });
        }
      } catch (error) {
        logger.error({ err: error, serverId }, 'Failed to list MCP resources');
      }
    }

    return items;
  }

  async readResource(serverId: string, uri: string): Promise<any> {
    const entry = this.clients.get(serverId);
    if (!entry) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (typeof entry.client.readResource !== 'function') {
      throw new Error(`MCP server ${serverId} does not expose resources API`);
    }

    return entry.client.readResource({ uri });
  }

  async callTool(fullName: string, args: unknown): Promise<any> {
    const mapping = this.toolNameMap.get(fullName);
    if (!mapping) {
      throw new Error(`Unknown tool: ${fullName}`);
    }
    const { serverId, originalName } = mapping;
    const entry = this.clients.get(serverId);
    if (!entry) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (entry.config.allowedTools?.length && !entry.config.allowedTools.includes(originalName)) {
      throw new Error(`Tool ${originalName} is not allowed for server ${serverId}`);
    }

    if (typeof entry.client.callTool !== 'function') {
      throw new Error(`MCP client for ${serverId} does not support tool calling`);
    }

    return entry.client.callTool({
      name: originalName,
      arguments: args,
    });
  }

  private async loadConfig(): Promise<MCPConfig> {
    const data = await readFile(this.configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return MCPConfigSchema.parse(parsed);
  }

  private async startServer(serverConfig: MCPServerConfig) {
    if (this.clients.has(serverConfig.id)) {
      logger.warn({ serverId: serverConfig.id }, 'MCP server already initialised');
      return;
    }

    try {
      const client = await this.createClient(serverConfig);
      this.clients.set(serverConfig.id, { client, config: serverConfig });
      logger.info({ serverId: serverConfig.id }, 'MCP server initialised');
    } catch (error) {
      logger.error({ err: error, serverId: serverConfig.id }, 'Failed to initialise MCP server');
      throw error;
    }
  }

  private async createClient(serverConfig: MCPServerConfig): Promise<MCPClient> {
    const clientModule: any = await import('@modelcontextprotocol/sdk/client');
    let transport: any;

    if (serverConfig.transport === 'stdio') {
      if (!serverConfig.command) {
        throw new Error(`MCP server ${serverConfig.id} requires command for stdio transport`);
      }
      const commandPath = path.isAbsolute(serverConfig.command)
        ? serverConfig.command
        : path.resolve(process.cwd(), serverConfig.command);
      const transportModule: any = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const { StdioClientTransport } = transportModule;
      transport = new StdioClientTransport({
        command: commandPath,
        args: serverConfig.args ?? [],
        env: serverConfig.env ?? {},
      });
    } else {
      if (!serverConfig.url) {
        throw new Error(`MCP server ${serverConfig.id} requires url for websocket transport`);
      }
      const wsModule: any = await import('@modelcontextprotocol/sdk/client/websocket.js');
      const { WebSocketClientTransport } = wsModule;
      transport = new WebSocketClientTransport(new URL(serverConfig.url));
    }

    const { Client } = clientModule;
    const client = new Client({
      name: 'chatapi',
      version: '0.1.0',
    });
    client.registerCapabilities?.({ tools: {}, resources: {} });
    await client.connect(transport);
    return client;
  }

  private generateToolName(serverId: string, toolName: string): string {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
    const base = `${sanitize(serverId)}_${sanitize(toolName)}`;
    if (!this.toolNameMap.has(base)) {
      return base;
    }
    let index = 1;
    let candidate = `${base}_${index}`;
    while (this.toolNameMap.has(candidate)) {
      index += 1;
      candidate = `${base}_${index}`;
    }
    return candidate;
  }

  private createMatcher(pattern: string): (value: string) => boolean {
    if (!pattern.includes('*')) {
      return (value: string) => value === pattern;
    }
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    return (value: string) => regex.test(value);
  }
}
