# Frontend — Chat MCP UI

Vite + React UI dla backendu `chatapp/backend`. Zapewnia prosty interfejs rozmowy (lista wiadomości, ostatnie wyniki narzędzi MCP) oraz listę dostępnych narzędzi.

## Szybki start (lokalnie)

```bash
npm install
npm run dev
```

Domyślnie serwer developerski działa na `http://localhost:4225`. UI próbując połączyć się z backendem:
- użyje `VITE_CHATAPI_URL`, jeśli jest ustawione,
- w przeciwnym wypadku podmieni host z bieżącego adresu przeglądarki na port `VITE_CHATAPI_PORT` (domyślnie `4025`).

## Skrypty
- `npm run dev` — Vite dev server
- `npm run build` — kompilacja produkcyjna (`vite build` + `tsc -b`)
- `npm run preview` — lokalny podgląd buildu (port 4173)

## Środowisko
- `VITE_CHATAPI_URL` — pełny URL backendu (opcjonalnie, domyślnie `http://192.168.14.55:4025`).
- `VITE_CHATAPI_PORT` — port backendu używany w fallbacku (domyślnie `4025`).

## Funkcje UI
- Sesje zapisywane są po `sessionId` w adresie (`?session=<uuid>`); odświeżenie lub przekazanie linku przywraca historię z backendu (`GET /sessions/:id`).
- Panel „Ostatnie wyniki narzędzi” pokazuje skróty logów MCP; kliknięcie „Szczegóły” otwiera drawer z pełną odpowiedzią.
- Wysyłanie wiadomości `Enter`, nowa linia `Shift+Enter`.
