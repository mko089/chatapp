import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import type {
  RoleToolGroupPermissionRecord,
  RoleToolPermissionRecord,
  ToolAccessAuditRecord,
  ToolDefinitionRecord,
  ToolGroupRecord,
  ToolPermissionScope,
} from '../types/toolAccess.js';

function parseJson(value: unknown): any | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value as any;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapGroup(row: any): ToolGroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    metadata: parseJson(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDefinition(row: any): ToolDefinitionRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    description: row.description ?? null,
    isActive: Boolean(row.is_active),
    metadata: parseJson(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroupPermission(row: any): RoleToolGroupPermissionRecord {
  return {
    id: row.id,
    role: row.role,
    groupId: row.group_id,
    scope: (row.scope ?? 'global') as ToolPermissionScope,
    allowed: Boolean(row.allowed),
    source: row.source ?? 'manual',
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at,
  };
}

function mapToolPermission(row: any): RoleToolPermissionRecord {
  return {
    id: row.id,
    role: row.role,
    toolId: row.tool_id,
    scope: (row.scope ?? 'global') as ToolPermissionScope,
    allowed: Boolean(row.allowed),
    reason: row.reason ?? null,
    source: row.source ?? 'manual',
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: any): ToolAccessAuditRecord {
  return {
    id: row.id,
    actor: row.actor,
    role: row.role,
    scope: (row.scope ?? 'global') as ToolPermissionScope,
    targetType: row.target_type,
    targetId: row.target_id,
    previousState: parseJson(row.previous_state),
    nextState: parseJson(row.next_state),
    createdAt: row.created_at,
  };
}

export function listToolGroups(): ToolGroupRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, description, sort_order, metadata, created_at, updated_at
       FROM tool_groups
       ORDER BY sort_order ASC, name ASC`,
    )
    .all();
  return rows.map(mapGroup);
}

export function upsertToolGroup(input: {
  id: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  metadata?: any | null;
}): ToolGroupRecord {
  const db = getDb();
  const params = {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    sort_order: input.sortOrder ?? 0,
    metadata: input.metadata === null || input.metadata === undefined ? null : JSON.stringify(input.metadata),
  };

  db.prepare(
    `INSERT INTO tool_groups (id, name, description, sort_order, metadata)
     VALUES (@id, @name, @description, @sort_order, @metadata)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       sort_order = excluded.sort_order,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
  ).run(params);

  const row = db
    .prepare(
      `SELECT id, name, description, sort_order, metadata, created_at, updated_at
       FROM tool_groups
       WHERE id = ?`,
    )
    .get(input.id);

  if (!row) {
    throw new Error(`Failed to upsert tool group ${input.id}`);
  }

  return mapGroup(row);
}

export function listToolDefinitions(includeInactive = false): ToolDefinitionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, group_id, name, description, is_active, metadata, created_at, updated_at
       FROM tool_definitions
       WHERE (? = 1) OR (is_active = 1)
       ORDER BY name ASC`,
    )
    .all(includeInactive ? 1 : 0);
  return rows.map(mapDefinition);
}

export function upsertToolDefinition(input: {
  id: string;
  groupId: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  metadata?: any | null;
}): ToolDefinitionRecord {
  const db = getDb();
  const params = {
    id: input.id,
    group_id: input.groupId,
    name: input.name,
    description: input.description ?? null,
    is_active: input.isActive === false ? 0 : 1,
    metadata: input.metadata === null || input.metadata === undefined ? null : JSON.stringify(input.metadata),
  };

  db.prepare(
    `INSERT INTO tool_definitions (id, group_id, name, description, is_active, metadata)
     VALUES (@id, @group_id, @name, @description, @is_active, @metadata)
     ON CONFLICT(id) DO UPDATE SET
       group_id = excluded.group_id,
       name = excluded.name,
       description = excluded.description,
       is_active = excluded.is_active,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
  ).run(params);

  const row = db
    .prepare(
      `SELECT id, group_id, name, description, is_active, metadata, created_at, updated_at
       FROM tool_definitions
       WHERE id = ?`,
    )
    .get(input.id);

  if (!row) {
    throw new Error(`Failed to upsert tool definition ${input.id}`);
  }

  return mapDefinition(row);
}

export function listRoleGroupPermissions(scope: ToolPermissionScope = 'global'): RoleToolGroupPermissionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, role, group_id, scope, allowed, source, updated_by, updated_at
       FROM role_tool_group_permissions
       WHERE scope = ?
       ORDER BY role ASC, group_id ASC`,
    )
    .all(scope);
  return rows.map(mapGroupPermission);
}

export function getRoleGroupPermission(role: string, groupId: string, scope: ToolPermissionScope = 'global'): RoleToolGroupPermissionRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, role, group_id, scope, allowed, source, updated_by, updated_at
       FROM role_tool_group_permissions
       WHERE role = ? AND group_id = ? AND scope = ?
       LIMIT 1`,
    )
    .get(role, groupId, scope);
  return row ? mapGroupPermission(row) : null;
}

export function listRoleToolPermissions(scope: ToolPermissionScope = 'global'): RoleToolPermissionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, role, tool_id, scope, allowed, reason, source, updated_by, updated_at
       FROM role_tool_permissions
       WHERE scope = ?
       ORDER BY role ASC, tool_id ASC`,
    )
    .all(scope);
  return rows.map(mapToolPermission);
}

export function getRoleToolPermission(role: string, toolId: string, scope: ToolPermissionScope = 'global'): RoleToolPermissionRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, role, tool_id, scope, allowed, reason, source, updated_by, updated_at
       FROM role_tool_permissions
       WHERE role = ? AND tool_id = ? AND scope = ?
       LIMIT 1`,
    )
    .get(role, toolId, scope);
  return row ? mapToolPermission(row) : null;
}

export function upsertRoleGroupPermission(input: {
  role: string;
  groupId: string;
  scope?: ToolPermissionScope;
  allowed: boolean;
  source?: string;
  updatedBy?: string | null;
}): RoleToolGroupPermissionRecord {
  const db = getDb();
  const id = randomUUID();
  const scope = input.scope ?? 'global';
  const params = {
    id,
    role: input.role,
    group_id: input.groupId,
    scope,
    allowed: input.allowed ? 1 : 0,
    source: input.source ?? 'manual',
    updated_by: input.updatedBy ?? null,
  };

  db.prepare(
    `INSERT INTO role_tool_group_permissions (id, role, group_id, scope, allowed, source, updated_by)
     VALUES (@id, @role, @group_id, @scope, @allowed, @source, @updated_by)
     ON CONFLICT(role, group_id, scope) DO UPDATE SET
       allowed = excluded.allowed,
       source = excluded.source,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
  ).run(params);

  const row = db
    .prepare(
      `SELECT id, role, group_id, scope, allowed, source, updated_by, updated_at
       FROM role_tool_group_permissions
       WHERE role = ? AND group_id = ? AND scope = ?`,
    )
    .get(input.role, input.groupId, scope);

  if (!row) {
    throw new Error(`Failed to upsert role tool group permission for ${input.role}/${input.groupId}`);
  }

  return mapGroupPermission(row);
}

export function deleteRoleGroupPermission(role: string, groupId: string, scope: ToolPermissionScope = 'global'): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM role_tool_group_permissions
       WHERE role = ? AND group_id = ? AND scope = ?`,
    )
    .run(role, groupId, scope);
  return Number(result.changes ?? 0) > 0;
}

export function upsertRoleToolPermission(input: {
  role: string;
  toolId: string;
  scope?: ToolPermissionScope;
  allowed: boolean;
  reason?: string | null;
  source?: string;
  updatedBy?: string | null;
}): RoleToolPermissionRecord {
  const db = getDb();
  const id = randomUUID();
  const scope = input.scope ?? 'global';
  const params = {
    id,
    role: input.role,
    tool_id: input.toolId,
    scope,
    allowed: input.allowed ? 1 : 0,
    reason: input.reason ?? null,
    source: input.source ?? 'manual',
    updated_by: input.updatedBy ?? null,
  };

  db.prepare(
    `INSERT INTO role_tool_permissions (id, role, tool_id, scope, allowed, reason, source, updated_by)
     VALUES (@id, @role, @tool_id, @scope, @allowed, @reason, @source, @updated_by)
     ON CONFLICT(role, tool_id, scope) DO UPDATE SET
       allowed = excluded.allowed,
       reason = excluded.reason,
       source = excluded.source,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
  ).run(params);

  const row = db
    .prepare(
      `SELECT id, role, tool_id, scope, allowed, reason, source, updated_by, updated_at
       FROM role_tool_permissions
       WHERE role = ? AND tool_id = ? AND scope = ?`,
    )
    .get(input.role, input.toolId, scope);

  if (!row) {
    throw new Error(`Failed to upsert role tool permission for ${input.role}/${input.toolId}`);
  }

  return mapToolPermission(row);
}

export function deleteRoleToolPermission(role: string, toolId: string, scope: ToolPermissionScope = 'global'): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM role_tool_permissions
       WHERE role = ? AND tool_id = ? AND scope = ?`,
    )
    .run(role, toolId, scope);
  return Number(result.changes ?? 0) > 0;
}

export function insertToolAccessAudit(input: {
  actor: string;
  role: string;
  scope?: ToolPermissionScope;
  targetType: 'group' | 'tool';
  targetId: string;
  previousState?: any | null;
  nextState?: any | null;
}): ToolAccessAuditRecord {
  const db = getDb();
  const id = randomUUID();
  const scope = input.scope ?? 'global';
  const params = {
    id,
    actor: input.actor,
    role: input.role,
    scope,
    target_type: input.targetType,
    target_id: input.targetId,
    previous_state:
      input.previousState === null || input.previousState === undefined ? null : JSON.stringify(input.previousState),
    next_state: input.nextState === null || input.nextState === undefined ? null : JSON.stringify(input.nextState),
  };

  db.prepare(
    `INSERT INTO tool_access_audit (id, actor, role, scope, target_type, target_id, previous_state, next_state)
     VALUES (@id, @actor, @role, @scope, @target_type, @target_id, @previous_state, @next_state)`,
  ).run(params);

  const row = db
    .prepare(
      `SELECT id, actor, role, scope, target_type, target_id, previous_state, next_state, created_at
       FROM tool_access_audit
       WHERE id = ?`,
    )
    .get(id);

  if (!row) {
    throw new Error('Failed to insert tool access audit record');
  }

  return mapAudit(row);
}

export function listToolAccessAudit(limit = 100, offset = 0): ToolAccessAuditRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, actor, role, scope, target_type, target_id, previous_state, next_state, created_at
       FROM tool_access_audit
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  return rows.map(mapAudit);
}

export function getPermissionsVersion(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT MAX(updated_at) AS version
       FROM (
         SELECT updated_at FROM role_tool_group_permissions
         UNION ALL
         SELECT updated_at FROM role_tool_permissions
       )`,
    )
    .get() as { version?: string | null } | undefined;
  if (!row || !row.version) {
    return 0;
  }
  const ts = Date.parse(row.version);
  return Number.isNaN(ts) ? 0 : Math.floor(ts / 1000);
}
