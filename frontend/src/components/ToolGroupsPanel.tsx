import type { ToolGroupInfo } from '../types';

interface ToolGroupsPanelProps {
  groups: ToolGroupInfo[];
  expandedServers: Record<string, boolean>;
  onToggleServer: (serverId: string) => void;
  isError: boolean;
  isLoading: boolean;
}

export function ToolGroupsPanel({ groups, expandedServers, onToggleServer, isError, isLoading }: ToolGroupsPanelProps) {
  const hasTools = groups.length > 0;

  return (
    <section>
      <h3>Dostępne narzędzia</h3>
      {isError ? (
        <div className="tool-results-empty">Nie można pobrać listy narzędzi.</div>
      ) : !hasTools && !isLoading ? (
        <div className="tool-results-empty">Brak narzędzi MCP.</div>
      ) : (
        <div className="tool-groups">
          {groups.map((group) => {
            const isExpanded = expandedServers[group.serverId] ?? false;
            return (
              <div key={group.serverId} className="tool-group">
                <button type="button" className="tool-group-toggle" onClick={() => onToggleServer(group.serverId)}>
                  <span>{formatServerName(group.serverId)}</span>
                  <span className="tool-group-meta">
                    {group.tools.length} narzędzi {isExpanded ? '▾' : '▸'}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="tool-group-tools">
                    <div className="tools-grid">
                      {group.tools.map((tool) => (
                        <div key={tool.name} className="tool-pill" title={tool.description ?? ''}>
                          {tool.name}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatServerName(value: string) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
