import { useCallback, useRef } from 'react';
import type { ChatMessage, ToolInvocation } from '../types';
import type { BudgetEvaluation } from '../types';
import { systemMessage } from '../constants/chat';
import { extractUsageSummary, type UsageSummary } from '../utils/health';

export function useChatInteractor(params: {
  authed: boolean;
  baseUrl: string;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  chatStream: (
    url: string,
    payload: unknown,
    handlers: {
      onAssistantDelta?: (text: string) => void;
      onAssistantDone?: (content: string, ms?: number) => void;
      onToolStarted?: (id: string, name: string, args: unknown) => void;
      onToolCompleted?: (id: string, name: string, result: unknown) => void;
      onBudgetWarning?: (details?: unknown) => void;
      onBudgetBlocked?: (details?: unknown) => void;
      onFinal?: (sessionId: string, messages: ChatMessage[], toolHistory: ToolInvocation[]) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ) => Promise<void>;
  sessionId: string | null;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  selectedModel: string;
  history: ChatMessage[];
  toolResults: ToolInvocation[];
  pendingMessages: ChatMessage[];
  selectedProjectId: string | null;
  currentDocPath: string | null;
  beginStreaming: (user: ChatMessage) => void;
  assistantDelta: (chunk: string) => void;
  assistantDone: (content: string, ms?: number) => void;
  toolStarted: (id: string, name: string, args: unknown) => void;
  toolCompleted: (id: string, name: string, result: unknown) => void;
  syncConversationState: (messages: ChatMessage[], toolHistory: ToolInvocation[]) => void;
  clearPending: () => void;
  setBudgetWarning: (v: boolean) => void;
  setBudgetEvaluation: (v: BudgetEvaluation | null) => void;
  refreshUsage: (id: string) => void | Promise<void>;
  refreshSessions: (opts?: { silent?: boolean }) => void | Promise<void>;
  setUsageSummary: (v: UsageSummary | null) => void;
  setIsBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
}) {
  const {
    authed,
    baseUrl,
    authorizedFetch,
    chatStream,
    sessionId,
    navigate,
    selectedModel,
    history,
    toolResults,
    pendingMessages,
    selectedProjectId,
    currentDocPath,
    beginStreaming,
    assistantDelta,
    assistantDone,
    toolStarted,
    toolCompleted,
    syncConversationState,
    clearPending,
    setBudgetWarning,
    setBudgetEvaluation,
    refreshUsage,
    refreshSessions,
    setUsageSummary,
    setIsBusy,
    setError,
  } = params;

  const streamAbortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!authed) {
      setError('Brak autoryzacji — zaloguj się, aby kontynuować.');
      return;
    }
    setError(null);
    setIsBusy(true);

    const generatedSession = (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const resolvedSessionId = sessionId ?? generatedSession;
    if (!sessionId) {
      navigate(`/${resolvedSessionId}`, { replace: true });
    }

    const now = new Date();
    const localeFormatter = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'medium' });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

    const userMessage: ChatMessage = { role: 'user', content, timestamp: now.toISOString() };
    const contextMessage: ChatMessage = {
      role: 'system',
      content: `Aktualny czas użytkownika: ${localeFormatter.format(now)} (strefa ${timeZone})`,
      timestamp: now.toISOString(),
    };
    const projectMessage: ChatMessage | null = selectedProjectId
      ? {
          role: 'system',
          content: [
            `Kontekst projektu: pracujemy w projekcie "${selectedProjectId}".`,
            currentDocPath
              ? `Domyślny dokument do edycji: "${currentDocPath}". Zapisuj zmiany w tym pliku, chyba że użytkownik poprosi o inny.`
              : 'Jeśli zapisujesz nowy dokument, zaproponuj przyjazną nazwę pliku HTML w obrębie projektu.',
            'Do tworzenia lub aktualizacji plików HTML używaj narzędzi projects_* (szczególnie projects_upsert_doc).',
            'Generuj treść jako czysty HTML pasujący do sekcji <body> (bez <html> ani <head>).',
            'If you need to edit documents, use the projects_* MCP tools. Produce valid HTML body fragments and avoid Markdown.',
          ].join('\n'),
          timestamp: now.toISOString(),
        }
      : null;

    beginStreaming(userMessage);

    const messageChain = [systemMessage, ...(projectMessage ? [projectMessage] : []), contextMessage, ...history, userMessage];
    const payload = { sessionId: resolvedSessionId, messages: messageChain, model: selectedModel || undefined };

    try {
      const streamingEnabled = ((): boolean => {
        try {
          const rc = (globalThis as any).window?.__CHATAPP_CONFIG || {};
          const v = (rc as any).chatStreaming;
          if (typeof v !== 'undefined') {
            if (typeof v === 'boolean') return v;
            return v.toString().toLowerCase() !== 'false' && v.toString() !== '0';
          }
        } catch {}
        const raw = ((import.meta as any)?.env?.VITE_CHAT_STREAMING ?? 'false').toString();
        return raw.toLowerCase() !== 'false' && raw !== '0';
      })();

      if (streamingEnabled) {
        const controller = new AbortController();
        streamAbortRef.current = controller;
        await chatStream(`${baseUrl}/chat/stream`, payload, {
          onAssistantDelta: (text) => assistantDelta(text),
          onAssistantDone: (final, ms) => assistantDone(final, ms),
          onToolStarted: (id, name, args) => toolStarted(id, name, args),
          onToolCompleted: (id, name, result) => toolCompleted(id, name, result),
          onBudgetWarning: () => setBudgetWarning(true),
          onBudgetBlocked: () => { setBudgetWarning(true); setError('Przekroczono limit budżetu'); },
          onFinal: (sid, messages, historyItems) => {
            const newSessionId = sid || resolvedSessionId;
            if (newSessionId !== sessionId) {
              navigate(`/${newSessionId}`, { replace: true });
            }
            const mergedToolHistory = Array.isArray(historyItems) ? (historyItems as ToolInvocation[]) : [];
            const finalToolHistory = mergedToolHistory.length > 0 ? mergedToolHistory : toolResults;
            const serverMessages: ChatMessage[] = Array.isArray(messages) ? (messages as ChatMessage[]) : [];
            if (serverMessages.length > 0) {
              syncConversationState(serverMessages, finalToolHistory);
            } else {
              const lastPending = pendingMessages[pendingMessages.length - 1];
              const maybeAssistant = lastPending && lastPending.role === 'assistant' ? [lastPending] : [];
              syncConversationState([...history, userMessage, ...maybeAssistant], finalToolHistory);
            }
            clearPending();
            void refreshUsage(newSessionId);
            void refreshSessions({ silent: true });
          },
          onError: (message) => setError(message),
        }, controller.signal);
      } else {
        const response = await authorizedFetch(`${baseUrl}/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(bodyText || `Błąd ${response.status}`);
        }
        const data = await response.json();
        if (data?.budgets?.after) setBudgetEvaluation(data.budgets.after as BudgetEvaluation);
        else if (data?.budgets?.before) setBudgetEvaluation(data.budgets.before as BudgetEvaluation);

        const assistantMessage: ChatMessage | undefined = data?.message;
        const newSessionId: string = data?.sessionId ?? resolvedSessionId;
        if (newSessionId !== sessionId) navigate(`/${newSessionId}`, { replace: true });

        const combinedToolHistory: ToolInvocation[] = Array.isArray(data?.toolHistory)
          ? data.toolHistory
          : Array.isArray(data?.toolResults)
            ? [...toolResults, ...data.toolResults]
            : toolResults;

        const serverMessages: ChatMessage[] | undefined = data?.messages;
        if (serverMessages && serverMessages.length > 0) {
          syncConversationState(serverMessages, combinedToolHistory);
        } else if (assistantMessage) {
          syncConversationState([...history, userMessage, assistantMessage], combinedToolHistory);
        } else {
          syncConversationState([...history, userMessage], combinedToolHistory);
        }
        clearPending();
        const normalizedUsage = extractUsageSummary(data?.usage);
        if (normalizedUsage) setUsageSummary(normalizedUsage);
        else void refreshUsage(newSessionId);
        void refreshSessions({ silent: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nieznany błąd';
      setError(message);
    } finally {
      setIsBusy(false);
      streamAbortRef.current = null;
    }
  }, [
    authed, baseUrl, authorizedFetch, chatStream, sessionId, navigate,
    selectedModel, history, toolResults, pendingMessages, selectedProjectId, currentDocPath,
    beginStreaming, assistantDelta, assistantDone, toolStarted, toolCompleted,
    syncConversationState, clearPending, setBudgetWarning, setBudgetEvaluation, refreshUsage, refreshSessions,
    setUsageSummary, setIsBusy, setError,
  ]);

  const cancelStream = useCallback(() => {
    const ctrl = streamAbortRef.current;
    if (ctrl) {
      ctrl.abort();
      streamAbortRef.current = null;
      setError('Anulowano.');
      setIsBusy(false);
    }
  }, [setError, setIsBusy]);

  return { sendMessage, cancelStream };
}

