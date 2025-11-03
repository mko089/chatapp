# Metrics and Dashboards (Baseline)

## Prometheus Metrics (exported by /metrics)

- http_requests_total{method,route,status}
- http_request_duration_ms (histogram; buckets: 50..10000ms)
- mcp_tool_invocations_total{tool,status}
- llm_requests_total{model,status}

## Suggested Grafana Panels

- HTTP throughput by route (stacked): sum by (route) of rate(http_requests_total[5m])
- HTTP error rate: sum by (status) of rate(http_requests_total{status=~"5..|4.."}[5m])
- Latency p50/p90/p99: histogram_quantile(0.5/0.9/0.99, sum by (le, route) (rate(http_request_duration_ms_bucket[5m])))
- MCP tools: Top N tools by invocations: topk(10, sum by (tool) (rate(mcp_tool_invocations_total[5m])))
- LLM requests: rate by model/status: sum by (model,status) (rate(llm_requests_total[5m]))

## Alerts (examples)

- High error rate: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05 for 10m
- Slow routes p99: histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_ms_bucket[5m]))) > 5s for 10m

