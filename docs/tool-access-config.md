# Tool Access Configuration – Proposed Data Model

## Context
- Current RBAC relies on hard-coded role policies in `src/rbac/policyEngine.ts`.
- Requirement: admin UI to manage access for tool groups and individual tools, with overrides.
- Goal: persist configuration in SQLite (Better SQLite3) so backend can enforce dynamic rules.

## Entities

### `tool_groups`
- `id TEXT PRIMARY KEY` – stable identifier (e.g. `employee_management`).
- `name TEXT NOT NULL` – display name for admin UI.
- `description TEXT` – optional helper text.
- `sort_order INTEGER NOT NULL DEFAULT 0` – ordering in UI.
- `metadata TEXT` – JSON for future flags (e.g. color, icon).
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`

### `tool_definitions`
- `id TEXT PRIMARY KEY` – unique tool identifier (`employee.employee_list_attendances`).
- `group_id TEXT NOT NULL REFERENCES tool_groups(id) ON DELETE CASCADE`
- `name TEXT NOT NULL` – human readable label.
- `description TEXT` – optional helper text.
- `is_active INTEGER NOT NULL DEFAULT 1` – allow hiding legacy tools.
- `metadata TEXT` – JSON for extra attributes (e.g. category, icon).
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **Note**: table is populated from MCP registry at boot; admin UI can display but not edit structural data (future work may allow).

### `role_tool_group_permissions`
- `id TEXT PRIMARY KEY`
- `role TEXT NOT NULL` – normalized lowercase role name.
- `group_id TEXT NOT NULL REFERENCES tool_groups(id) ON DELETE CASCADE`
- `scope TEXT NOT NULL DEFAULT 'global'` – future extension (account-specific overrides).
- `allowed INTEGER NOT NULL CHECK (allowed IN (0,1))`
- `source TEXT NOT NULL DEFAULT 'manual'` – to distinguish seeds/imports.
- `updated_by TEXT` – admin identifier (user ID/email).
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `UNIQUE(role, group_id, scope)`

### `role_tool_permissions`
- `id TEXT PRIMARY KEY`
- `role TEXT NOT NULL`
- `tool_id TEXT NOT NULL REFERENCES tool_definitions(id) ON DELETE CASCADE`
- `scope TEXT NOT NULL DEFAULT 'global'`
- `allowed INTEGER NOT NULL CHECK (allowed IN (0,1))`
- `reason TEXT` – optional justification shown in UI tooltip.
- `source TEXT NOT NULL DEFAULT 'manual'`
- `updated_by TEXT`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `UNIQUE(role, tool_id, scope)`
- **Semantics**:
  - When no row exists, permission inherits from group-level entry (if any).
  - Overrides are evaluated after group permissions when computing effective policies.

### `tool_access_audit`
- `id TEXT PRIMARY KEY`
- `actor TEXT NOT NULL`
- `role TEXT NOT NULL`
- `scope TEXT NOT NULL`
- `target_type TEXT NOT NULL CHECK (target_type IN ('group','tool'))`
- `target_id TEXT NOT NULL`
- `previous_state TEXT` – JSON snapshot before change.
- `next_state TEXT` – JSON snapshot after change.
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`

## Migration Outline
1. Add new tables (`tool_groups`, `tool_definitions`, `role_tool_group_permissions`, `role_tool_permissions`, `tool_access_audit`).
2. Seed `tool_groups` + `tool_definitions`:
   - Derive from existing MCP server metadata (`config.mcp.tools`); fallback to grouping by namespace.
   - Provide post-migration script to import static defaults from current `ROLE_POLICIES`.
3. Update `ROLE_POLICIES` usage to read from DB:
   - Replace hard-coded arrays with loader that
     1. Loads all active roles from config (for fallback).
     2. Uses `role_tool_group_permissions` and `role_tool_permissions` to build allow/deny lists.
   - Preserve wildcard support by storing literal `*` as `group_id`/`tool_id` when needed (optional extension).

## Considerations
- **Performance**: store computed hash/version of permissions to cache in memory; invalidate when `updated_at` changes.
- **Integrity**: triggers (or manual updates) to bump `updated_at` and maintain audit trail.
- **Future scopes**: `scope` column supports account-specific overrides (`account:<id>`), enabling tenants later.
- **Backwards compatibility**: fallback to default policies if tables empty (bootstrap state).

## Next Steps
- Confirm role normalization rules (reuse `normalizeRoleName`).
- Decide on initial grouping taxonomy and seeding process.
- Plan API contract returning matrix-ready payload (`roles × groups + overrides`).

---

# API & Backend Architecture Proposal

## REST Endpoints

### `GET /admin/tool-access`
- **Auth**: requires role `admin` or higher (configurable constant).
- **Query params**: `scope?`, `role?`, `includeInactive?`.
- **Response shape**:
  ```json
  {
    "roles": ["owner", "admin", "manager", "analyst", "viewer"],
    "groups": [
      {
        "id": "employee",
        "name": "Kadromierz",
        "description": "Kadromierz narzędzia",
        "tools": [
          {
            "id": "employee.employee_list_attendances",
            "name": "Lista obecności",
            "allowed": true,
            "inherited": true
          }
        ],
        "permission": {
          "allowed": true,
          "source": "manual",
          "updatedBy": "admin@example.com",
          "updatedAt": "2024-05-19T12:45:00Z"
        }
      }
    ],
    "overrides": [
      {
        "role": "manager",
        "toolId": "employee.employee_update_condition",
        "allowed": false,
        "reason": "Edycja tylko dla HR",
        "updatedBy": "hr@example.com",
        "updatedAt": "2024-05-19T12:50:00Z"
      }
    ],
    "version": "1716126000" // unix timestamp for optimistic locking
  }
  ```

### `PATCH /admin/tool-access`
- **Auth**: same requirement.
- **Request body**:
  ```json
  {
    "changes": [
      {
        "type": "group",
        "role": "manager",
        "targetId": "employee",
        "allowed": false
      },
      {
        "type": "tool",
        "role": "manager",
        "targetId": "employee.employee_create_condition",
        "allowed": false,
        "reason": "Tylko HR"
      }
    ],
    "version": "1716126000"
  }
  ```
- **Behaviour**:
  - Reject with `409 Conflict` if `version` < latest `updated_at` across modified rows.
  - Apply updates in a transaction.
  - Write entries to `tool_access_audit`.
  - Invalidate in-memory permission cache.

### `GET /admin/tool-access/audit`
- Optional; supports pagination/time range filter.
- Useful for compliance view from UI.

## Services

### `toolCatalogService`
- Source of truth for `tool_groups` and `tool_definitions`.
- Synchronises with MCP manifest on boot.
- Exposes `getToolGroups()` returning nested structure for UI.

### `toolPermissionService`
- Responsibilities:
  - `getMatrix(scope?: string)` → aggregated response for GET.
  - `applyChanges(changes, actor, version)` → handles PATCH.
  - `computeEffectivePermissions(authContext)` → used by RBAC middleware, replacing static `ROLE_POLICIES`.
  - `getVersion()` → max `updated_at` for caching.
- Implementation details:
  - Cache map `{role -> {allow: Set, deny: Set}}` with TTL or version check.
  - Use `normalizeRoleName` for input.
  - Combine group-level entry (`role_tool_group_permissions`) with tool overrides (`role_tool_permissions`).
  - When no explicit group entry exists, fall back to `config.rbac.defaults`.

### `rbacAdapter`
- Facade used by existing `policyEngine`.
- Steps:
  1. Build base policy from config (owner/admin wildcards).
  2. Merge DB-driven allow/deny sets.
  3. Support wildcard matching via conversion to glob patterns (e.g. group deny -> `group.*` tool pattern).

## Validation Rules
- Disallow conflicting entries (same role + tool with both allow/deny in payload).
- Prevent revoking access to core admin tools for `owner` (enforced server-side).
- Ensure `role` exists in allowlist defined in config to avoid typos.
- `reason` optional but trimmed to 200 chars.

## Error Handling
- `400` for validation errors (list of issues).
- `403` when caller lacks admin role.
- `409` on stale version.
- `500` with error code + log correlation id.

## Testing Strategy
- Unit: `toolPermissionService` (inheritance logic).
- Integration: API tests using in-memory SQLite.
- Permission regression: update existing chat/tool invocation tests to pull from new service.

---

# Admin UI Sketch

## Page Layout
1. **Header** – breadcrumb (`Administracja / Dostępy narzędzi`), refresh button, last sync timestamp, environment badge.
2. **Filters Bar**:
   - Role selector (multi-select, defaults to all).
   - Search input for tool/group names.
   - Toggle to show only overrides.
3. **Matrix Grid**:
   - Left column: list of roles or users (sticky).
   - Top row: tool groups (sticky columns).
   - Cell states:
     - `Allowed` (green background icon).
     - `Blocked` (red).
     - `Inherited` (grey outline) – displays tooltip with source.
     - `Mixed` (yellow stripe) when overrides inside group diverge.
   - Clicking cell opens side drawer.
4. **Side Drawer**:
   - Title: `Manager → Kadromierz`.
   - Group-level switch (`Allow group for Manager`).
   - List of tools with individual toggles.
   - `Apply` / `Revert` buttons; unsaved change indicator.
5. **Audit Panel** (optional tab) – paginated list of recent changes.

## React Components
- `AdminToolAccessPage` – fetches data, handles optimistic responses.
- `AccessMatrix` – virtualised grid for performance (use `react-virtualized` or CSS grid with overflow).
- `MatrixCell` – renders status icons, handles click.
- `PermissionDrawer` – shows details and controls, accepts `onSubmit`.
- `OverrideBadge` – pill indicating tool-level override.
- `AuditTimeline` – optional component reusing existing timeline styles.

## State Management
- `useQuery` (React Query) for GET endpoint with `version` in metadata.
- Local `useReducer` to track pending changes `{ key: string; allowed: boolean; reason?: string }`.
- Undo/redo stack (simple array).
- Disable submit if no changes; show conflict modal when PATCH returns 409.

## UX Details
- Keyboard navigation (arrow keys within matrix).
- Status legend pinned to bottom-right.
- Confirmation dialog for bulk disable with count summary.
- Toast notifications on success/failure (reuse existing system).
- Loading skeleton: shimmering rows/cols to show structure quickly.

## Accessibility
- Each toggle labelled for screen readers (`aria-label="Zezwól narzędzie Lista obecności dla roli Manager"`).
- Ensure sufficient contrast in matrix states (WCAG AA).
- Focus trap inside side drawer.

## Styling
- Extend Tailwind theme with semantic colors: `allow`, `deny`, `mixed`.
- Use CSS grid for header + matrix to keep columns aligned.
- Mobile fallback: collapse to accordion per role (phase 2).

---

# Implementation Roadmap

1. **Finalize Requirements**
   - Confirm list of roles visible in UI and whether per-user overrides are in scope.
   - Approve grouping taxonomy and initial allow matrix.
2. **Database Migration**
   - Implement migration v4 adding tables described above.
   - Seed groups/tools from MCP registry during migration or via bootstrap script.
   - Write integrity tests ensuring foreign keys and uniqueness.
3. **Backend Services**
   - Implement `toolCatalogService` + `toolPermissionService` with unit tests.
   - Replace static `ROLE_POLICIES` consumer with new adapter while preserving defaults.
   - Add admin routes under `/admin/tool-access` with Zod validation + integration tests.
4. **Frontend UI**
   - Scaffold route `src/pages/admin/ToolAccessPage.tsx`.
   - Build matrix view and drawer components; integrate React Query hooks.
   - Implement optimistic updates with rollback on 409.
   - Add e2e test (Playwright/Cypress) covering allow/deny toggle.
5. **Operational Tasks**
   - Extend auth middleware to gate new endpoints by admin role.
   - Wire audit log entries into existing logging pipeline.
   - Update documentation and runbook for admins.
6. **Rollout**
   - Deploy to staging with seed data; run regression on tool invocation flows.
   - Gather feedback from pilot admins.
   - Enable feature flag in production and monitor metrics.
