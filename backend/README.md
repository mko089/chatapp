# ChatAPI — MVP chatu z MCP (meters)

Serwis backendowy (Node/TypeScript), który mostkuje rozmowę z LLM do serwerów MCP w sieci (LAN/VPN) i lokalnie. MVP integruje serwer MCP `meters` i wystawia proste endpointy do listowania i wywoływania narzędzi oraz sesję chatu z tool‑calling.

## Szybki start (MVP)
- Wymagania: Docker + Docker Compose, lokalne repozytorium z `metersapp`.
- Skonfiguruj `mcp.config.json` na bazie `mcp.config.example.json` (domyślnie wskazuje na `../metersapp/apps/meters-mcp/run.sh`).
- Uzupełnij `.env` na bazie `.env.example` (klucz do LLM jest wymagany dla `/chat`).

Dev (hot-reload):

```bash
cd chatapp
./scripts/dev-up.sh
# lub przez LAN (host zamiast localhost):
CHATAPP_HOST=192.168.14.55 ./scripts/dev-up-lan.sh
```

Prod (kompilacja + start bez watch):

```bash
cd chatapp
docker compose -f docker-compose.prod.yml up --build
```

Staging (prod-like, porty 3525/3725):

```bash
cd chatapp
docker compose -f docker-compose.staging.yml up --build
```

Porty i nazwy projektów:
- Dev: backend `http://localhost:4025`, frontend Vite `http://localhost:4225` (Compose project: `chatapp-dev`).
- Staging: backend `http://localhost:3525`, frontend preview `http://localhost:3725` (Compose project: `chatapp-staging`).
- Prod: backend host `http://localhost:3025`, frontend host `http://localhost:3225` (wewnątrz kontenera preview działa na `4173`), Compose project: `chatapp-prod`.


Bazy danych:
- Dev: SQLite `backend/data/chatapp-dev.sqlite`.
- Staging: SQLite `backend/data/chatapp-staging.sqlite` (zob. `.env.staging.example`).
- Prod: SQLite `backend/data/chatapp-prod.sqlite`.

## Struktura
- `src/` — implementacja (MCP manager, routery `/mcp/*`, `/chat`)
- `docs/` — plan MVP, architektura, spec API, integracja `meters`
- `mcp.config.example.json` — przykład konfiguracji serwerów MCP
- `.env.example` — wymagane zmienne środowiskowe
- Kontrola dostępu: w `.env` ustaw `ALLOWED_IPS` (domyślnie biała lista `192.168.2.145,192.168.4.170` w dev i prod), żądania z innych adresów są odrzucane kodem 403.
- Sesje zapisywane są w `backend/data/sessions/<id>.json`; frontend i API korzystają z parametru `sessionId`, a `GET /sessions/:id` pozwala wczytać historię.

## Endpoints (MVP)
- `GET /mcp/tools` — lista narzędzi z MCP (namespaced: `meters.*`)
- `GET /mcp/resources` — zbiorcza lista zasobów (jeśli serwer je udostępnia)
- `GET /mcp/resources/read?uri=...` — odczyt zasobu
- `POST /chat` — pętla chat+tool‑calling (obsługuje `meters.*`)

Szczegóły i przykłady: `docs/API_SPEC.md`.

## Zgody i bezpieczeństwo
- Tryb MVP: domyślnie bez eskalacji; możliwość włączenia modali zgód po stronie UI przy narzędziach "modyfikujących" (następny etap).
- Połączenia do MCP realizuje backend; model nie ma dostępu do sieci/LAN.

## Readiness i metryki

- `GET /health` — szybki status usług (MCP/LLM/RBAC) i flag.
- `GET /ready` — gotowość (DB + MCP zainicjalizowane), 200 gdy backend jest gotowy na ruch.
- `GET /metrics` — eksport Prometheus (text/plain), m.in.:
  - `http_requests_total{method,route,status}`
  - `http_request_duration_ms` (histogram)
  - `mcp_tool_invocations_total{tool,status}`
  - `llm_requests_total{model,status}`

## Rate limiting

W trybie LAN włączony jest prosty limit dla metod mutujących (POST/PUT/PATCH/DELETE):

- 10 żądań na 10 sekund per IP (odpowiedź 429 przy przekroczeniu).
- Celem jest ochrona przed podwójnymi kliknięciami/retry i lokalnym floodem.

Nagłówki zwracane dla metod mutujących (POST/PUT/PATCH/DELETE):

- `X-RateLimit-Limit`: maksymalna liczba żądań w oknie.
- `X-RateLimit-Remaining`: pozostałe żądania do końca okna.
- `X-RateLimit-Reset`: czas końca okna (epoch, sekundy).
- Przy 429 dodatkowo `Retry-After` (sekundy do końca okna) i body `{ error: "Too Many Requests", code: "rate_limit.exceeded" }`.

## Idempotency-Key (POST create)

Tworzenie projektu (`POST /projects`) obsługuje `Idempotency-Key`:

- Zakres: per `accountId` i `scope=projects:create`, TTL ok. 15 min.
- Taki sam klucz + identyczne body → replay poprzedniej odpowiedzi (`Idempotent-Replay: true`).
- Taki sam klucz + inne body → 409 `idempotency_conflict`.

## Circuit Breaker i Retry (Faza 2)

- LLM i MCP chronione prostym breakerem:
  - LLM: klucz `llm` (globalny), retry tylko dla błędów przejściowych (5xx, ECONNRESET/timeout/network).
  - MCP: breaker per serwer (`mcp:<serverId>`), 1 retry na błędy przejściowe.
- Backoff: wykładniczy (200→400→800 ms), ograniczony do ~0.8–1.0 s.
- Błędy stałe (4xx/validacja) nie są retry’owane.

## Notatki
- Docelowo: Keycloak (Bearer) i role per tool/server, audyt wywołań.
- Dla dużych wyników narzędzi: skrót + URI; pełne dane pobiera UI przez `/mcp/resources/read`.
