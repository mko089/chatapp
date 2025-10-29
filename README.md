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
- domyślnie w dev przepuszcza ruch z dowolnego IP (`ALLOWED_IPS=*`) i udostępnia publicznie `GET /health`, `GET /mcp/tools`, `GET /sessions`, `GET /metrics/cost`.

Przydatne:
- zatrzymanie: `./scripts/dev-down.sh`
- logi: `./scripts/dev-logs.sh`
- frontend zapisuje identyfikator sesji w URL (`?session=<uuid>`), a `GET /sessions/:id` pozwala wczytać rozmowę.

### Prod (kompilacja + start)
```bash
cd chatapp
docker compose -f docker-compose.prod.yml up --build
```

Upewnij się, że `OPENAI_API_KEY` jest ustawione (np. `export OPENAI_API_KEY=...`), bo Compose przekazuje je do kontenera. Backend nasłuchuje na `5055`, frontend na `4173` (`vite preview`). Domyślny adres LAN to `http://192.168.14.55`.

## Konfiguracja MCP / LLM
- `backend/mcp.config.json` — domyślnie wskazuje na `../metersapp/apps/meters-mcp/run.sh` i publikuje podstawowe narzędzia odczytowe (`meters_*`).
- `backend/.env` — klucz OpenAI (`OPENAI_API_KEY`) + ewentualne zmienne Keycloak w kolejnych etapach.

## Kolejne kroki
- Zaimplementować faktyczny frontend (Vite/React) i spięcie z `/chat`.
- Dodać obsługę approvals i autoryzacji.
- Dodać obsługę approvals i autoryzacji.
- Rozbudować Compose o kontener backendu meters API (obecnie oczekujemy działającego API pod `http://localhost:3003`).
