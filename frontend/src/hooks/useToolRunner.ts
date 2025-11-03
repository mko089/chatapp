import { useCallback, useEffect, useState } from 'react';
import type { ToolInvocation } from '../types';
import { formatStructuredValue } from '../utils/format';

export type RunEditorState = { name: string; raw: string; busy: boolean; error: string | null };

export function useToolRunner(params: {
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
  sessionId: string | null;
  onInvocation?: (inv: ToolInvocation) => void;
}) {
  const { authorizedFetch, baseUrl, sessionId, onInvocation } = params;
  const [selectedTool, setSelectedTool] = useState<ToolInvocation | null>(null);
  const [editor, setEditor] = useState<RunEditorState>({ name: '', raw: '', busy: false, error: null });

  useEffect(() => {
    if (!selectedTool) {
      setEditor({ name: '', raw: '', busy: false, error: null });
      return;
    }
    const name = selectedTool.name;
    let raw = '';
    if (selectedTool.rawArgs !== undefined) {
      raw = typeof selectedTool.rawArgs === 'string' ? selectedTool.rawArgs : formatStructuredValue(selectedTool.rawArgs, 2, 'null');
    } else {
      raw = formatStructuredValue(selectedTool.args, 2, '{}');
    }
    setEditor({ name, raw, busy: false, error: null });
  }, [selectedTool]);

  const openTool = useCallback((tool: ToolInvocation) => {
    setSelectedTool(tool);
  }, []);

  const closeTool = useCallback(() => {
    setSelectedTool(null);
  }, []);

  const runTool = useCallback(async () => {
    if (!selectedTool) return;
    setEditor((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const res = await authorizedFetch(`${baseUrl}/mcp/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editor.name || selectedTool.name, rawArgs: editor.raw, sessionId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const inv = data?.invocation as ToolInvocation | undefined;
      if (inv && onInvocation) {
        onInvocation(inv);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Nie udało się uruchomić narzędzia.';
      setEditor((prev) => ({ ...prev, error: msg }));
    } finally {
      setEditor((prev) => ({ ...prev, busy: false }));
    }
  }, [authorizedFetch, baseUrl, editor.name, editor.raw, onInvocation, selectedTool, sessionId]);

  return { selectedTool, openTool, closeTool, editor, setEditor, runTool };
}
