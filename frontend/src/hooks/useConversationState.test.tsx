import { describe, it, expect } from 'vitest';
import React, { forwardRef, useImperativeHandle } from 'react';
import { render, act } from '@testing-library/react';
import type { ChatMessage } from '../types';
import { useConversationState } from './useConversationState';

type HarnessApi = ReturnType<typeof useConversationState>;

function createHarness() {
  const Harness = forwardRef<HarnessApi>((_props, ref) => {
    const api = useConversationState({
      authed: true,
      baseUrl: 'http://test',
      authorizedFetch: async () => {
        throw new Error('authorizedFetch should not be called in unit tests');
      },
      filterDisplayMessages: (m) => m,
      refreshSessions: () => {},
      refreshUsage: () => {},
      setSelectedProjectId: () => {},
      setCurrentDocPath: () => {},
      setError: () => {},
    });
    useImperativeHandle(ref, () => api, [api]);
    return null;
  });
  Harness.displayName = 'Harness';
  return Harness;
}

describe('useConversationState reducer', () => {
  it('handles streaming delta -> done -> clear', () => {
    const Harness = createHarness();
    const ref = React.createRef<HarnessApi>();
    render(<Harness ref={ref} />);
    const api = () => {
      if (!ref.current) throw new Error('harness not ready');
      return ref.current;
    };

    const userMessage: ChatMessage = { role: 'user', content: 'Hi', timestamp: new Date().toISOString() };
    act(() => {
      api().beginStreaming(userMessage);
    });
    expect(api().pendingMessages.length).toBe(1);
    expect(api().pendingMessages[0].role).toBe('user');

    act(() => {
      api().assistantDelta('Hello');
    });
    expect(api().pendingMessages.length).toBe(2);
    expect(api().pendingMessages[1].role).toBe('assistant');
    expect(api().pendingMessages[1].content).toBe('Hello');

    act(() => {
      api().assistantDelta(' world');
    });
    expect(api().pendingMessages[1].content).toBe('Hello world');

    act(() => {
      api().assistantDone('Hello world!', 123);
    });
    expect(api().pendingMessages[1].content).toBe('Hello world!');

    act(() => {
      api().clearPending();
    });
    expect(api().pendingMessages.length).toBe(0);
  });

  it('records tool started/completed events', () => {
    const Harness = createHarness();
    const ref = React.createRef<HarnessApi>();
    render(<Harness ref={ref} />);
    const api = () => {
      if (!ref.current) throw new Error('harness not ready');
      return ref.current;
    };

    act(() => {
      api().toolStarted('id1', 'meters.list', { a: 1 });
    });
    expect(api().toolResults.length).toBe(1);
    expect((api().toolResults[0].result as any)?.status).toBe('running');

    act(() => {
      api().toolCompleted('id1', 'meters.list', { ok: true });
    });
    expect(api().toolResults.length).toBe(1);
    expect(api().toolResults[0].name).toBe('meters.list');
    expect((api().toolResults[0].result as any)?.ok).toBe(true);
  });
});
