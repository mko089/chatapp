import type { ToolAccessMatrix } from '../../types';

type GroupEntry = NonNullable<ToolAccessMatrix['groups']>[number];

interface RoleGroupMatrixProps {
  roles: string[];
  groups: GroupEntry[];
  groupState: (role: string, groupId: string) => 'allow' | 'deny' | 'inherit';
  onCellClick: (role: string, groupId: string) => void;
  selectedRole: string | null;
  selectedGroupId: string | null;
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

export function RoleGroupMatrix({ roles, groups, groupState, onCellClick, selectedRole, selectedGroupId }: RoleGroupMatrixProps) {
  return (
    <div className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-white/5 p-4">
      <table className="w-full border-separate border-spacing-y-2">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Rola</th>
            {groups.map((entry) => (
              <th key={entry.group.id} className="pb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">
                {entry.group.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role}>
              <td className="py-2 pr-3 text-sm font-semibold text-white">{role}</td>
              {groups.map((entry) => {
                const state = groupState(role, entry.group.id);
                const selected = role === selectedRole && entry.group.id === selectedGroupId;
                return (
                  <td key={entry.group.id} className="py-2 pr-3">
                    <button
                      type="button"
                      className={classifyCell(state, selected)}
                      onClick={() => onCellClick(role, entry.group.id)}
                    >
                      {state === 'inherit' ? 'Dziedziczone' : state === 'allow' ? 'Dostęp' : 'Blokada'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

