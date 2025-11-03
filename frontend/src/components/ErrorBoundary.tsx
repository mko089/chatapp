import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface px-6">
          <div className="glass-panel max-w-lg w-full p-6 text-center text-slate-200">
            <h1 className="text-xl font-semibold text-white">Wystąpił błąd aplikacji</h1>
            <p className="mt-2 text-sm text-slate-400">Odśwież stronę lub spróbuj ponownie później.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

