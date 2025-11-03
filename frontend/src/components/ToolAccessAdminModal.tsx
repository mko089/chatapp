import { ToolAccessHeader } from './tool-access/Header';
import { RoleGroupMatrix } from './tool-access/RoleGroupMatrix';
import { GroupDetails } from './tool-access/GroupDetails';
import { ToolAccessFooter } from './tool-access/Footer';
import { useToolAccessAdmin } from '../hooks/useToolAccessAdmin';

interface ToolAccessAdminModalProps {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
}
export function ToolAccessAdminModal(props: ToolAccessAdminModalProps) {
  const { open, onClose, baseUrl } = props;
  const {
    matrixQuery,
    matrix,
    roles,
    groups,
    selectedRole,
    setSelectedRole,
    selectedGroupId,
    setSelectedGroupId,
    groupState,
    toolState,
    toolReason,
    setGroupState,
    setToolState,
    setToolReason,
    resetPending,
    applyMutation,
    selectedGroup,
    pendingCount,
    isSaving,
    saveError,
  } = useToolAccessAdmin(baseUrl, open);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-8">
      <div className="glass-panel flex h-full w-full max-w-6xl flex-col overflow-hidden">
        <ToolAccessHeader
          pendingCount={pendingCount}
          onRefresh={() => matrixQuery.refetch()}
          refreshing={matrixQuery.isFetching}
          onClose={onClose}
        />

        {saveError ? (
          <div className="mx-6 mt-4 rounded-xl border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger">
            {saveError}
          </div>
        ) : null}

        <div className="flex flex-1 overflow-hidden px-6 py-4 gap-6">
          {matrixQuery.isLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-300">Ładowanie…</div>
          ) : matrix ? (
            <>
              <RoleGroupMatrix
                roles={roles}
                groups={groups}
                groupState={groupState}
                onCellClick={(role, groupId) => {
                  const current = groupState(role, groupId);
                  const next = current === 'inherit' ? 'allow' : current === 'allow' ? 'deny' : 'inherit';
                  setGroupState(role, groupId, next);
                  setSelectedRole(role);
                  setSelectedGroupId(groupId);
                }}
                selectedRole={selectedRole}
                selectedGroupId={selectedGroupId}
              />
              {selectedRole && selectedGroup ? (
                <GroupDetails
                  selectedRole={selectedRole}
                  selectedGroup={selectedGroup}
                  matrix={matrix}
                  groupState={groupState}
                  setGroupState={setGroupState}
                  toolState={toolState}
                  toolReason={toolReason}
                  setToolState={setToolState}
                  setToolReason={setToolReason}
                />
              ) : (
                <aside className="w-96 flex-shrink-0 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-center text-sm text-slate-300">
                  Wybierz rolę i grupę, aby zobaczyć szczegóły.
                </aside>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-300">Nie udało się załadować danych.</div>
          )}
        </div>

        <ToolAccessFooter
          version={matrix?.version}
          pendingCount={pendingCount}
          isSaving={isSaving}
          onReset={resetPending}
          onSave={() => applyMutation.mutate()}
        />
      </div>
    </div>
  );
}
