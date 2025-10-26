# UX — ChatApp (MVP meters)

## Scenariusz użytkownika
1) Otwiera chat, wpisuje: „Pokaż dzienne zużycie wody dla `woda-1` z ostatniego tygodnia”.
2) Model prosi o `meters.meters_daily_consumption` — backend wykonuje.
3) UI pokazuje odpowiedź modelu i kartę z wynikiem narzędzia (tabela daty/wartości).

## Komponenty
- `MessageList` — lista wiadomości (assistant/user/tool) z formatowaniem.
- `ChatInput` — pole tekstowe + button wysyłki (obsługa lockowania podczas requestu).
- `ToolsPalette` — lista narzędzi `meters.*` i podgląd parametrów (obecnie proste „pill” z opisem w tooltipie).
- `ToolResults` — pasek z ostatnimi wynikami narzędzi (JSON, maks. kilka ostatnich wpisów).

## Dalsze kroki
- Paginacja dużych wyników, pobieranie pełnych danych przez `/mcp/resources/read`.
- Approvals modal dla narzędzi modyfikujących (poza MVP F1).
