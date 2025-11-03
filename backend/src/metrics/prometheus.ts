type LabelKey = string;

function labelsKey(labels: Record<string, string | number | undefined>): LabelKey {
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return entries.join(',');
}

const requestCounter = new Map<LabelKey, number>();

const durationBuckets = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
type Hist = { count: number; sum: number; buckets: number[] };
const requestHistogram = new Map<LabelKey, Hist>();

// Domain metrics: tool invocations and LLM requests
const toolInvocationCounter = new Map<LabelKey, number>();
const llmRequestCounter = new Map<LabelKey, number>();

export function recordHttpRequest(labels: { method: string; route: string; status: number }, durationMs: number) {
  const key = labelsKey({ method: labels.method, route: labels.route, status: labels.status });
  requestCounter.set(key, (requestCounter.get(key) ?? 0) + 1);

  const hKey = labelsKey({ method: labels.method, route: labels.route });
  const hist = requestHistogram.get(hKey) ?? { count: 0, sum: 0, buckets: Array(durationBuckets.length).fill(0) };
  hist.count += 1;
  hist.sum += durationMs;
  for (let i = 0; i < durationBuckets.length; i++) {
    if (durationMs <= durationBuckets[i]) {
      hist.buckets[i] += 1;
    }
  }
  requestHistogram.set(hKey, hist);
}

export function recordToolInvocationMetric(labels: { tool: string; status: 'success' | 'error' }) {
  const key = labelsKey({ tool: labels.tool, status: labels.status });
  toolInvocationCounter.set(key, (toolInvocationCounter.get(key) ?? 0) + 1);
}

export function recordLlmRequestMetric(labels: { model: string; status: 'ok' | 'error' }) {
  const key = labelsKey({ model: labels.model, status: labels.status });
  llmRequestCounter.set(key, (llmRequestCounter.get(key) ?? 0) + 1);
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, value] of requestCounter.entries()) {
    const lbl = key
      .split(',')
      .map((p) => p.split('='))
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(',');
    lines.push(`http_requests_total{${lbl}} ${value}`);
  }

  // Tool invocations
  lines.push('# HELP mcp_tool_invocations_total Total number of MCP tool invocations');
  lines.push('# TYPE mcp_tool_invocations_total counter');
  for (const [key, value] of toolInvocationCounter.entries()) {
    const lbl = key
      .split(',')
      .map((p) => p.split('='))
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(',');
    lines.push(`mcp_tool_invocations_total{${lbl}} ${value}`);
  }

  // LLM requests
  lines.push('# HELP llm_requests_total Total number of LLM requests');
  lines.push('# TYPE llm_requests_total counter');
  for (const [key, value] of llmRequestCounter.entries()) {
    const lbl = key
      .split(',')
      .map((p) => p.split('='))
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(',');
    lines.push(`llm_requests_total{${lbl}} ${value}`);
  }

  lines.push('# HELP http_request_duration_ms HTTP request duration in ms');
  lines.push('# TYPE http_request_duration_ms histogram');
  for (const [key, hist] of requestHistogram.entries()) {
    const baseLbl = key
      .split(',')
      .map((p) => p.split('='))
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(',');
    let cumulative = 0;
    for (let i = 0; i < durationBuckets.length; i++) {
      cumulative += hist.buckets[i] ?? 0;
      lines.push(`http_request_duration_ms_bucket{${baseLbl},le="${durationBuckets[i]}"} ${cumulative}`);
    }
    // +Inf bucket
    lines.push(`http_request_duration_ms_bucket{${baseLbl},le="+Inf"} ${hist.count}`);
    lines.push(`http_request_duration_ms_count{${baseLbl}} ${hist.count}`);
    lines.push(`http_request_duration_ms_sum{${baseLbl}} ${hist.sum}`);
  }

  return lines.join('\n') + '\n';
}
