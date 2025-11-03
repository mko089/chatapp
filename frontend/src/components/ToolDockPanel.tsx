import { ToolDock } from './ToolDock';
import type { ToolGroupInfo, ToolInvocation, ToolInfo } from '../types';

type SharedProps = {
  groups: ToolGroupInfo[];
  history: ToolInvocation[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onSelectTool: (tool: ToolInfo) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
};

type DesktopProps = SharedProps & {
  variant: 'desktop';
  open: boolean;
};

type MobileProps = SharedProps & {
  variant: 'mobile';
};

type ToolDockPanelProps = DesktopProps | MobileProps;

export function ToolDockPanel(props: ToolDockPanelProps) {
  const { groups, history, favorites, onToggleFavorite, onSelectTool, searchRef } = props;
  const dock = (
    <ToolDock
      open={props.variant === 'desktop' ? props.open : true}
      groups={groups}
      history={history}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onSelectTool={onSelectTool}
      searchRef={searchRef}
    />
  );

  if (props.variant === 'desktop') {
    return <div className="hidden lg:block lg:w-80 lg:flex-shrink-0">{dock}</div>;
  }

  return dock;
}

