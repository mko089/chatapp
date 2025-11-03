import React from 'react';
import type { ToolGroupInfo, ToolInvocation, ToolInfo } from '../types';
import { ToolDock } from './ToolDock';

type DesktopToolDockProps = {
  open: boolean;
  groups: ToolGroupInfo[];
  history: ToolInvocation[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onSelectTool: (tool: ToolInfo) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
};

export function DesktopToolDock({ open, groups, history, favorites, onToggleFavorite, onSelectTool, searchRef }: DesktopToolDockProps) {
  return (
    <div className="hidden lg:block lg:w-80 lg:flex-shrink-0">
      <ToolDock
        open={open}
        groups={groups}
        history={history}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        onSelectTool={onSelectTool}
        searchRef={searchRef}
      />
    </div>
  );
}
