// Simple Date/Time MCP server (stdio)
// Exposes lightweight tools for current date/time and common ranges
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'datetime-mcp', version: '0.1.0' });

function getOffsetMinutesForTz(tz) {
  const now = new Date();
  // Compute offset for tz relative to UTC, based on the same instant
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const loc = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((loc - utc) / 60000);
}

function toOffsetString(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function formatParts(now, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function weekdayName(now, tz, locale = 'pl-PL') {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now);
  }
}

function toYyyyMmDd(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Tool: datetime_now (fixed tz Europe/Warsaw)
server.registerTool(
  'datetime_now',
  {
    title: 'Current date and time',
    description: 'Returns current date/time in Europe/Warsaw timezone',
    inputSchema: {},
    outputSchema: {
      epochMs: z.number(),
      isoUtc: z.string(),
      tz: z.string(),
      offsetMinutes: z.number(),
      offset: z.string(),
      isoLocal: z.string(),
      date: z.string(),
      time: z.string(),
      weekday: z.string(),
    },
  },
  async () => {
    const now = new Date();
    const zone = 'Europe/Warsaw';
    const parts = formatParts(now, zone);
    const offsetMinutes = getOffsetMinutesForTz(zone);
    const offset = toOffsetString(offsetMinutes);
    const isoLocal = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
    const out = {
      epochMs: now.getTime(),
      isoUtc: now.toISOString(),
      tz: zone,
      offsetMinutes,
      offset,
      isoLocal,
      date: toYyyyMmDd(parts),
      time: `${parts.hour}:${parts.minute}:${parts.second}`,
      weekday: weekdayName(now, zone),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    };
  }
);

// Tool: date_today (fixed tz Europe/Warsaw)
server.registerTool(
  'date_today',
  {
    title: 'Today date',
    description: 'Returns today date and local start/end of day in Europe/Warsaw',
    inputSchema: {},
    outputSchema: {
      tz: z.string(),
      date: z.string(),
      startOfDayLocal: z.string(),
      endOfDayLocal: z.string(),
      offset: z.string(),
    },
  },
  async () => {
    const now = new Date();
    const zone = 'Europe/Warsaw';
    const parts = formatParts(now, zone);
    const offsetMinutes = getOffsetMinutesForTz(zone);
    const offset = toOffsetString(offsetMinutes);
    const date = toYyyyMmDd(parts);
    const out = {
      tz: zone,
      date,
      startOfDayLocal: `${date}T00:00:00${offset}`,
      endOfDayLocal: `${date}T23:59:59${offset}`,
      offset,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      structuredContent: out,
    };
  }
);

// Tool: timeframe (fixed tz Europe/Warsaw)
server.registerTool(
  'timeframe',
  {
    title: 'Compute date range',
    description: 'Returns {from,to} in Europe/Warsaw for presets: today, yesterday, this_month, last_month',
    inputSchema: { preset: z.enum(['today', 'yesterday', 'this_month', 'last_month']) },
    outputSchema: { from: z.string(), to: z.string(), tz: z.string() },
  },
  async ({ preset }) => {
    const now = new Date();
    const zone = 'Europe/Warsaw';
    // Compute date in zone
    const parts = formatParts(now, zone);
    const today = toYyyyMmDd(parts);
    function firstDayOfMonth(y, m) { return `${y}-${String(m).padStart(2,'0')}-01`; }
    function lastDayOfMonth(y, m) { const d = new Date(y, m, 0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    let from = today, to = today;
    if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yp = formatParts(y, zone);
      from = toYyyyMmDd(yp); to = from;
    } else if (preset === 'this_month') {
      const y = Number(parts.year); const m = Number(parts.month);
      from = firstDayOfMonth(y, m);
      to = today;
    } else if (preset === 'last_month') {
      const d = new Date(Number(parts.year), Number(parts.month) - 1, 1);
      d.setMonth(d.getMonth() - 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      from = firstDayOfMonth(y, m);
      to = lastDayOfMonth(y, m);
    }
    const out = { from, to, tz: zone };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

// Tool: iso_timestamp
server.registerTool(
  'iso_timestamp',
  {
    title: 'UTC ISO timestamp now',
    description: 'Returns current UTC timestamp in ISO 8601 format',
    inputSchema: {},
    outputSchema: { isoUtc: z.string(), epochMs: z.number() },
  },
  async () => {
    const now = new Date();
    const out = { isoUtc: now.toISOString(), epochMs: now.getTime() };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

// Helper: map weekday name to ISO number (Mon=1..Sun=7)
function weekdayNumber(now, tz) {
  const name = weekdayName(now, tz, 'en-US').toLowerCase();
  switch (name) {
    case 'monday': return 1;
    case 'tuesday': return 2;
    case 'wednesday': return 3;
    case 'thursday': return 4;
    case 'friday': return 5;
    case 'saturday': return 6;
    case 'sunday': return 7;
    default: return 1;
  }
}

// Tool: week_range (fixed tz Europe/Warsaw)
server.registerTool(
  'week_range',
  {
    title: 'Current week range (Mon–Sun)',
    description: 'Returns {from,to} in Europe/Warsaw for current week (Mon–Sun)',
    inputSchema: {},
    outputSchema: { from: z.string(), to: z.string(), tz: z.string() },
  },
  async () => {
    const zone = 'Europe/Warsaw';
    const now = new Date();
    const parts = formatParts(now, zone);
    const today = toYyyyMmDd(parts);
    const w = weekdayNumber(now, zone); // 1..7
    // Build a stable date at 12:00 UTC to avoid DST edges when moving +/- days
    const [y, m, d] = today.split('-').map(Number);
    const mid = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    // Monday
    const mon = new Date(mid.getTime() - (w - 1) * 86400000);
    // Sunday
    const sun = new Date(mid.getTime() + (7 - w) * 86400000);
    const from = toYyyyMmDd(formatParts(mon, zone));
    const to = toYyyyMmDd(formatParts(sun, zone));
    const out = { from, to, tz: zone };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

// Tool: month_range (fixed tz Europe/Warsaw)
server.registerTool(
  'month_range',
  {
    title: 'Month range',
    description: 'Returns {from,to} for a month in Europe/Warsaw. If year/month omitted, uses current month.',
    inputSchema: { year: z.number().int().optional(), month: z.number().int().min(1).max(12).optional() },
    outputSchema: { from: z.string(), to: z.string(), tz: z.string(), year: z.number(), month: z.number() },
  },
  async ({ year, month }) => {
    const zone = 'Europe/Warsaw';
    const now = new Date();
    const parts = formatParts(now, zone);
    const y = typeof year === 'number' && Number.isFinite(year) ? year : Number(parts.year);
    const m = typeof month === 'number' && Number.isFinite(month) ? month : Number(parts.month);
    const first = `${String(y)}-${String(m).padStart(2, '0')}-01`;
    const lastDate = new Date(y, m, 0).getDate();
    const last = `${String(y)}-${String(m).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
    const out = { from: first, to: last, tz: zone, year: y, month: m };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

// Tool: timezone_offset (fixed tz Europe/Warsaw)
server.registerTool(
  'timezone_offset',
  {
    title: 'Timezone offset',
    description: 'Returns current offset for Europe/Warsaw (±HH:MM and minutes)',
    inputSchema: {},
    outputSchema: { tz: z.string(), offset: z.string(), offsetMinutes: z.number() },
  },
  async () => {
    const zone = 'Europe/Warsaw';
    const offsetMinutes = getOffsetMinutesForTz(zone);
    const offset = toOffsetString(offsetMinutes);
    const out = { tz: zone, offset, offsetMinutes };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

// Tool: format_datetime (fixed tz Europe/Warsaw)
server.registerTool(
  'format_datetime',
  {
    title: 'Format datetime',
    description:
      'Formats an ISO datetime (or now) in Europe/Warsaw using tokens: YYYY, MM, DD, HH, mm, ss, offset, dddd (weekday).',
    inputSchema: { iso: z.string().optional(), pattern: z.string().optional(), locale: z.string().optional() },
    outputSchema: { input: z.string(), tz: z.string(), pattern: z.string(), formatted: z.string() },
  },
  async ({ iso, pattern, locale }) => {
    const zone = 'Europe/Warsaw';
    const loc = locale && locale.trim().length > 0 ? locale.trim() : 'pl-PL';
    const inputIso = iso && iso.trim().length > 0 ? iso.trim() : new Date().toISOString();
    const date = new Date(inputIso);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid ISO datetime');
    }
    const parts = formatParts(date, zone);
    const offMin = getOffsetMinutesForTz(zone);
    const offStr = toOffsetString(offMin);
    const tokens = {
      YYYY: parts.year,
      MM: parts.month,
      DD: parts.day,
      HH: parts.hour,
      mm: parts.minute,
      ss: parts.second,
      offset: offStr,
      dddd: weekdayName(date, zone, loc),
    };
    const pat = pattern && pattern.length > 0 ? pattern : 'YYYY-MM-DD HH:mm:ss';
    let outStr = pat;
    // Replace longest tokens first to avoid overlap issues
    outStr = outStr.replace(/YYYY|MM|DD|HH|mm|ss|dddd|offset/g, (m) => tokens[m] ?? m);
    const out = { input: inputIso, tz: zone, pattern: pat, formatted: outStr };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
