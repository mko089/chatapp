# ChatAPI — MVP chatu z MCP (meters)

Serwis backendowy (Node/TypeScript), który mostkuje rozmowę z LLM do serwerów MCP w sieci (LAN/VPN) i lokalnie. MVP integruje serwer MCP `meters` i wystawia proste endpointy do listowania i wywoływania narzędzi oraz sesję chatu z tool‑calling.

## Szybki start (MVP)
- Wymagania: Docker + Docker Compose, lokalny repozytorium z `metersapp`.
- Skonfiguruj `mcp.config.json` na bazie `mcp.config.example.json` (domyślnie wskazuje na `../metersapp/apps/meters-mcp/run.sh`).
- Uzupełnij `.env` na bazie `.env.example` (klucz do LLM jest wymagany dla `/chat`).
- Uruchomienie (tryb deweloperski, hot reload przez `tsx`):

```bash
docker compose -f docker-compose.dev.yml up --build
```

- Tryb produkcyjny (kompilacja + start bez watch):

```bash
docker compose -f docker-compose.prod.yml up --build
```

W trybie deweloperskim backend nasłuchuje na `http://localhost:4025`, a frontend Vite na `http://localhost:4225`. W trybie produkcyjnym (preview) zachowujemy porty `5055` (backend) i `4173` (frontend) — docelowe zmiany opisane w planie.

## Struktura
- `src/` — implementacja (MCP manager, routery `/mcp/*`, `/chat`)
- `docs/` — plan MVP, architektura, spec API, integracja `meters`
- `mcp.config.example.json` — przykład konfiguracji serwerów MCP
- `.env.example` — wymagane zmienne środowiskowe
- Kontrola dostępu: w `.env` ustaw `ALLOWED_IPS` (domyślnie `192.168.2.145,192.168.4.170`), żądania z innych adresów są odrzucane kodem 403.
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

## Notatki
- Docelowo: Keycloak (Bearer) i role per tool/server, audyt wywołań.
- Dla dużych wyników narzędzi: skrót + URI; pełne dane pobiera UI przez `/mcp/resources/read`.
