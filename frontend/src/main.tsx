import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ProjectExplorerPage from './pages/ProjectExplorerPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AuthProvider } from './auth/AuthProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { ErrorBoundary } from './components/ErrorBoundary';

const explorerQueryClient = new QueryClient();

function ExplorerApp() {
  return (
    <AuthProvider>
      <QueryClientProvider client={explorerQueryClient}>
        <ProjectExplorerPage />
      </QueryClientProvider>
    </AuthProvider>
  );
}

function RedirectToNewSession() {
  const newId = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return <Navigate to={`/${newId}`} replace />;
}

function RootRouter() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RedirectToNewSession />} />
          <Route path=":sessionId" element={<App />} />
          <Route path="explorer" element={<ExplorerApp />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

const rootElement = document.getElementById('root') as HTMLElement;
const rootComponent = <RootRouter />;

ReactDOM.createRoot(rootElement).render(
  import.meta.env.DEV ? rootComponent : <React.StrictMode>{rootComponent}</React.StrictMode>,
);
