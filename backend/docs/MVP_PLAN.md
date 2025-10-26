# MVP plan — Chat z MCP (meters + employee)

## Cel
Dostarczyć minimalnie użyteczną aplikację chatową, która potrafi:
- wyświetlić listę narzędzi MCP z serwerów `meters` i `employee`,
- na żądanie modelu (tool-calling) wywołać narzędzia `meters.*` / `employee.*` i wstrzyknąć wynik do rozmowy,
- zwizualizować wynik narzędzia w UI (JSON/tabela),
- działać w LAN/VPN bez wystawiania MCP na zewnątrz.

## Zakres MVP (Faza F1)
- Backend `chatapi`:
  - Manager MCP (połączenie z serwerami `meters`, `employee`, listowanie `tools/resources`).
  - Konfiguracja allowlist/blacklist (np. blokada `*_delete_*` itp.) dla narzędzi MCP.
  - Endpointy: `GET /mcp/tools`, `GET /mcp/resources`, `GET /mcp/resources/read`, `POST /chat`.
  - Pętla tool-calling z 1 modelem (np. gpt‑4.1‑mini lub odpowiednik).
  - Prosty log wywołań narzędzi (w pamięci, bez DB).
- Frontend `chatapp`:
  - Ekran rozmowy (historia, input, stream odpowiedzi).
  - Panel wyników narzędzi (JSON + prosty grid dla tablic rekordów).
  - Lista narzędzi (paleta) i podgląd parametrów.

## Poza zakresem F1 (następne)
- Autoryzacja Keycloak i role per tool.
- Approvals (eskalacja) dla narzędzi modyfikujących stan.
- Persistencja historii (DB), multi‑user, multi‑session.
- Integracja z dodatkowymi MCP (gardenknowledge itd.).

## Kamienie milowe
1) Szkielet katalogów + dokumentacja (ten commit).
2) MCP Manager (połączenie i listowanie narzędzi `meters`).
3) `/mcp/*` endpointy i smoke testy (curl).
4) Pętla `/chat` z 1 przebiegiem tool‑calling.
5) UI chat + render wyników narzędzi.

## Kryteria akceptacji
- `GET /mcp/tools` zwraca przynajmniej narzędzia `meters_*`.
- Wywołanie `POST /chat` kończy się poprawną odpowiedzią z wtrąceniem wyniku narzędzia (np. `meters_daily_consumption`).
- UI wyświetla historię i wynik narzędzia (JSON lub tabela).

## Ryzyka/mitigacje
- Niedostępny MCP: wyświetl komunikat i pozwól na retry; timeouty.
- Duże wyniki: pokaż skróty + opcję pobrania pełnych danych przez `/mcp/resources/read`.
- Zgodność schematów: walidacja wejść przez JSON Schema (z MCP) i zod.
