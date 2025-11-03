import logger from '../logger.js';
import type { NamespacedToolDefinition } from '../mcp/manager.js';
import {
  listToolDefinitions,
  listToolGroups,
  upsertToolDefinition,
  upsertToolGroup,
} from '../db/toolAccessRepository.js';
import type { ToolDefinitionRecord, ToolGroupRecord } from '../types/toolAccess.js';

function toGroupId(serverId: string): string {
  return serverId.trim().toLowerCase();
}

function toGroupName(serverId: string): string {
  if (!serverId) return 'Narzędzia';
  return serverId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export async function syncToolCatalogFromMcp(tools: NamespacedToolDefinition[]): Promise<void> {
  if (!tools || tools.length === 0) {
    logger.warn('syncToolCatalogFromMcp called with no tools');
    return;
  }

  const groupMap = new Map<string, { id: string; name: string; metadata: any }>();

  for (const tool of tools) {
    const groupId = toGroupId(tool.serverId);
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        id: groupId,
        name: toGroupName(tool.serverId),
        metadata: {
          serverId: tool.serverId,
        },
      });
    }
  }

  for (const group of groupMap.values()) {
    try {
      upsertToolGroup({
        id: group.id,
        name: group.name,
        metadata: group.metadata,
      });
    } catch (error) {
      logger.error({ err: error, groupId: group.id }, 'Failed to upsert tool group');
    }
  }

  for (const tool of tools) {
    const groupId = toGroupId(tool.serverId);
    try {
      upsertToolDefinition({
        id: tool.name.toLowerCase(),
        groupId,
        name: tool.originalName ?? tool.name,
        description: tool.description ?? null,
        metadata: {
          serverId: tool.serverId,
          originalName: tool.originalName ?? tool.name,
        },
      });
    } catch (error) {
      logger.error({ err: error, tool: tool.name, serverId: tool.serverId }, 'Failed to upsert tool definition');
    }
  }
}

export function getToolCatalog(): { groups: ToolGroupRecord[]; tools: ToolDefinitionRecord[] } {
  const groups = listToolGroups();
  const tools = listToolDefinitions(true);
  return { groups, tools };
}
