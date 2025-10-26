# Integracja — MCP `meters`

## Założenia
- Serwer MCP `meters` jest dostępny lokalnie (stdio) lub w sieci (ws/wss).
- Narzędzia typowe: `meters_health`, `meters_metrics`, `meters_list_meters`, `meters_list_readings`, `meters_daily_consumption`, `meters_list_departments`, `meters_list_locations`; narzędzia modyfikujące (`*_create_*`, `*_update_*`, `*_delete_*`, `*_upsert_*`) pozostają poza zakresem MVP.

## Mapowanie do narzędzi chatu
- Narzędzia publikowane do modelu są namespacowane: `meters.<tool_name>`.
- Przykłady:
  - `meters.meters_daily_consumption { meterId: "woda-1", from: "2025-01-01", to: "2025-01-07", tz: "Europe/Warsaw" }`
  - `meters.meters_list_meters {}`
  - `meters.meters_list_readings { meterId: "woda-1", from: "2025-01-01T00:00:00Z", to: "2025-01-07T23:59:59Z", type: "state", granularity: "1h" }`

## Polityka i bezpieczeństwo
- W MVP publikujemy wyłącznie narzędzia odczytowe (read‑only) do modelu.
- Narzędzia modyfikujące (`*_create_*`, `*_update_*`, `*_delete_*`, `*_upsert_*`) są domyślnie wyłączone lub wymagają jawnej zgody użytkownika (approval) — etap następny.

## Diagnostyka
- `GET /mcp/tools` — weryfikacja ekspozycji narzędzi z MCP.
- Jeżeli serwer `meters` udostępnia zasoby (resources):
  - `GET /mcp/resources`
  - `GET /mcp/resources/read?uri=...`
