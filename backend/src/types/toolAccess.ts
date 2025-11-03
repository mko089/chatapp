export type ToolPermissionScope = 'global';

export interface ToolGroupRecord {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  metadata: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDefinitionRecord {
  id: string;
  groupId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  metadata: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleToolGroupPermissionRecord {
  id: string;
  role: string;
  groupId: string;
  scope: ToolPermissionScope;
  allowed: boolean;
  source: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RoleToolPermissionRecord {
  id: string;
  role: string;
  toolId: string;
  scope: ToolPermissionScope;
  allowed: boolean;
  reason: string | null;
  source: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ToolAccessAuditRecord {
  id: string;
  actor: string;
  role: string;
  scope: ToolPermissionScope;
  targetType: 'group' | 'tool';
  targetId: string;
  previousState: any | null;
  nextState: any | null;
  createdAt: string;
}

export interface ToolAccessChangeDescriptor {
  type: 'group' | 'tool';
  role: string;
  targetId: string;
  scope?: ToolPermissionScope;
  allowed?: boolean | null;
  reason?: string | null;
  updatedBy?: string | null;
}
