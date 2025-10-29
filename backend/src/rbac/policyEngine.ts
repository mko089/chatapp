import type { AuthContext } from '../auth/context.js';
import { config } from '../config.js';
import type { NamespacedToolDefinition } from '../mcp/manager.js';

interface RolePolicy {
  name: string;
  description?: string;
  inherits?: string[];
  allowedModels?: string[];
  deniedModels?: string[];
  allowedServers?: string[];
  deniedServers?: string[];
  allowedTools?: string[];
  deniedTools?: string[];
}

const ROLE_POLICIES: Record<string, RolePolicy> = {
  owner: {
    name: 'owner',
    allowedModels: ['*'],
    allowedServers: ['*'],
    allowedTools: ['*'],
  },
  admin: {
    name: 'admin',
    inherits: ['owner'],
  },
  manager: {
    name: 'manager',
    allowedModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
    allowedServers: ['meters', 'employee', 'garden', 'fincost', 'datetime'],
    deniedTools: [
      '*_delete_*',
      '*_full_*',
      '*_payoff*',
      '*_sync_*',
      '*_create_*',
    ],
  },
  analyst: {
    name: 'analyst',
    allowedModels: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini'],
    allowedServers: ['meters', 'employee', 'garden', 'datetime'],
    deniedTools: [
      '*_set_*',
      '*_update_*',
      '*_delete_*',
      '*_create_*',
      '*_add_*',
      '*_sync_*',
      '*_full_*',
      '*_payoff*',
    ],
  },
  viewer: {
    name: 'viewer',
    allowedModels: ['gpt-5-nano', 'gpt-4.1-nano', 'gpt-4o-mini'],
    allowedServers: ['garden', 'meters', 'datetime'],
    deniedTools: [
      '*_set_*',
      '*_update_*',
      '*_delete_*',
      '*_create_*',
      '*_add_*',
      '*_sync_*',
      '*_full_*',
      '*_payoff*',
    ],
  },
};

type WildcardPattern = string;

export interface EffectivePermissions {
  allowAllModels: boolean;
  denyAllModels: boolean;
  allowedModelPatterns: WildcardPattern[];
  deniedModelPatterns: WildcardPattern[];
  allowAllServers: boolean;
  denyAllServers: boolean;
  allowedServerPatterns: WildcardPattern[];
  deniedServerPatterns: WildcardPattern[];
  allowAllTools: boolean;
  denyAllTools: boolean;
  allowedToolPatterns: WildcardPattern[];
  deniedToolPatterns: WildcardPattern[];
  appliedRoles: string[];
}

const ALLOW_ALL_PERMISSIONS: EffectivePermissions = {
  allowAllModels: true,
  denyAllModels: false,
  allowedModelPatterns: ['*'],
  deniedModelPatterns: [],
  allowAllServers: true,
  denyAllServers: false,
  allowedServerPatterns: ['*'],
  deniedServerPatterns: [],
  allowAllTools: true,
  denyAllTools: false,
  allowedToolPatterns: ['*'],
  deniedToolPatterns: [],
  appliedRoles: ['*'],
};

const DENY_ALL_PERMISSIONS: EffectivePermissions = {
  allowAllModels: false,
  denyAllModels: true,
  allowedModelPatterns: [],
  deniedModelPatterns: ['*'],
  allowAllServers: false,
  denyAllServers: true,
  allowedServerPatterns: [],
  deniedServerPatterns: ['*'],
  allowAllTools: false,
  denyAllTools: true,
  allowedToolPatterns: [],
  deniedToolPatterns: ['*'],
  appliedRoles: [],
};

interface PermissionAccumulator {
  allowAllModels: boolean;
  denyAllModels: boolean;
  allowedModels: Set<string>;
  deniedModels: Set<string>;
  allowAllServers: boolean;
  denyAllServers: boolean;
  allowedServers: Set<string>;
  deniedServers: Set<string>;
  allowAllTools: boolean;
  denyAllTools: boolean;
  allowedTools: Set<string>;
  deniedTools: Set<string>;
  appliedRoles: Set<string>;
}

function createAccumulator(): PermissionAccumulator {
  return {
    allowAllModels: false,
    denyAllModels: false,
    allowedModels: new Set(),
    deniedModels: new Set(),
    allowAllServers: false,
    denyAllServers: false,
    allowedServers: new Set(),
    deniedServers: new Set(),
    allowAllTools: false,
    denyAllTools: false,
    allowedTools: new Set(),
    deniedTools: new Set(),
    appliedRoles: new Set(),
  };
}

function mergePatterns(target: PermissionAccumulator, policy: RolePolicy, visited: Set<string>) {
  if (visited.has(policy.name)) {
    return;
  }
  visited.add(policy.name);
  target.appliedRoles.add(policy.name);

  applyList(policy.allowedModels, (value) => {
    if (value === '*') {
      target.allowAllModels = true;
    } else {
      target.allowedModels.add(value);
    }
  });
  applyList(policy.deniedModels, (value) => {
    if (value === '*') {
      target.denyAllModels = true;
    } else {
      target.deniedModels.add(value);
    }
  });

  applyList(policy.allowedServers, (value) => {
    if (value === '*') {
      target.allowAllServers = true;
    } else {
      target.allowedServers.add(value);
    }
  });
  applyList(policy.deniedServers, (value) => {
    if (value === '*') {
      target.denyAllServers = true;
    } else {
      target.deniedServers.add(value);
    }
  });

  applyList(policy.allowedTools, (value) => {
    if (value === '*') {
      target.allowAllTools = true;
    } else {
      target.allowedTools.add(value);
    }
  });
  applyList(policy.deniedTools, (value) => {
    if (value === '*') {
      target.denyAllTools = true;
    } else {
      target.deniedTools.add(value);
    }
  });

  for (const parent of policy.inherits ?? []) {
    const parentPolicy = ROLE_POLICIES[parent];
    if (parentPolicy) {
      mergePatterns(target, parentPolicy, visited);
    }
  }
}

function applyList(values: string[] | undefined, fn: (value: string) => void) {
  if (!values) {
    return;
  }
  for (const entry of values) {
    if (!entry || entry.trim().length === 0) {
      continue;
    }
    fn(entry.trim().toLowerCase());
  }
}

export function normalizeRoleName(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  const withoutPrefix = lowered.replace(/^role[_:\-]/, '');
  const segments = withoutPrefix.split(/[\/:]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : withoutPrefix;
}

function finalizeAccumulator(state: PermissionAccumulator): EffectivePermissions {
  const normalize = (set: Set<string>) => Array.from(set).sort();
  const normalizeRoles = (set: Set<string>) => Array.from(set).sort();

  return {
    allowAllModels: state.allowAllModels,
    denyAllModels: state.denyAllModels,
    allowedModelPatterns: state.allowAllModels ? ['*'] : normalize(state.allowedModels),
    deniedModelPatterns: state.denyAllModels ? ['*'] : normalize(state.deniedModels),
    allowAllServers: state.allowAllServers,
    denyAllServers: state.denyAllServers,
    allowedServerPatterns: state.allowAllServers ? ['*'] : normalize(state.allowedServers),
    deniedServerPatterns: state.denyAllServers ? ['*'] : normalize(state.deniedServers),
    allowAllTools: state.allowAllTools,
    denyAllTools: state.denyAllTools,
    allowedToolPatterns: state.allowAllTools ? ['*'] : normalize(state.allowedTools),
    deniedToolPatterns: state.denyAllTools ? ['*'] : normalize(state.deniedTools),
    appliedRoles: normalizeRoles(state.appliedRoles),
  };
}

export function resolveEffectivePermissions(auth?: AuthContext): EffectivePermissions {
  if (!config.rbac.enabled) {
    return ALLOW_ALL_PERMISSIONS;
  }

  const providedRoles = (auth?.roles ?? []).map(normalizeRoleName).filter((role) => role.length > 0);
  const ownerCandidates = (config.rbac.ownerUsers ?? []).map((v) => v.toLowerCase());
  const adminCandidates = (config.rbac.adminUsers ?? []).map((v) => v.toLowerCase());
  const identityHints = [auth?.email, auth?.username, auth?.sub].filter((v): v is string => typeof v === 'string' && v.length > 0).map((v) => v.toLowerCase());

  const specialRoles: string[] = [];
  if (identityHints.some((hint) => ownerCandidates.includes(hint))) {
    specialRoles.push('owner');
  } else if (identityHints.some((hint) => adminCandidates.includes(hint))) {
    specialRoles.push('admin');
  }

  if (specialRoles.length > 0) {
    providedRoles.push(...specialRoles);
  }
  const dedupedRoles = Array.from(new Set(providedRoles));

  if (dedupedRoles.length === 0) {
    if (config.rbac.unauthenticatedMode === 'allow') {
      return ALLOW_ALL_PERMISSIONS;
    }
    if (config.rbac.unauthenticatedMode === 'deny') {
      return DENY_ALL_PERMISSIONS;
    }
  }

  const accumulator = createAccumulator();
  const rolesToApply = dedupedRoles.length > 0 ? dedupedRoles : config.rbac.defaultRoles.map(normalizeRoleName);
  const fallbackRoles = (config.rbac.fallbackRoles ?? []).map(normalizeRoleName);
  const combinedRoles = Array.from(new Set([...rolesToApply, ...fallbackRoles].filter((role) => role.length > 0)));

  let appliedAnyPolicy = false;
  for (const role of combinedRoles) {
    const policy = ROLE_POLICIES[role];
    if (!policy) {
      continue;
    }
    appliedAnyPolicy = true;
    mergePatterns(accumulator, policy, new Set());
  }

  if (!appliedAnyPolicy) {
    if (config.rbac.unauthenticatedMode === 'deny') {
      return DENY_ALL_PERMISSIONS;
    }
    return ALLOW_ALL_PERMISSIONS;
  }

  return finalizeAccumulator(accumulator);
}

export function isModelAllowed(model: string, permissions: EffectivePermissions): boolean {
  if (permissions.denyAllModels) {
    return false;
  }
  const normalized = model.toLowerCase();
  if (matchesAny(normalized, permissions.deniedModelPatterns)) {
    return false;
  }
  if (permissions.allowAllModels || permissions.allowedModelPatterns.length === 0) {
    return true;
  }
  return matchesAny(normalized, permissions.allowedModelPatterns);
}

export function isServerAllowed(serverId: string, permissions: EffectivePermissions): boolean {
  if (permissions.denyAllServers) {
    return false;
  }
  const normalized = serverId.toLowerCase();
  if (matchesAny(normalized, permissions.deniedServerPatterns)) {
    return false;
  }
  if (permissions.allowAllServers || permissions.allowedServerPatterns.length === 0) {
    return true;
  }
  return matchesAny(normalized, permissions.allowedServerPatterns);
}

export function isToolAllowed(toolName: string, serverId: string, permissions: EffectivePermissions): boolean {
  if (permissions.denyAllTools) {
    return false;
  }
  const normalizedTool = toolName.toLowerCase();
  const normalizedComposite = `${serverId.toLowerCase()}_${normalizedTool}`;
  if (matchesAny(normalizedTool, permissions.deniedToolPatterns) || matchesAny(normalizedComposite, permissions.deniedToolPatterns)) {
    return false;
  }
  if (permissions.allowAllTools || permissions.allowedToolPatterns.length === 0) {
    return true;
  }
  return (
    matchesAny(normalizedTool, permissions.allowedToolPatterns) ||
    matchesAny(normalizedComposite, permissions.allowedToolPatterns)
  );
}

export function filterToolsByPermissions(
  tools: NamespacedToolDefinition[],
  permissions: EffectivePermissions,
): NamespacedToolDefinition[] {
  if (permissions.allowAllTools && !permissions.denyAllTools && permissions.deniedToolPatterns.length === 0) {
    return tools;
  }
  return tools.filter((tool) =>
    isServerAllowed(tool.serverId, permissions) && isToolAllowed(tool.name, tool.serverId, permissions),
  );
}

function matchesAny(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '*') {
      return true;
    }
    if (wildcardMatch(value, pattern)) {
      return true;
    }
  }
  return false;
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(value);
}
