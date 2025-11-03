# Integracja — MCP `employee`

## Założenia
- Serwer MCP `employee` korzysta z API EmployeeApp (`EMPLOYEE_API_URL`, token opcjonalny `EMPLOYEE_API_TOKEN`). Lokalizacja skryptu można nadpisać zmienną `EMPLOYEE_MCP_PATH` (domyślnie `../EmployeeApp/apps/employee-mcp`).
- Domyślne środowisko dev: `http://192.168.14.55:4004` (LAN). Token można dopisać w `backend/mcp.config.json` lub przez zmienne środowiskowe.
- Narzędzia eksponowane w MVP są tylko do odczytu / prostych aktualizacji kadrowych.

## Narzędzia publikowane do modelu
- Konfiguracja nie ogranicza listy `allowedTools`, dzięki czemu pobieramy pełen katalog narzędzi z employee MCP.
- Dla bezpieczeństwa aktywny jest blacklist w `blockedTools` (domyślnie ukrywa operacje modyfikujące: `*_create_*`, `*_update_*`, `*_delete_*`, `*_upsert_*`, `*_patch_*`).
- Widoczne odczytowe narzędzia obejmują m.in.:
  - `employee_health`, `employee_list_employees`, `employee_get_employee`, `employee_list_locations`, `employee_list_conditions`;
  - raporty i agregaty: `employee_employees_costs`, `employee_dashboard`, `employee_activity_log`, `employee_list_attendances`, `employee_top_breaks`, `employee_sync_status`;
  - istniejące wcześniej defaulty stanowisk (`employee_set_default_position`, `employee_list_default_positions`, itd.).

Wyniki wracają jako JSON (string w treści), a UI pokazuje skrót + przycisk „Szczegóły”.

## Domyślne parametry wywołań
- Dla narzędzia `employee_employees_costs` backend uzupełnia brakujące argumenty:
  - `from` i `to` — bieżący dzień w strefie `Europe/Warsaw`;
  - `tz` — `Europe/Warsaw`;
  - `environment` — `prod`.
- Dzięki temu scenariusz „wywołaj” po zaproponowaniu domyślnych wartości skutkuje realnym wywołaniem, nawet gdy model nie przekaże argumentów w tool call.

## Diagnostyka
- `GET /mcp/tools` — powinno zwrócić narzędzia `employee_*` i `meters_*`.
- Log backendu: przy starcie `MCP manager` zarejestruje serwer `employee`; błędy stdio są logowane jako `Failed to initialise MCP server`.
- Test ręczny: wyślij wiadomość „Pokaż employee defaults dla 456132” — model powinien sięgnąć po `employee_list_default_positions`.
