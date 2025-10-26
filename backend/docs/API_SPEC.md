# API Spec — ChatAPI (MVP meters)

## `GET /mcp/tools`
Zwraca listę narzędzi dostępnych przez MCP `meters` (namespaced).

Przykład odpowiedzi:
```json
[
  {
    "name": "meters.meters_list_meters",
    "description": "List meters configuration",
    "parameters": { "type": "object", "properties": {"...": {}} }
  },
  {
    "name": "meters.meters_daily_consumption",
    "description": "Daily derived consumption",
    "parameters": { "type": "object", "required": ["meterId","from","to"], "properties": {"meterId":{"type":"string"},"from":{"type":"string"},"to":{"type":"string"}} }
  }
]
```

## `GET /mcp/resources`
Zwraca listę zasobów MCP (jeśli wspierane przez serwer `meters`).

## `GET /mcp/resources/read?uri=...`
Odczyt pojedynczego zasobu (stream/json/txt).

## `GET /health`
Zwraca status backendu, połączenia z MCP oraz dostępności modelu LLM.

Przykład odpowiedzi:
```json
{
  "backend": "ok",
  "mcp": { "status": "ok" },
  "openai": { "status": "ok", "model": "gpt-4.1-mini" }
}
```

## `GET /sessions/:id`
Zwraca zapisaną sesję (wiadomości + historia wywołań narzędzi) dla wskazanego `sessionId`. Gdy brak pliku — status 404.

## `POST /chat`
Wejście:
```json
{
  "messages": [
    {"role":"system","content":"instrukcje"},
    {"role":"user","content":"Pokaż zużycie wody..."}
  ]
}
```

Wyjście (skrót):
```json
{
  "message": {"role":"assistant","content":"..."},
  "toolResults": [
    {"name":"meters.meters_daily_consumption","args":{ "meterId":"...","from":"2025-01-01","to":"2025-01-07" },"result": {"...": "..."}}
  ]
}
```

Uwagi:
- Pętla może wykonać kilka `tool_call` zanim zwróci finalny tekst.
- Wersja stream (SSE) może zostać dodana jako `GET /chat/stream` (następny etap).
