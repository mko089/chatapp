## API Error Codes (Org Standard)

Format: JSON `{ error: string, code: string, details?: any }`

### Common
- auth.unauthorized → 401 — Missing/invalid token
- auth.forbidden → 403 — Insufficient permissions
- rate_limit.exceeded → 429 — Too many requests
- internal.error → 500 — Internal error (generic)

### Projects
- projects.invalid_query → 400 — Invalid query parameters
- projects.invalid_payload → 400 — Invalid payload
- projects.invalid_id → 400 — Invalid identifier
- projects.not_found → 404 — Not found
- idempotency.conflict → 409 — Idempotency-Key reused with different payload

### MCP
- mcp.invalid_query → 400 — Invalid query parameters
- mcp.read_failed → 400 — Resource read failed
- mcp.forbidden → 403 — Access not permitted
- mcp.tool_call_failed → 400 — Tool call failed

### Admin (budgets/tool-access/llm-traces)
- admin.invalid_query → 400 — Invalid query parameters
- admin.invalid_scope_type → 400 — Invalid scope type
- admin.version_mismatch → 409 — Version mismatch
- admin.not_found → 404 — Not found

Uwaga: Kody są stabilne — preferuj automaty i mapowanie po `code`, a nie po treści `error`.
