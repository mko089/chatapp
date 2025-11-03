import { useMemo } from 'react';
import type { MobileSessionDrawerConfig } from '../../components/ChatOverlays';
import type { SessionSummary } from '../../types';

type Params = {
  isOpen: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  sessionFilter: string;
  onSessionFilterChange: (value: string) => void;
  availableSessionOwners: string[];
  currentUserId: string;
  onCreateNewSession: () => void | Promise<void>;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelectSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
};

export function useSessionDrawerConfig(params: Params): MobileSessionDrawerConfig {
  const {
    isOpen,
    onClose,
    isSuperAdmin,
    sessionFilter,
    onSessionFilterChange,
    availableSessionOwners,
    currentUserId,
    onCreateNewSession,
    sessions,
    activeSessionId,
    isLoading,
    error,
    onSelectSession,
    onDeleteSession,
  } = params;

  return useMemo(
    () => ({
      open: isOpen,
      onClose,
      isSuperAdmin,
      sessionFilter,
      onSessionFilterChange,
      availableSessionOwners,
      currentUserId,
      onCreateNewSession,
      sessions,
      activeSessionId,
      isLoading,
      error,
      onSelectSession,
      onDeleteSession,
    }),
    [
      isOpen,
      onClose,
      isSuperAdmin,
      sessionFilter,
      onSessionFilterChange,
      availableSessionOwners,
      currentUserId,
      onCreateNewSession,
      sessions,
      activeSessionId,
      isLoading,
      error,
      onSelectSession,
      onDeleteSession,
    ],
  );
}
