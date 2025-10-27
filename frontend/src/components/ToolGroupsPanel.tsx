import type { ToolGroupInfo } from '../types';

interface ToolGroupsPanelProps {
  groups: ToolGroupInfo[];
  isError: boolean;
  isLoading: boolean;
  onSelectGroup: (group: ToolGroupInfo) => void;
}

export function ToolGroupsPanel({ groups, isError, isLoading, onSelectGroup }: ToolGroupsPanelProps) {
  const hasTools = groups.length > 0;

  return (
    <section>
      <h3>Dostępne narzędzia</h3>
      {isError ? (
        <div className="tool-results-empty">Nie można pobrać listy narzędzi.</div>
      ) : !hasTools && !isLoading ? (
        <div className="tool-results-empty">Brak narzędzi MCP.</div>
      ) : (
        <div className="tool-groups-grid">
          {groups.map((group) => (
            <button
              key={group.serverId}
              type="button"
              className="tool-group-card"
              onClick={() => onSelectGroup(group)}
            >
              <span className="tool-group-card-icon">{formatServerAbbrev(group.serverId)}</span>
              <span className="tool-group-card-name">{formatServerName(group.serverId)}</span>
              <span className="tool-group-card-meta">{group.tools.length} narzędzi</span>
            </button>
          ))}
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

function formatServerAbbrev(value: string) {
  const compact = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (compact.length >= 2) {
    return compact.slice(0, 2);
  }
  if (compact.length === 1) {
    return compact;
  }
  return 'MCP';
}
