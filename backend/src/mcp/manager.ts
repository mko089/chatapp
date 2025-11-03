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

type FallbackTool = {
  name: string;
  description?: string;
};

const FALLBACK_PARAMETERS = { type: 'object', properties: {} } as const;

const FALLBACK_TOOL_MAP: Record<string, FallbackTool[]> = {
  chat: [
    {
      name: 'chat_fetch_session',
      description: 'Returns stored chat messages (and optionally tool invocations) for a sessionId',
    },
  ],
  datetime: [
    { name: 'datetime_now', description: 'Current date and time' },
    { name: 'date_today', description: 'Today date with local start/end' },
    { name: 'timeframe', description: 'Compute {from,to} for common presets' },
    { name: 'iso_timestamp', description: 'UTC ISO timestamp now' },
    { name: 'week_range', description: 'Current week range (Mon–Sun)' },
    { name: 'month_range', description: 'Month range (1..last day)' },
    { name: 'timezone_offset', description: 'Timezone offset (±HH:MM, minutes)' },
    { name: 'format_datetime', description: 'Format datetime with tokens' },
  ],
  projects: [
    { name: 'projects_list_projects', description: 'Returns list of available projects' },
    { name: 'projects_create_project', description: 'Creates a new project with given name (and optional id/slug)' },
    { name: 'projects_get_tree', description: 'Returns tree structure of documents and folders for a project' },
    { name: 'projects_read_doc', description: 'Reads a document HTML content from a project' },
    { name: 'projects_upsert_doc', description: 'Creates or replaces a document HTML at the given path inside project' },
  ],
  meters: [
    { name: 'meters_health', description: 'Check MetersApp health.' },
    { name: 'meters_metrics', description: 'Get recent internal metrics ring.' },
    { name: 'meters_list_meters', description: 'List meters configuration with Loxone mapping.' },
    { name: 'meters_list_readings', description: 'List readings/consumption for meter(s) and time range.' },
    { name: 'meters_daily_consumption', description: 'Get derived daily consumption per meter for a date range. Supports live=1 for today.' },
    { name: 'meters_list_departments', description: 'List dictionary of departments.' },
    { name: 'meters_list_locations', description: 'List dictionary of locations.' },
    { name: 'meters_create_reading', description: 'Create a new reading (state or consumption).' },
    { name: 'meters_update_reading', description: 'Update an existing reading by key (meterId+ts+type).' },
    { name: 'meters_delete_reading', description: 'Delete a reading by key (meterId+ts+type).' },
    { name: 'meters_upsert_reading', description: 'Create or update a reading by key (meterId+ts+type).' },
  ],
  employee: [
    { name: 'employee_health', description: 'Check EmployeeApp backend health status.' },
    { name: 'employee_list_employees', description: 'List employees with optional filters (status, q, locations, missingCondition, offset, limit, includeInactive, at, location).' },
    { name: 'employee_get_employee', description: 'Get details for a single employee (with current employment condition).' },
    { name: 'employee_list_locations', description: 'List unique Kadromierz locations mapped to employees.' },
    { name: 'employee_list_conditions', description: 'List employment conditions for an employee.' },
    { name: 'employee_create_condition', description: 'Create employment condition interval for an employee.' },
    { name: 'employee_update_condition', description: 'Update employment condition by condition ID.' },
    { name: 'employee_update_employee', description: 'Update contact/status fields for an employee.' },
    { name: 'employee_employees_costs', description: 'Fetch employees labor cost report for a date range.' },
    { name: 'employee_dashboard', description: 'Compute dashboard labor summary for a date range.' },
    { name: 'employee_activity_log', description: 'Proxy Kadromierz raw activity log (HTML or JSON).' },
    { name: 'employee_kadromierz_raw_dashboard', description: 'Retrieve the Kadromierz raw dashboard payload (proxy to /kadromierz/raw/dashboard).' },
    { name: 'employee_list_attendances', description: 'List attendances for given date and filters.' },
    { name: 'employee_count_unassigned_attendances', description: 'Count attendances without an assigned job position over a date range (uses groups=nieprzypisane filter).' },
    { name: 'employee_top_breaks', description: 'Aggregate attendances and report employees with the longest break minutes for a given date.' },
    { name: 'employee_sync_kadromierz', description: 'Trigger Kadromierz employee list sync (idempotent). This only refreshes the roster; run employee_attendance_backfill for attendance data.' },
    { name: 'employee_sync_status', description: 'Check status of last Kadromierz sync.' },
    { name: 'employee_set_default_position', description: 'Set a default job position for an employee (fallback when attendance lacks job position).' },
    { name: 'employee_list_default_positions', description: 'List default job positions for an employee.' },
    { name: 'employee_delete_default_position', description: 'Delete a specific default job position mapping by its ID.' },
    { name: 'employee_list_employees_without_default_position', description: 'List employees without an effective default job position at time `at` (defaults to now). Optional includeInactive=true to include inactive/terminated.' },
    { name: 'employee_list_employees_in_group', description: 'List employees who appeared in attendances for specified group(s) over a date range. Aggregates distinct employees by default.' },
    { name: 'employee_suggest_default_positions', description: 'Suggest default job positions per employee from attendances in a window. Uses most frequent non-"__none" position with thresholds.' },
    { name: 'job_positions_list', description: 'List job positions (optionally filter by q). Returns id and title for selection.' },
    { name: 'job_positions_sync', description: 'Trigger Kadromierz job titles sync.' },
    { name: 'job_positions_unassigned', description: 'List job positions not assigned to any group.' },
    { name: 'job_positions_stats', description: 'Get job positions stats (total count and last update timestamp).' },
    { name: 'group_get', description: 'Fetch a single job position group with assigned positions.' },
    { name: 'group_create', description: 'Create a job position group.' },
    { name: 'group_update', description: 'Update job position group attributes.' },
    { name: 'group_delete', description: 'Delete a job position group.' },
    { name: 'group_positions_list', description: 'List job positions assigned to a group.' },
    { name: 'group_positions_replace', description: 'Replace the set of job positions assigned to a group.' },
    { name: 'group_positions_add', description: 'Assign a single job position to a group.' },
    { name: 'group_positions_remove', description: 'Remove a job position from a group.' },
    { name: 'employee_set_default_position_by_title', description: 'Find job position by title (case-insensitive contains) and set as default for employee. No-op if already active with same position.' },
    { name: 'employee_attendance_backfill', description: 'Start attendance backfill job over a date range (re-sync attendances after Kadromierz updates). Supports chunkDays and delaySeconds for rate limiting.' },
    { name: 'employee_attendance_backfill_jobs', description: 'List attendance backfill jobs and runs.' },
  ],
  fincost: [
    { name: 'fincost_list_loans', description: 'List loans with optional filters and pagination.' },
    { name: 'fincost_full_payoff', description: 'Record a full payoff payment that reduces outstanding principal to zero.' },
    { name: 'fincost_get_loan', description: 'Get loan details by ID.' },
    { name: 'fincost_get_loan_schedule', description: 'Get computed amortization schedule for a loan.' },
    { name: 'fincost_list_loan_payments', description: 'List recorded payments for a loan.' },
    { name: 'fincost_add_loan_payment', description: 'Add a payment or prepayment to a loan.' },
    { name: 'fincost_update_loan_payment', description: 'Update a specific payment entry for a loan.' },
    { name: 'fincost_delete_loan_payment', description: 'Delete a payment entry for a loan.' },
    { name: 'fincost_list_rate_changes', description: 'List interest rate changes for a loan.' },
    { name: 'fincost_add_rate_change', description: 'Add an interest rate change (bps) at a given date.' },
    { name: 'fincost_rrso', description: 'Compute annual effective rate (RRSO) with and without insurance/fees.' },
    { name: 'fincost_health', description: 'Check FinCost backend health endpoint.' },
  ],
  garden: [
    { name: 'garden_health', description: 'Check Garden Knowledge API health.' },
    { name: 'garden_list_spaces', description: 'List existing knowledge spaces.' },
    { name: 'garden_create_space', description: 'Create a knowledge space.' },
    { name: 'garden_list_nodes', description: 'List nodes (entries) inside a space.' },
    { name: 'garden_create_simple_node', description: 'Create a node using the simplified endpoint (auto org lookup).' },
    { name: 'garden_list_versions', description: 'List versions for a node.' },
    { name: 'garden_create_version', description: 'Create a node version.' },
    { name: 'garden_space_summary', description: 'Get nodes with latest version for a space.' },
  ],
  posbistro: [
    { name: 'posbistro_health', description: 'Check posbistro API health.' },
    { name: 'posbistro_list_locations', description: 'List configured locations (alias -> id).' },
    { name: 'posbistro_metrics_snapshot', description: 'Get metrics snapshot.' },
    { name: 'posbistro_metrics_alerts', description: 'Get computed metrics alerts.' },
    { name: 'posbistro_metrics_counters', description: 'Get metrics counters.' },
    { name: 'posbistro_menus_list', description: 'List menus for a location.' },
    { name: 'posbistro_menu_get', description: 'Get specific menu by id for a location.' },
    { name: 'posbistro_items_by_category', description: 'List items for category id (optionally filter by q).' },
    { name: 'posbistro_open_orders_today', description: 'List open orders for today for a location.' },
    { name: 'posbistro_document_lists_today', description: 'List document lists today for a location.' },
    { name: 'posbistro_item_sales_today', description: 'Get item sales for today for a location.' },
    { name: 'posbistro_item_sales_last_hours', description: 'Get item sales for last N hours.' },
    { name: 'posbistro_item_sales_range', description: 'Get item sales for YYYY/MM/DD date range.' },
    { name: 'posbistro_normalized_item_sales_daily_totals', description: 'Get normalized daily totals for a date range (bar day).' },
    { name: 'posbistro_normalized_open_orders_today', description: 'Get normalized open orders for today.' },
    { name: 'posbistro_normalized_item_sales_today', description: 'Get normalized item sales for today.' },
    { name: 'posbistro_normalized_item_sales_last_hours', description: 'Get normalized item sales for last N hours.' },
    { name: 'posbistro_normalized_item_sales_day', description: 'Get normalized item sales for a specific day (bar day).' },
    { name: 'posbistro_normalized_sales_list_today', description: 'Get normalized sales list for a category today (plain text).' },
  ],
  keycloak: [
    { name: 'kc_health', description: 'Check Keycloak admin health (token fetch + realms list).' },
    { name: 'kc_list_realms', description: 'List realms.' },
    { name: 'kc_list_clients', description: 'List clients for a realm.' },
    { name: 'kc_get_client', description: 'Get client details by clientId.' },
    { name: 'kc_list_users', description: 'List users (optionally by search).' },
    { name: 'kc_get_user', description: 'Get user by ID.' },
    { name: 'kc_list_roles', description: 'List realm roles.' },
    { name: 'kc_list_groups', description: 'List groups.' },
    { name: 'kc_set_user_password', description: 'Set user password (temporary flag supported).' },
    { name: 'kc_create_user', description: 'Create user (basic fields).' },
    { name: 'kc_update_user', description: 'Update user fields.' },
    { name: 'kc_assign_client_roles_to_user', description: 'Assign client roles to user by role names.' },
    { name: 'kc_rotate_client_secret', description: 'Rotate client secret.' },
    { name: 'kc_set_client_secret', description: 'Set client secret to a specific value.' },
    { name: 'kc_create_client', description: 'Create client (basic config).' },
    { name: 'kc_update_client', description: 'Update existing client.' },
    { name: 'kc_create_role', description: 'Create realm role.' },
    { name: 'kc_add_user_to_group', description: 'Add user to group.' },
    { name: 'kc_remove_user_from_group', description: 'Remove user from group.' },
    { name: 'kc_upsert_client_protocol_mapper', description: 'Create or update a client protocol mapper by name.' },
  ],
};

function getFallbackToolsForServer(serverId: string): FallbackTool[] {
  return FALLBACK_TOOL_MAP[serverId] ?? [];
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
    const perServerCounts = new Map<string, number>();
    this.toolNameMap.clear();

    for (const [serverId, entry] of this.clients.entries()) {
      let addedForServer = 0;
      try {
        if (typeof entry.client.listTools !== 'function') {
          throw new Error('Client does not support listing tools');
        }
        const response = await entry.client.listTools({});
        let tools = Array.isArray(response?.tools) ? response.tools : response?.tools ?? [];

        const filtered = entry.config.allowedTools?.length
          ? tools.filter((tool: any) => entry.config.allowedTools?.includes(tool.name))
          : tools;

        // Defensive deduplication: drop duplicate tools that would collide after sanitization
        // and server namespacing. This prevents unstable suffixes like `_1` appearing when
        // servers return duplicate or near-duplicate names (e.g. differing only by punctuation).
        const sanitize = (value: string) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const seenCanonical = new Set<string>();
        const deduped: any[] = [];
        for (const t of filtered ?? []) {
          const rawName = typeof t?.name === 'string' ? t.name : '';
          if (!rawName) {
            logger.debug({ serverId, tool: t }, 'Skipping tool without a valid name');
            continue;
          }
          const canonical = `${sanitize(serverId)}_${sanitize(rawName)}`.toLowerCase();
          if (seenCanonical.has(canonical)) {
            logger.warn({ serverId, tool: rawName }, 'Dropping duplicate tool after sanitization');
            continue;
          }
          seenCanonical.add(canonical);
          deduped.push(t);
        }

        const blockedMatchers = (entry.config.blockedTools ?? []).map((pattern) => this.createMatcher(pattern));

        for (const tool of deduped ?? []) {
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
          addedForServer += 1;
        }
      } catch (error) {
        logger.error({ err: error, serverId }, 'Failed to list MCP tools');
        addedForServer += this.applyFallbackTools(serverId, defs, perServerCounts, 'Using fallback MCP tool catalog after tool listing error');
        continue;
      }

      if (addedForServer === 0) {
        addedForServer += this.applyFallbackTools(serverId, defs, perServerCounts, 'MCP server returned no tools; using fallback definitions');
      } else if (addedForServer > 0) {
        perServerCounts.set(serverId, (perServerCounts.get(serverId) ?? 0) + addedForServer);
      }
    }

    if (this.config?.servers) {
      for (const server of this.config.servers) {
        if ((perServerCounts.get(server.id) ?? 0) > 0) {
          continue;
        }
        this.applyFallbackTools(server.id, defs, perServerCounts, 'MCP server unavailable; using fallback tool catalog');
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

  private applyFallbackTools(
    serverId: string,
    defs: NamespacedToolDefinition[],
    counts: Map<string, number>,
    reason: string,
  ): number {
    const fallback = getFallbackToolsForServer(serverId);
    if (!fallback.length) {
      logger.debug({ serverId }, 'No fallback MCP tools configured');
      return 0;
    }

    logger.warn({ serverId }, reason);
    let added = 0;
    for (const tool of fallback) {
      const encodedName = this.generateToolName(serverId, tool.name);
      if (this.toolNameMap.has(encodedName)) {
        continue;
      }
      this.toolNameMap.set(encodedName, { serverId, originalName: tool.name });
      defs.push({
        name: encodedName,
        description: tool.description,
        parameters: FALLBACK_PARAMETERS,
        serverId,
        originalName: tool.name,
      });
      added += 1;
    }
    if (added > 0) {
      counts.set(serverId, (counts.get(serverId) ?? 0) + added);
    }
    return added;
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
