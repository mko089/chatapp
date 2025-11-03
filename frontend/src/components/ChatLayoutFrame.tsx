import type { ReactNode } from 'react';
import { ChatLayout } from './ChatLayout';

type Props = {
  sidebar: ReactNode;
  sidebarClassName: string;
  header: ReactNode;
  contextBar: ReactNode;
  statusBar: ReactNode;
  errorBanner: ReactNode;
  messageArea: ReactNode;
  desktopToolDock: ReactNode;
  chatInput: ReactNode;
  overlays: ReactNode;
};

export function ChatLayoutFrame({
  sidebar,
  sidebarClassName,
  header,
  contextBar,
  statusBar,
  errorBanner,
  messageArea,
  desktopToolDock,
  chatInput,
  overlays,
}: Props) {
  return (
    <div className="min-h-screen">
      <ChatLayout
        sidebar={sidebar}
        sidebarClassName={sidebarClassName}
        header={header}
        contextBar={contextBar}
        statusBar={statusBar}
        errorBanner={errorBanner}
        messageArea={messageArea}
        desktopToolDock={desktopToolDock}
        chatInput={chatInput}
      />
      {overlays}
    </div>
  );
}
