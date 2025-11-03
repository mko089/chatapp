import { useCallback, useReducer } from 'react';
import type { ChatMessage, ToolInvocation } from '../types';
import { computeAssistantToolCounts } from '../utils/sessionMetrics';

type Updater<T> = T | ((prev: T) => T);

type ConvState = {
  history: ChatMessage[];
  toolResults: ToolInvocation[];
  assistantToolCounts: number[];
  pendingMessages: ChatMessage[];
  // streaming helpers
  streamUserMessage: ChatMessage | null;
  streamAssistant: string;
  streamAssistantIndex: number; // index in pendingMessages where assistant should be appended
  toolArgsById: Record<string, unknown>;
  toolIndexById: Record<string, number>;
};

type Action =
  | { type: 'SET_ALL'; history: ChatMessage[]; toolResults: ToolInvocation[] }
  | { type: 'SET_HISTORY'; value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]) }
  | { type: 'SET_TOOL_RESULTS'; value: ToolInvocation[] | ((prev: ToolInvocation[]) => ToolInvocation[]) }
  | { type: 'APPEND_TOOL_RESULT'; invocation: ToolInvocation }
  | { type: 'SET_PENDING'; value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]) }
  | { type: 'RESET_CONVERSATION' }
  | { type: 'STREAM_BEGIN'; userMessage: ChatMessage }
  | { type: 'ASSISTANT_DELTA'; text: string }
  | { type: 'ASSISTANT_DONE'; content: string; llmDurationMs?: number }
  | { type: 'TOOL_STARTED'; id: string; name: string; args: unknown }
  | { type: 'TOOL_COMPLETED'; id: string; name: string; result: unknown }
  | { type: 'CLEAR_PENDING' };

function recalc(history: ChatMessage[], toolResults: ToolInvocation[]): number[] {
  return computeAssistantToolCounts(history, toolResults);
}

function reduce(state: ConvState, action: Action): ConvState {
  switch (action.type) {
    case 'SET_ALL': {
      const h = action.history;
      const t = action.toolResults;
      return {
        ...state,
        history: h,
        toolResults: t,
        assistantToolCounts: recalc(h, t),
        toolArgsById: {},
        toolIndexById: {},
      };
    }
    case 'SET_HISTORY': {
      const next = typeof action.value === 'function' ? (action.value as any)(state.history) : action.value;
      return { ...state, history: next, assistantToolCounts: recalc(next, state.toolResults) };
    }
    case 'SET_TOOL_RESULTS': {
      const next = typeof action.value === 'function' ? (action.value as any)(state.toolResults) : action.value;
      return {
        ...state,
        toolResults: next,
        assistantToolCounts: recalc(state.history, next),
        toolArgsById: {},
        toolIndexById: {},
      };
    }
    case 'SET_PENDING': {
      const next = typeof action.value === 'function' ? (action.value as any)(state.pendingMessages) : action.value;
      return { ...state, pendingMessages: next };
    }
    case 'APPEND_TOOL_RESULT': {
      const next = [...state.toolResults, action.invocation];
      return {
        ...state,
        toolResults: next,
        assistantToolCounts: recalc(state.history, next),
      };
    }
    case 'RESET_CONVERSATION': {
      return {
        ...state,
        history: [],
        toolResults: [],
        assistantToolCounts: [],
        pendingMessages: [],
        streamUserMessage: null,
        streamAssistant: '',
        streamAssistantIndex: 0,
        toolArgsById: {},
        toolIndexById: {},
      };
    }
    case 'STREAM_BEGIN': {
      const idx = state.pendingMessages.length;
      return {
        ...state,
        pendingMessages: [...state.pendingMessages, action.userMessage],
        streamUserMessage: action.userMessage,
        streamAssistant: '',
        streamAssistantIndex: idx,
      };
    }
    case 'ASSISTANT_DELTA': {
      if (!state.streamUserMessage) return state;
      const assistantText = state.streamAssistant + action.text;
      const assistantMsg: ChatMessage = { role: 'assistant', content: assistantText } as ChatMessage;
      const before = state.pendingMessages.slice(0, state.streamAssistantIndex + 1);
      const nextPending = [...before, assistantMsg];
      return { ...state, pendingMessages: nextPending, streamAssistant: assistantText };
    }
    case 'ASSISTANT_DONE': {
      if (!state.streamUserMessage) return state;
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: action.content,
        metadata: action.llmDurationMs ? { llmDurationMs: action.llmDurationMs } : undefined,
      } as ChatMessage;
      const before = state.pendingMessages.slice(0, state.streamAssistantIndex + 1);
      const nextPending = [...before, assistantMsg];
      return { ...state, pendingMessages: nextPending, streamAssistant: action.content };
    }
    case 'TOOL_STARTED': {
      const rec: ToolInvocation = { name: action.name, args: action.args, result: { status: 'running' }, timestamp: new Date().toISOString() } as ToolInvocation;
      const index = state.toolResults.length;
      const nextToolResults = [...state.toolResults, rec];
      return {
        ...state,
        toolArgsById: { ...state.toolArgsById, [action.id]: action.args },
        toolIndexById: { ...state.toolIndexById, [action.id]: index },
        toolResults: nextToolResults,
        assistantToolCounts: recalc(state.history, nextToolResults),
      };
    }
    case 'TOOL_COMPLETED': {
      const args = state.toolArgsById[action.id] ?? {};
      const rec: ToolInvocation = { name: action.name, args, result: action.result, timestamp: new Date().toISOString() } as ToolInvocation;
      const index = state.toolIndexById[action.id];
      let toolResults: ToolInvocation[];
      if (typeof index === 'number') {
        toolResults = state.toolResults.map((item, idx) => (idx === index ? rec : item));
      } else {
        toolResults = [...state.toolResults, rec];
      }
      const { [action.id]: _args, ...restArgs } = state.toolArgsById;
      const { [action.id]: _index, ...restIndex } = state.toolIndexById;
      return {
        ...state,
        toolArgsById: restArgs,
        toolIndexById: restIndex,
        toolResults,
        assistantToolCounts: recalc(state.history, toolResults),
      };
    }
    case 'CLEAR_PENDING': {
      return {
        ...state,
        pendingMessages: [],
        streamUserMessage: null,
        streamAssistant: '',
        streamAssistantIndex: 0,
      };
    }
    default:
      return state;
  }
}

export function useConversationState(params: {
  authed: boolean;
  baseUrl: string;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  filterDisplayMessages: (messages: ChatMessage[]) => ChatMessage[];
  refreshSessions: (opts?: { silent?: boolean }) => Promise<void> | void;
  refreshUsage: (id: string) => Promise<void> | void;
  setSelectedProjectId: (id: string | null) => void;
  setCurrentDocPath: (path: string | null) => void;
  setError: (msg: string | null) => void;
}) {
  const { authed, baseUrl, authorizedFetch, filterDisplayMessages, refreshSessions, refreshUsage, setSelectedProjectId, setCurrentDocPath, setError } = params;

  const [state, dispatch] = useReducer(reduce, {
    history: [],
    toolResults: [],
    assistantToolCounts: [],
    pendingMessages: [],
    streamUserMessage: null,
    streamAssistant: '',
    streamAssistantIndex: 0,
    toolArgsById: {},
    toolIndexById: {},
  });

  const resetConversation = useCallback(() => {
    dispatch({ type: 'RESET_CONVERSATION' });
  }, []);

  const replaceToolResults = useCallback((value: ToolInvocation[]) => {
    dispatch({ type: 'SET_TOOL_RESULTS', value });
  }, []);

  const appendToolResult = useCallback((invocation: ToolInvocation) => {
    dispatch({ type: 'APPEND_TOOL_RESULT', invocation });
  }, []);

  const setPendingMessages = useCallback((value: Updater<ChatMessage[]>) => {
    dispatch({ type: 'SET_PENDING', value: value as any });
  }, []);
  const syncConversationState = useCallback((messages: ChatMessage[], toolHistory: ToolInvocation[]) => {
    const displayMessages = filterDisplayMessages(messages);
    const normalizedToolHistory = Array.isArray(toolHistory) ? [...toolHistory] : [];
    dispatch({ type: 'SET_ALL', history: displayMessages, toolResults: normalizedToolHistory });
  }, [filterDisplayMessages]);

  const loadSession = useCallback(async (id: string) => {
    if (!authed) return;
    try {
      const res = await authorizedFetch(`${baseUrl}/sessions/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          dispatch({ type: 'SET_ALL', history: [], toolResults: [] });
          dispatch({ type: 'SET_PENDING', value: [] });
          setSelectedProjectId(null);
          setCurrentDocPath(null);
          try { await Promise.resolve(refreshSessions({ silent: true }) as any); } catch {}
          setError('Sesja nie istnieje lub brak do niej dostępu.');
          return;
        }
        throw new Error(`Nie udało się pobrać sesji (${res.status})`);
      }
      const data = await res.json();
      const toolHistory = (data.toolHistory ?? data.toolResults ?? []) as ToolInvocation[];
      syncConversationState(data.messages ?? [], toolHistory);
      dispatch({ type: 'SET_PENDING', value: [] });
      try { await Promise.resolve(refreshUsage(id) as any); } catch {}
      try { await Promise.resolve(refreshSessions({ silent: true }) as any); } catch {}
      const projectId = data.projectId ?? null;
      setSelectedProjectId(projectId);
      setCurrentDocPath(data.currentDocPath ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać sesji');
    }
  }, [authed, authorizedFetch, baseUrl, refreshSessions, refreshUsage, setSelectedProjectId, setCurrentDocPath, setError, syncConversationState]);

  // Streaming helpers (Etap 3)
  const beginStreaming = useCallback((userMessage: ChatMessage) => {
    dispatch({ type: 'STREAM_BEGIN', userMessage });
  }, []);

  const assistantDelta = useCallback((text: string) => {
    dispatch({ type: 'ASSISTANT_DELTA', text });
  }, []);

  const assistantDone = useCallback((content: string, llmDurationMs?: number) => {
    dispatch({ type: 'ASSISTANT_DONE', content, llmDurationMs });
  }, []);

  const toolStarted = useCallback((id: string, name: string, args: unknown) => {
    dispatch({ type: 'TOOL_STARTED', id, name, args });
  }, []);

  const toolCompleted = useCallback((id: string, name: string, result: unknown) => {
    dispatch({ type: 'TOOL_COMPLETED', id, name, result });
  }, []);

  const clearPending = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING' });
  }, []);

  return {
    history: state.history,
    toolResults: state.toolResults,
    assistantToolCounts: state.assistantToolCounts,
    pendingMessages: state.pendingMessages,
    setPendingMessages,
    syncConversationState,
    loadSession,
    beginStreaming,
    assistantDelta,
    assistantDone,
    toolStarted,
    toolCompleted,
    clearPending,
    resetConversation,
    replaceToolResults,
    appendToolResult,
  };
}
