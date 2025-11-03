# ChatApp monorepo (MVP meters)

Monorepo składające się z backendu (`backend/`, dawny `chatapi`) oraz frontendu (`frontend/`). Backend integruje serwer MCP `meters` i udostępnia REST API do obsługi chatu z tool-calling. Frontend (Vite + React) zapewnia prosty UI rozmowy i podgląd wyników narzędzi.

## Struktura katalogów
- `backend/` — serwis Fastify + OpenAI + MCP (ścieżki i dokumentacja w `backend/README.md`).
- `frontend/` — aplikacja Vite/React (UI chatu + lista narzędzi/wyników).
- `docs/` — plan MVP, architektura, integracja MCP.
- `docker-compose.yml` / `docker-compose.prod.yml` — uruchamianie środowiskowe.

## Uruchomienie

### Dev (watch + stdio MCP)
```bash
cd chatapp
./scripts/dev-up.sh
```

Gdy chcesz udostępnić UI z innego urządzenia w LAN (bez `localhost`):
```bash
cd chatapp
CHATAPP_HOST=192.168.14.55 ./scripts/dev-up-lan.sh
```

To polecenie:
- instaluje zależności monorepo (`npm install`),
- przygotowuje serwer MCP `meters` (`../metersapp/apps/meters-mcp`),
- startuje backend na porcie `4025` oraz frontend na porcie `4225` (lokalnie: `http://localhost`).
- używa osobnej bazy dla dev: plik SQLite `backend/data/chatapp-dev.sqlite`.
- Lean Auth (LAN): publiczny pozostaje tylko `GET /health`; wszystkie pozostałe ścieżki wymagają zalogowania (Keycloak). Operacje mutujące (POST/PUT/PATCH/DELETE) są dostępne wyłącznie dla roli `admin`/`owner`.

Przydatne:
- zatrzymanie: `./scripts/dev-down.sh`
- logi: `./scripts/dev-logs.sh`
- frontend zapisuje identyfikator sesji w URL (`?session=<uuid>`), a `GET /sessions/:id` pozwala wczytać rozmowę.

### Preflight (unikaj „cichej” złej konfiguracji)

Przed `docker compose up` uruchom szybki test konfiguracji:

```bash
cd chatapp
bash scripts/verify-dev.sh
```

Skrypt wypisze „resolved config” (runtime-config nadpisuje `.env` tylko niepustymi wartościami), sprawdzi dostępność Keycloak (OpenID discovery), a przy braku wymaganych pól przerwie z komunikatem co poprawić.

### Build-time guard (frontend)

Przed `vite build` działa hook, który wstrzyma build, jeśli `VITE_REQUIRE_AUTH=true`, a kluczowe pola Keycloak (url/realm/clientId) są puste po połączeniu runtime-config + `.env`.

```bash
cd chatapp/frontend
npm run build
```

W razie błędu popraw `chatapp/frontend/public/runtime-config.js` lub `chatapp/.env`.

### Prod (kompilacja + start)
```bash
cd chatapp
docker compose -f docker-compose.prod.yml up --build
```

- Dev i prod mają teraz różne nazwy projektu: dev = `chatapp-dev`, prod = `chatapp-prod` (zdefiniowane w `name:` w plikach Compose). Dzięki temu mogą działać równolegle.
- Upewnij się, że `OPENAI_API_KEY` jest ustawione (np. `export OPENAI_API_KEY=...`).
- Porty (host): backend `3025`, frontend `3225` (w kontenerze `vite preview` działa na `4173`). Domyślny adres LAN to `http://192.168.14.55`.
 - Prod używa osobnej bazy: plik SQLite `backend/data/chatapp-prod.sqlite`.
 - W produkcji włączone jest logowanie przez Keycloak; dostęp gości (bez tokena) jest zablokowany. Publiczny pozostaje tylko `GET /health` (możesz ograniczyć to dalej przez `AUTH_PUBLIC_PATHS`).

## Konfiguracja MCP / LLM
- `backend/mcp.config.json` — domyślnie wskazuje na `../metersapp/apps/meters-mcp/run.sh` i publikuje podstawowe narzędzia odczytowe (`meters_*`).
- `backend/.env` — klucz OpenAI (`OPENAI_API_KEY`) + ewentualne zmienne Keycloak w kolejnych etapach.

## Autoryzacja i konfiguracja (guardrails)

- Wymuszone logowanie: UI nie startuje bez sesji (ekran „Wymagane logowanie”).
- Brak floodu 401: wszystkie wywołania API wymagające tokenu startują dopiero po zalogowaniu.
- Priorytet konfiguracji: runtime-config (ConfigMap lub `public/runtime-config.js`) nadpisuje `.env` tylko niepustymi wartościami. Puste pola nie przykrywają `.env`.
- Diagnostyka: ekran logowania zawiera bieżące wartości (API base, Keycloak URL/realm/clientId) oraz link do bezpośredniego logowania Keycloak.

## Lean Auth (LAN) — standard

- Frontend łączy się bezpośrednio z API po IP:port (bez reverse proxy): `VITE_CHATAPI_URL=http://192.168.14.55:4025`.
- Keycloak włączony: `VITE_KEYCLOAK_ENABLED=true`, `VITE_REQUIRE_AUTH=true` (UI wymaga logowania).
- Backend weryfikuje JWT offline (JWKS, cache), publiczne wyłącznie `GET /health`.
- Role minimalne: `viewer` (odczyt) oraz `admin`/`owner` (mutacje + panele admina).
- Źródła ról: `realm_access.roles|groups` (domyślnie bez client roles).

### Smoke test (curl)

Zastąp `192.168.14.55` odpowiednim adresem hosta. Uzyskaj tokeny z Keycloak (zaloguj się w UI i skopiuj `access_token` lub użyj token endpointu KC jeśli dozwolony w środowisku).

```bash
BASE=http://192.168.14.55:4025
# wklej JWT
VIEWER_TOKEN="<JWT-viewer>"
ADMIN_TOKEN="<JWT-admin>"

# Public health (bez tokenu) — 200
curl -i "$BASE/health"

# Viewer: odczyt projektów — 200
curl -i -H "Authorization: Bearer $VIEWER_TOKEN" "$BASE/projects"

# Viewer: próba mutacji — 403
curl -i -X POST -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Projekt"}' "$BASE/projects"

# Admin: utworzenie projektu — 200
curl -i -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo"}' "$BASE/projects"

# Admin: zapis dokumentu — 200
curl -i -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"path":"index.html","html":"<h1>Hello</h1>"}' \
  "$BASE/projects/demo/doc"

# Viewer/Admin: pobranie dokumentu — 200
curl -i -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE/projects/demo/doc/index.html"
```

### Runtime-config (Kubernetes / Helm)

Chart udostępnia ConfigMap z `runtime-config.js`:

`deploy/helm/chatapp/templates/frontend-configmap.yaml` konfiguruje m.in.:

- `frontend.runtimeConfig.chatApiUrl`
- `frontend.runtimeConfig.requireAuth` (domyślnie: `true`)
- `frontend.runtimeConfig.keycloak.{enabled,url,realm,clientId,silentCheckSso}`

W `values.yaml` ustaw:

```yaml
frontend:
  runtimeConfig:
    requireAuth: true
    keycloak:
      enabled: true
      url: http://keycloak.auth:8080
      realm: garden
      clientId: chatapp-frontend
```

Pustych wartości nie podawaj — runtime nie nadpisze `.env` i build-time guard to wychwyci.

### Keycloak (redirects)

Dla dev (port 4225):

- Redirect URIs: `http://<DEV-IP>:4225/*`
- Web Origins: `http://<DEV-IP>:4225`

Weryfikacja (dev): `bash scripts/verify-dev.sh`.

## Metryki i Readiness

- `/ready` — status gotowości (DB + MCP zainicjalizowane).
- `/metrics` — Prometheus (tekstowy):
  - `http_requests_total{method,route,status}`
  - `http_request_duration_ms` (histogram)
  - `mcp_tool_invocations_total{tool,status}`
  - `llm_requests_total{model,status}`
- `/metrics/cost` — metryki domenowe wykorzystania kosztów/tokenów (JSON) z agregatami sesji/kont.

Szybki podgląd:
```bash
curl -s http://192.168.14.55:4025/ready
curl -s http://192.168.14.55:4025/metrics | head -n 40
```

## Idempotency-Key (POST create)

Operacje tworzące (np. `POST /projects`) obsługują nagłówek `Idempotency-Key`.

- Zakres: per `accountId` (z tokenu) i `scope` operacji (dla projektów: `projects:create`).
- TTL: ~15 minut (bufor odpowiedzi + status).
- Powtórka z tym samym kluczem i identycznym body: serwer zwraca poprzednią odpowiedź i nagłówek `Idempotent-Replay: true`.
- Powtórka z tym samym kluczem i innym body: `409 idempotency_conflict`.

Przykład:

```bash
BASE=http://192.168.14.55:4025
ADMIN_TOKEN="<JWT-admin>"

# Pierwsze utworzenie (buforuje odpowiedź dla klucza abc-123)
curl -i -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"name":"Demo"}' \
  "$BASE/projects"

# Powtórka — odpowiedź z bufora, Idempotent-Replay: true
curl -i -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"name":"Demo"}' \
  "$BASE/projects"

# Konflikt — ten sam klucz, inne body
curl -i -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"name":"Inne"}' \
  "$BASE/projects"
```

## Kolejne kroki
- Zaimplementować faktyczny frontend (Vite/React) i spięcie z `/chat`.
- Dodać obsługę approvals i autoryzacji.
- Dodać obsługę approvals i autoryzacji.
- Rozbudować Compose o kontener backendu meters API (obecnie oczekujemy działającego API pod `http://localhost:3003`).

## UI – podgląd kontekstu
- W nagłówku aplikacji wyświetlany jest chip z informacją o szacowanym wykorzystaniu
  kontekstu w bieżącej rozmowie: `Kontekst: użyte/limit (procent wolne)`.
- Estymata bazuje na długości wiadomości w historii (ok. 1 token ≈ 4 znaki)
  oraz prostym mapowaniu limitu kontekstu na podstawie nazwy modelu:
  dla modeli z sufiksem `nano` przyjmujemy 8192 tokeny, dla pozostałych 128k.
  Wartość jest orientacyjna – rzeczywisty limit może różnić się zależnie od dostawcy.
