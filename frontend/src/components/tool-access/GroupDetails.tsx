import type { ToolAccessMatrix, ToolDefinitionRecord } from '../../types';

interface GroupDetailsProps {
  selectedRole: string;
  selectedGroup: NonNullable<ToolAccessMatrix['groups']>[number];
  matrix: ToolAccessMatrix;
  groupState: (role: string, groupId: string) => 'allow' | 'deny' | 'inherit';
  setGroupState: (role: string, groupId: string, state: 'allow' | 'deny' | 'inherit') => void;
  toolState: (role: string, toolId: string) => 'allow' | 'deny' | 'inherit';
  toolReason: (role: string, toolId: string) => string;
  setToolState: (role: string, toolId: string, state: 'allow' | 'deny' | 'inherit') => void;
  setToolReason: (role: string, toolId: string, reason: string) => void;
}

function classifyCell(state: 'allow' | 'deny' | 'inherit', selected: boolean): string {
  const base = 'w-full rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition focus:outline-none';
  const selectedRing = selected ? ' ring-2 ring-offset-2 ring-offset-surface/50' : '';
  switch (state) {
    case 'allow':
      return `${base} border-primary/40 bg-primary/20 text-primary hover:bg-primary/25${selectedRing}`;
    case 'deny':
      return `${base} border-danger/40 bg-danger/20 text-danger hover:bg-danger/30${selectedRing}`;
    default:
      return `${base} border-white/10 bg-white/5 text-slate-200 hover:bg-white/10${selectedRing}`;
  }
}

function toolStateBadge(state: 'allow' | 'deny' | 'inherit'): string {
  switch (state) {
    case 'allow':
      return 'bg-primary/20 text-primary border border-primary/30';
    case 'deny':
      return 'bg-danger/25 text-danger border border-danger/40';
    default:
      return 'bg-white/5 text-slate-300 border border-white/10';
  }
}

export function GroupDetails({ selectedRole, selectedGroup, matrix, groupState, setGroupState, toolState, toolReason, setToolState, setToolReason }: GroupDetailsProps) {
  return (
    <aside className="w-96 flex-shrink-0 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide text-slate-400">Rola</div>
        <div className="text-lg font-semibold text-white">{selectedRole}</div>
      </div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide text-slate-400">Grupa</div>
        <div className="text-lg font-semibold text-white">{selectedGroup.group.name}</div>
        {selectedGroup.group.description ? (
          <div className="mt-1 text-sm text-slate-300">{selectedGroup.group.description}</div>
        ) : null}
      </div>
      <div className="mb-4 space-y-2">
        <div className="text-xs uppercase tracking-wide text-slate-400">Dostęp do grupy</div>
        <div className="flex items-center gap-2">
          {(['inherit', 'allow', 'deny'] as const).map((state) => {
            const current = groupState(selectedRole, selectedGroup.group.id);
            return (
              <button
                key={state}
                type="button"
                className={classifyCell(state, current === state)}
                onClick={() => setGroupState(selectedRole, selectedGroup.group.id, state)}
              >
                {state === 'inherit' ? 'Dziedzicz' : state === 'allow' ? 'Zezwól' : 'Zablokuj'}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Narzędzia w grupie</div>
        <div className="space-y-3">
          {selectedGroup.tools.map((tool: ToolDefinitionRecord) => {
            const state = toolState(selectedRole, tool.id);
            const reason = toolReason(selectedRole, tool.id);
            const originalReason = matrix?.toolPermissions[selectedRole]?.[tool.id]?.reason ?? '';
            const showReason = state !== 'inherit';
            return (
              <div key={tool.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{tool.name}</div>
                    {tool.description ? <div className="text-xs text-slate-400">{tool.description}</div> : null}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${toolStateBadge(state)}`}>
                    {state === 'inherit' ? 'Dziedziczone' : state === 'allow' ? 'Dozwolone' : 'Zablokowane'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(['inherit', 'allow', 'deny'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={classifyCell(option, option === state)}
                      onClick={() => setToolState(selectedRole, tool.id, option)}
                    >
                      {option === 'inherit' ? 'Dziedzicz' : option === 'allow' ? 'Zezwól' : 'Blokuj'}
                    </button>
                  ))}
                </div>
                {showReason ? (
                  <div className="mt-3">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Uzasadnienie (opcjonalne)
                      <textarea
                        className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/40"
                        rows={2}
                        maxLength={200}
                        value={reason}
                        onChange={(event) => setToolReason(selectedRole, tool.id, event.target.value)}
                        placeholder="np. 'Tylko dział HR ma uprawnienia do edycji'"
                      />
                    </label>
                    {reason.length === 0 && originalReason ? (
                      <div className="mt-1 text-xs text-slate-400">
                        Bieżący powód: <span className="text-slate-200">{originalReason}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

