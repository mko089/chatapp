import { useMemo, useState } from 'react';
import type { ToolGroupInfo, ToolInfo, ToolInvocation } from '../types';

interface ToolDockProps {
  open: boolean;
  groups: ToolGroupInfo[];
  history: ToolInvocation[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onSelectTool: (tool: ToolInfo) => void;
}

export function ToolDock({ open, groups, history, favorites, onToggleFavorite, onSelectTool }: ToolDockProps) {
  const [query, setQuery] = useState('');

  const toolMap = useMemo(() => {
    const map = new Map<string, ToolInfo>();
    for (const group of groups) {
      for (const tool of group.tools) {
        map.set(buildKey(tool), tool);
      }
    }
    return map;
  }, [groups]);

  const recentTools = useMemo(() => {
    const seen = new Set<string>();
    const collected: ToolInfo[] = [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      const candidates = Array.from(toolMap.values()).filter((tool) => tool.name === entry.name);
      const [canonical] = candidates;
      if (!canonical) continue;
      const key = buildKey(canonical);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(canonical);
      if (collected.length >= 8) break;
    }
    return collected;
  }, [history, toolMap]);

  const filteredTools = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter((tool) => {
          const nameMatch = tool.name.toLowerCase().includes(term);
          const descMatch = tool.description?.toLowerCase().includes(term) ?? false;
          const serverMatch = group.serverId.toLowerCase().includes(term);
          return nameMatch || descMatch || serverMatch;
        }),
      }))
      .filter((group) => group.tools.length > 0);
  }, [groups, query]);

  const favoriteTools = useMemo(() => {
    return favorites
      .map((key) => toolMap.get(key))
      .filter((tool): tool is ToolInfo => Boolean(tool));
  }, [favorites, toolMap]);

  if (!open) {
    return null;
  }

  return (
    <aside className="w-full lg:w-80">
      <div className="glass-panel flex h-full flex-col gap-5 p-5">
        <div>
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-300">
            <span>Szukaj narzędzia</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="np. posbistro..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </label>
        </div>

        <Section title="Ulubione" emptyLabel="Brak ulubionych">
          {favoriteTools.map((tool) => (
            <ToolRow
              key={buildKey(tool)}
              tool={tool}
              isFavorite
              onSelect={() => onSelectTool(tool)}
              onToggleFavorite={() => onToggleFavorite(buildKey(tool))}
            />
          ))}
        </Section>

        <Section title="Ostatnio użyte" emptyLabel="Jeszcze niczego nie uruchomiono">
          {recentTools.map((tool) => (
            <ToolRow
              key={`recent-${buildKey(tool)}`}
              tool={tool}
              isFavorite={favorites.includes(buildKey(tool))}
              onSelect={() => onSelectTool(tool)}
              onToggleFavorite={() => onToggleFavorite(buildKey(tool))}
            />
          ))}
        </Section>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filteredTools.length === 0 ? (
            <EmptyState label="Brak wyników wyszukiwania" />
          ) : (
            <div className="flex flex-col gap-4">
              {filteredTools.map((group) => (
                <div key={group.serverId} className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{formatServerName(group.serverId)}</div>
                  <div className="space-y-2">
                    {group.tools.map((tool) => (
                      <ToolRow
                        key={buildKey(tool)}
                        tool={tool}
                        isFavorite={favorites.includes(buildKey(tool))}
                        onSelect={() => onSelectTool(tool)}
                        onToggleFavorite={() => onToggleFavorite(buildKey(tool))}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({ title, emptyLabel, children }: { title: string; emptyLabel: string; children: React.ReactNode }) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <section className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      {isEmpty ? <EmptyState label={emptyLabel} /> : <div className="space-y-2">{children}</div>}
    </section>
  );
}

function ToolRow({ tool, isFavorite, onSelect, onToggleFavorite }: { tool: ToolInfo; isFavorite: boolean; onSelect: () => void; onToggleFavorite: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 text-left text-sm text-slate-100 transition hover:text-white"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{tool.name}</span>
          <span className="chip chip-muted">{formatServerName(tool.serverId)}</span>
        </div>
        {tool.description ? (
          <p className="mt-1 line-clamp text-xs text-slate-400" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {tool.description}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Brak opisu</p>
        )}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full border ${isFavorite ? 'border-primary/40 bg-primary/20 text-primary' : 'border-white/10 bg-white/5 text-slate-400'} transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary`}
        title={isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
      >
        {isFavorite ? '★' : '☆'}
      </button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-500">{label}</div>;
}

function buildKey(tool: ToolInfo): string {
  return `${tool.serverId}::${tool.name}`;
}

function formatServerName(value: string) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
