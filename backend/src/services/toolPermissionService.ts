import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  deleteRoleGroupPermission,
  deleteRoleToolPermission,
  getPermissionsVersion,
  getRoleGroupPermission,
  getRoleToolPermission,
  insertToolAccessAudit,
  listRoleGroupPermissions,
  listRoleToolPermissions,
  listToolDefinitions,
  listToolGroups,
  listToolAccessAudit,
  upsertRoleGroupPermission,
  upsertRoleToolPermission,
} from '../db/toolAccessRepository.js';
import { config } from '../config.js';
import { normalizeRoleName } from '../rbac/utils.js';
import type {
  RoleToolGroupPermissionRecord,
  RoleToolPermissionRecord,
  ToolAccessAuditRecord,
  ToolAccessChangeDescriptor,
  ToolDefinitionRecord,
  ToolGroupRecord,
  ToolPermissionScope,
} from '../types/toolAccess.js';

type RolePermissionAggregate = {
  allowServers: Set<string>;
  denyServers: Set<string>;
  allowTools: Set<string>;
  denyTools: Set<string>;
};

type PermissionCache = {
  version: number;
  perRole: Map<string, RolePermissionAggregate>;
};

let permissionCache: PermissionCache | null = null;

function ensureAggregate(map: Map<string, RolePermissionAggregate>, role: string): RolePermissionAggregate {
  const normalized = normalizeRoleName(role);
  const existing = map.get(normalized);
  if (existing) {
    return existing;
  }
  const created: RolePermissionAggregate = {
    allowServers: new Set(),
    denyServers: new Set(),
    allowTools: new Set(),
    denyTools: new Set(),
  };
  map.set(normalized, created);
  return created;
}

function resolveServerId(group: ToolGroupRecord | undefined): string | null {
  if (!group) {
    return null;
  }
  const metadata = group.metadata ?? {};
  if (metadata && typeof metadata.serverId === 'string' && metadata.serverId.length > 0) {
    return metadata.serverId.toLowerCase();
  }
  return group.id.toLowerCase();
}

function buildPermissionCache(): PermissionCache {
  const version = getPermissionsVersion();
  const groups = listToolGroups();
  const groupMap = new Map<string, ToolGroupRecord>(groups.map((group) => [group.id, group]));
  const perRole = new Map<string, RolePermissionAggregate>();

  for (const entry of listRoleGroupPermissions()) {
    const aggregate = ensureAggregate(perRole, entry.role);
    const group = groupMap.get(entry.groupId);
    const serverId = resolveServerId(group);
    if (!serverId) {
      continue;
    }
    if (entry.allowed) {
      aggregate.allowServers.add(serverId);
      aggregate.denyServers.delete(serverId);
    } else {
      aggregate.denyServers.add(serverId);
      aggregate.allowServers.delete(serverId);
    }
  }

  for (const entry of listRoleToolPermissions()) {
    const aggregate = ensureAggregate(perRole, entry.role);
    const toolId = entry.toolId.toLowerCase();
    if (entry.allowed) {
      aggregate.allowTools.add(toolId);
      aggregate.denyTools.delete(toolId);
    } else {
      aggregate.denyTools.add(toolId);
      aggregate.allowTools.delete(toolId);
    }
  }

  return { version, perRole };
}

function getPermissionCache(): PermissionCache {
  const version = getPermissionsVersion();
  if (!permissionCache || permissionCache.version !== version) {
    permissionCache = buildPermissionCache();
  }
  return permissionCache;
}

export function invalidateToolPermissionCache(): void {
  permissionCache = null;
}

export function getDynamicRolePermissions(): Map<string, RolePermissionAggregate> {
  const cache = getPermissionCache();
  return cache.perRole;
}

export interface ToolAccessMatrixGroup {
  group: ToolGroupRecord;
  tools: ToolDefinitionRecord[];
}

export interface ToolAccessMatrix {
  roles: string[];
  groups: ToolAccessMatrixGroup[];
  groupPermissions: Record<string, Record<string, RoleToolGroupPermissionRecord>>;
  toolPermissions: Record<string, Record<string, RoleToolPermissionRecord>>;
  version: number;
}

function collectRoles(
  groupPermissions: RoleToolGroupPermissionRecord[],
  toolPermissions: RoleToolPermissionRecord[],
): string[] {
  const roleSet = new Set<string>();
  const base = [
    ...(config.rbac.defaultRoles ?? []),
    ...(config.rbac.fallbackRoles ?? []),
    'owner',
    'admin',
    'manager',
    'analyst',
    'viewer',
  ];
  for (const role of base) {
    roleSet.add(normalizeRoleName(role));
  }
  for (const entry of [...groupPermissions, ...toolPermissions]) {
    roleSet.add(normalizeRoleName(entry.role));
  }
  return Array.from(roleSet).filter((role) => role.length > 0).sort();
}

export function getToolAccessMatrix(): ToolAccessMatrix {
  const groups = listToolGroups();
  const definitions = listToolDefinitions(true);
  const groupPermissions = listRoleGroupPermissions();
  const toolPermissions = listRoleToolPermissions();
  const roles = collectRoles(groupPermissions, toolPermissions);
  const version = getPermissionsVersion();

  const groupPermissionMap: ToolAccessMatrix['groupPermissions'] = {};
  for (const role of roles) {
    groupPermissionMap[role] = {};
  }
  for (const entry of groupPermissions) {
    const role = normalizeRoleName(entry.role);
    if (!groupPermissionMap[role]) {
      groupPermissionMap[role] = {};
    }
    groupPermissionMap[role][entry.groupId] = entry;
  }

  const toolPermissionMap: ToolAccessMatrix['toolPermissions'] = {};
  for (const role of roles) {
    toolPermissionMap[role] = {};
  }
  for (const entry of toolPermissions) {
    const role = normalizeRoleName(entry.role);
    if (!toolPermissionMap[role]) {
      toolPermissionMap[role] = {};
    }
    toolPermissionMap[role][entry.toolId] = entry;
  }

  const grouped: ToolAccessMatrixGroup[] = groups.map((group) => ({
    group,
    tools: definitions.filter((definition) => definition.groupId === group.id),
  }));

  return {
    roles,
    groups: grouped,
    groupPermissions: groupPermissionMap,
    toolPermissions: toolPermissionMap,
    version,
  };
}

function getActorLabel(actor?: { email?: string; username?: string; sub?: string }): string {
  if (!actor) {
    return 'unknown';
  }
  if (actor.email && actor.email.length > 0) {
    return actor.email;
  }
  if (actor.username && actor.username.length > 0) {
    return actor.username;
  }
  if (actor.sub && actor.sub.length > 0) {
    return actor.sub;
  }
  return 'unknown';
}

const ToolAccessChangeSchema = z.object({
  type: z.enum(['group', 'tool']),
  role: z.string().min(1),
  targetId: z.string().min(1),
  scope: z.string().optional().default('global'),
  allowed: z.boolean().nullable(),
  reason: z.string().max(200).nullable().optional(),
});

export function applyToolAccessChanges(
  changes: ToolAccessChangeDescriptor[],
  actorInfo?: { email?: string; username?: string; sub?: string },
) {
  if (!changes || changes.length === 0) {
    return { updated: 0, version: getPermissionsVersion() };
  }

  const validated: Array<z.infer<typeof ToolAccessChangeSchema>> = [];
  for (const change of changes) {
    const parse = ToolAccessChangeSchema.safeParse(change);
    if (!parse.success) {
      throw new Error(`Invalid change payload: ${parse.error.message}`);
    }
    validated.push(parse.data);
  }

  const db: BetterSqlite3Database = getDb();
  const actorLabel = getActorLabel(actorInfo);
  const apply = db.transaction(() => {
    let updated = 0;
    for (const change of validated) {
      const role = normalizeRoleName(change.role);
      const scope = (change.scope ?? 'global') as ToolPermissionScope;
      if (change.type === 'group') {
        const before = getRoleGroupPermission(role, change.targetId, scope);
        if (change.allowed === null) {
          if (deleteRoleGroupPermission(role, change.targetId, scope)) {
            updated += 1;
            insertToolAccessAudit({
              actor: actorLabel,
              role,
              scope,
              targetType: 'group',
              targetId: change.targetId,
              previousState: before,
              nextState: null,
            });
          }
          continue;
        }
        const after = upsertRoleGroupPermission({
          role,
          groupId: change.targetId,
          scope,
          allowed: change.allowed,
          updatedBy: actorLabel,
        });
        updated += 1;
        insertToolAccessAudit({
          actor: actorLabel,
          role,
          scope,
          targetType: 'group',
          targetId: change.targetId,
          previousState: before,
          nextState: after,
        });
        continue;
      }

      // tool-level
      const before = getRoleToolPermission(role, change.targetId, scope);
      if (change.allowed === null) {
        if (deleteRoleToolPermission(role, change.targetId, scope)) {
          updated += 1;
          insertToolAccessAudit({
            actor: actorLabel,
            role,
            scope,
            targetType: 'tool',
            targetId: change.targetId,
            previousState: before,
            nextState: null,
          });
        }
        continue;
      }
      const after = upsertRoleToolPermission({
        role,
        toolId: change.targetId,
        scope,
        allowed: change.allowed,
        reason: change.reason ?? null,
        updatedBy: actorLabel,
      });
      updated += 1;
      insertToolAccessAudit({
        actor: actorLabel,
        role,
        scope,
        targetType: 'tool',
        targetId: change.targetId,
        previousState: before,
        nextState: after,
      });
    }
    return updated;
  });

  const updatedCount = apply();
  invalidateToolPermissionCache();
  const version = getPermissionsVersion();
  return { updated: updatedCount, version };
}

export function listToolAccessAuditEntries(limit = 100, offset = 0): ToolAccessAuditRecord[] {
  return listToolAccessAudit(limit, offset);
}
