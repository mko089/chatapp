# Architektura — ChatAPI (MCP meters + employee)

## Komponenty
- MCP Manager — inicjuje i utrzymuje połączenie z serwerami MCP (`meters`, `employee` via stdio lub ws/wss), agreguje tools/resources oraz filtruje narzędzia (allowlist/blacklist).
- Tool Registry — eksportuje narzędzia do LLM (namespacing `meters.*`, JSON Schema → parameters).
- Chat Orchestrator — pętla tool‑calling: LLM → tool_call → MCP → wynik jako wiadomość `tool` → LLM.
- REST API — `/mcp/*`, `/chat`; opcjonalnie SSE/WebSocket do streamingu odpowiedzi.

## Przepływ
1) UI wysyła `POST /chat` z historią.
2) Backend buduje listę `tools` z MCP i wywołuje model.
3) Model zwraca `tool_call` (np. `meters.meters_daily_consumption`, `employee.employee_list_default_positions`).
4) Backend woła MCP Manager → `call(tool,args)` i dostaje wynik JSON/Text.
5) Backend dopisuje wiadomość `tool` do historii i ponawia wywołanie modelu.
6) Gdy brak kolejnych `tool_call`, zwraca finalną odpowiedź do UI.

## Bezpieczeństwo
- Model nie ma dostępu do sieci/LAN — wszystkie wywołania wykonuje backend.
- Timeouty i limity rozmiaru odpowiedzi narzędzi, sanitizacja logów (maskowanie sekretów).
- Następny etap: Keycloak (Bearer), role per tool/server, approvals dla operacji modyfikujących.

## Uwagi wdrożeniowe
- Topologia: `chatapi` w tej samej sieci/VPN co MCP `meters`/`employee`.
- Połączenia do LLM tylko wychodzące HTTPS.
- Dla dużych wyników: używamy zasobów MCP i endpointu `/mcp/resources/read` zamiast wklejać wszystko do modelu.
