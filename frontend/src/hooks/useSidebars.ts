import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

type RefreshSessionsFn = (options?: { silent?: boolean }) => Promise<void> | void;

export function useSidebars(params: {
  setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  refreshSessions: RefreshSessionsFn;
}) {
  const { setIsSidebarCollapsed, refreshSessions } = params;

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const openMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(true);
    void refreshSessions();
  }, [refreshSessions]);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const toggleSessionSidebar = useCallback(() => {
    const isMobileViewport = typeof window !== 'undefined' ? window.innerWidth < 1024 : false;
    if (isMobileViewport) {
      setMobileSidebarOpen((prev) => {
        const next = !prev;
        if (next) {
          void refreshSessions();
        }
        return next;
      });
      return;
    }

    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        void refreshSessions({ silent: true });
      }
      return next;
    });
  }, [refreshSessions, setIsSidebarCollapsed]);

  return {
    mobileSidebarOpen,
    setMobileSidebarOpen: setMobileSidebarOpen as Dispatch<SetStateAction<boolean>>,
    openMobileSidebar,
    closeMobileSidebar,
    toggleSessionSidebar,
  } as const;
}
