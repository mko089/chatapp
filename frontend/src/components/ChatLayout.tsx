import React from 'react';

type ChatLayoutProps = {
  sidebar: React.ReactNode;
  sidebarClassName?: string;
  header: React.ReactNode;
  contextBar?: React.ReactNode;
  statusBar?: React.ReactNode;
  errorBanner?: React.ReactNode;
  messageArea: React.ReactNode;
  desktopToolDock?: React.ReactNode;
  chatInput: React.ReactNode;
};

export function ChatLayout({
  sidebar,
  sidebarClassName,
  header,
  contextBar,
  statusBar,
  errorBanner,
  messageArea,
  desktopToolDock,
  chatInput,
}: ChatLayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-screen-2xl gap-4 px-4 pb-32 pt-6">
      <aside className={`hidden lg:flex transition-[width] duration-200 ${sidebarClassName ?? ''}`}>
        {sidebar}
      </aside>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        {header}
        {contextBar ?? null}
        {statusBar ?? null}
        {errorBanner ?? null}
        <div className="flex flex-1 flex-col gap-6 lg:flex-row">
          {messageArea}
          {desktopToolDock ?? null}
        </div>
        {chatInput}
      </div>
    </div>
  );
}
