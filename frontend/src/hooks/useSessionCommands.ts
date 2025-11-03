import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UsageSummary } from '../utils/health';

export function useSessionCommands(params: {
  createSession: () => Promise<string>;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  resetConversation: () => void;
  closeTool: () => void;
  clearSelectedToolInfo: () => void;
  setUsageSummary: (value: UsageSummary | null) => void;
  setError: (value: string | null) => void;
  setIsBusy: (value: boolean) => void;
  closeMobileSidebar: () => void;
  setSelectedProjectId: (value: string | null) => void;
  setCurrentDocPath: (value: string | null) => void;
  sessionId: string | null;
  navigateToSession: (id: string) => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  setIsRestoring: (value: boolean) => void;
  deleteSession: (id: string) => Promise<void>;
  authed: boolean;
  refreshSessions: (opts?: { silent?: boolean }) => void | Promise<void>;
  setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    createSession,
    navigate,
    resetConversation,
    closeTool,
    clearSelectedToolInfo,
    setUsageSummary,
    setError,
    setIsBusy,
    closeMobileSidebar,
    setSelectedProjectId,
    setCurrentDocPath,
    sessionId,
    navigateToSession,
    loadSession,
    setIsRestoring,
    deleteSession,
    authed,
    refreshSessions,
    setIsSidebarCollapsed,
  } = params;

  const handleCreateNewSession = useCallback(async () => {
    const newId = await createSession();
    navigate(`/${newId}`, { replace: true });
    resetConversation();
    closeTool();
    clearSelectedToolInfo();
    setUsageSummary(null);
    setError(null);
    setIsBusy(false);
    closeMobileSidebar();
    setSelectedProjectId(null);
    setCurrentDocPath(null);
  }, [
    clearSelectedToolInfo,
    closeMobileSidebar,
    closeTool,
    createSession,
    navigate,
    resetConversation,
    setCurrentDocPath,
    setError,
    setIsBusy,
    setSelectedProjectId,
    setUsageSummary,
  ]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (!id) {
        return;
      }
      if (id === sessionId) {
        closeMobileSidebar();
        return;
      }
      await navigateToSession(id);
      setIsRestoring(true);
      navigate(`/${id}`, { replace: true });
      closeMobileSidebar();
      void loadSession(id).finally(() => { setIsRestoring(false); });
    },
    [closeMobileSidebar, loadSession, navigate, navigateToSession, sessionId, setIsRestoring],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!authed) {
        return;
      }
      const confirmed = window.confirm('Czy na pewno chcesz usunąć tę sesję?');
      if (!confirmed) {
        return;
      }
      try {
        await deleteSession(id);
        if (id === sessionId) {
          handleCreateNewSession();
        } else {
          void refreshSessions({ silent: true });
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Nie udało się usunąć sesji');
      }
    },
    [authed, deleteSession, handleCreateNewSession, refreshSessions, sessionId, setError],
  );

  const handleExpandSidebar = useCallback(() => {
    setIsSidebarCollapsed(false);
    void refreshSessions({ silent: true });
  }, [refreshSessions, setIsSidebarCollapsed]);

  return {
    handleCreateNewSession,
    handleSelectSession,
    handleDeleteSession,
    handleExpandSidebar,
  } as const;
}

