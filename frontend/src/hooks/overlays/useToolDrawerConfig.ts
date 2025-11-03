import { useMemo } from 'react';
import type { MobileToolDrawerConfig } from '../../components/ChatOverlays';
import type { ToolGroupInfo, ToolInvocation, ToolInfo } from '../../types';

type Params = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  groups: ToolGroupInfo[];
  history: ToolInvocation[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onSelectTool: (tool: ToolInfo) => void;
  searchRef: React.RefObject<HTMLInputElement>;
};

export function useToolDrawerConfig(params: Params): MobileToolDrawerConfig {
  const { isOpen, setIsOpen, groups, history, favorites, onToggleFavorite, onSelectTool, searchRef } = params;

  return useMemo(
    () => ({
      open: isOpen,
      onClose: () => setIsOpen(false),
      groups,
      history,
      favorites,
      onToggleFavorite,
      onSelectTool,
      searchRef,
    }),
    [favorites, groups, history, isOpen, onSelectTool, onToggleFavorite, searchRef, setIsOpen],
  );
}
