import { useEffect, useMemo, useState } from 'react';

type ProjectInfo = { id: string; name: string; createdAt: string; updatedAt: string };
type TreeNode = { type: 'dir' | 'doc'; path: string; title: string; updatedAt?: string; children?: TreeNode[] };

interface ProjectsSidebarProps {
  baseUrl: string;
  authorizedFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  open: boolean;
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenDoc: (path: string) => void;
  refreshKey?: number;
}

export function ProjectsSidebar({ baseUrl, authorizedFetch, open, selectedProjectId, onSelectProject, onOpenDoc, refreshKey }: ProjectsSidebarProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    authorizedFetch(`${baseUrl}/projects`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list: ProjectInfo[] = Array.isArray(data?.projects) ? data.projects : [];
        if (mounted) setProjects(list);
        if (mounted && list.length > 0 && !selectedProjectId) {
          onSelectProject(list[0].id);
        }
      })
      .catch((err) => { if (mounted) setError(err instanceof Error ? err.message : String(err)); });
    return () => { mounted = false; };
  }, [authorizedFetch, baseUrl, open, onSelectProject, selectedProjectId]);

  useEffect(() => {
    if (!open || !selectedProjectId) { setTree(null); return; }
    let mounted = true;
    setLoading(true);
    setError(null);
    authorizedFetch(`${baseUrl}/projects/${encodeURIComponent(selectedProjectId)}/tree`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const t = data?.tree as TreeNode;
        if (mounted) setTree(t || null);
      })
      .catch((err) => { if (mounted) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (mounted) setLoading(false); });
  }, [authorizedFetch, baseUrl, open, selectedProjectId, refreshKey]);

  const handleCreateProject = async () => {
    const name = window.prompt('Nazwa projektu:');
    if (!name) return;
    try {
      const res = await authorizedFetch(`${baseUrl}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p = data?.project as ProjectInfo;
      setProjects((prev) => [p, ...prev]);
      onSelectProject(p.id);
    } catch (err) {
      alert(`Nie udało się utworzyć projektu: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateDoc = async () => {
    if (!selectedProjectId) return;
    const path = window.prompt('Ścieżka dokumentu (np. zakresy/KierownikSali.html):');
    if (!path) return;
    const normalized = normalizeDocPath(path);
    const html = '<h1>Nowy dokument</h1>\n<p>Treść…</p>';
    try {
      const res = await authorizedFetch(`${baseUrl}/projects/${encodeURIComponent(selectedProjectId)}/doc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: normalized, html }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // refresh tree
      const r2 = await authorizedFetch(`${baseUrl}/projects/${encodeURIComponent(selectedProjectId)}/tree`);
      if (r2.ok) {
        const data = await r2.json();
        setTree(data?.tree || null);
      }
      onOpenDoc(normalized);
    } catch (err) {
      alert(`Nie udało się zapisać dokumentu: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggle = (nodePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodePath)) next.delete(nodePath); else next.add(nodePath);
      return next;
    });
  };

  if (!open) return null;

  return (
    <aside className="w-full lg:w-80">
      <div className="glass-panel flex h-full max-h-[calc(100vh-3rem)] flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Projekty</div>
            <div className="text-xs text-slate-400">Dokumenty HTML</div>
          </div>
          <button
            type="button"
            onClick={handleCreateProject}
            className="rounded-full border border-primary/50 bg-primary/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/30"
          >
            Nowy
          </button>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          <span>Projekt</span>
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => onSelectProject(e.target.value)}
            className="flex-1 bg-transparent text-sm font-semibold text-white outline-none"
          >
            {projects.length === 0 ? (
              <option value="" className="bg-surface-muted text-slate-400">Brak projektów</option>
            ) : null}
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="bg-surface-muted text-slate-100">{p.name}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-500">Dokumenty</div>
          <button
            type="button"
            onClick={handleCreateDoc}
            disabled={!selectedProjectId}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Nowy dokument
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin">
          {error ? (
            <div className="rounded-xl border border-danger/40 bg-danger/15 px-3 py-2 text-xs text-danger">{error}</div>
          ) : loading ? (
            <div className="text-xs text-slate-400">Ładowanie…</div>
          ) : !tree ? (
            <div className="text-xs text-slate-500">Brak danych</div>
          ) : (
            <Tree
              node={tree}
              expanded={expanded}
              onToggle={toggle}
              onOpenDoc={(p) => onOpenDoc(p)}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

function Tree({ node, expanded, onToggle, onOpenDoc }: { node: TreeNode; expanded: Set<string>; onToggle: (p: string) => void; onOpenDoc: (p: string) => void }) {
  if (node.type === 'doc') {
    return (
      <div className="pl-2">
        <button type="button" onClick={() => onOpenDoc(node.path)} className="w-full truncate text-left text-sm text-slate-200 hover:text-white">
          📄 {node.title}
        </button>
      </div>
    );
  }

  const isRoot = node.path === '/' || node.path === '';
  const key = isRoot ? '/' : node.path;
  const open = expanded.has(key) || isRoot;
  return (
    <div className="space-y-1">
      {!isRoot ? (
        <button type="button" onClick={() => onToggle(key)} className="w-full truncate text-left text-sm text-slate-300 hover:text-slate-100">
          {open ? '📂' : '📁'} {node.title}
        </button>
      ) : null}
      {open ? (
        <div className={!isRoot ? 'pl-3' : ''}>
          {(node.children ?? []).map((child) => (
            <Tree key={child.path} node={child} expanded={expanded} onToggle={onToggle} onOpenDoc={onOpenDoc} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeDocPath(input: string): string {
  const trimmed = input.trim().replace(/^\/+/, '');
  if (!trimmed.toLowerCase().endsWith('.html')) {
    return `${trimmed}.html`;
  }
  return trimmed;
}
