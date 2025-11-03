import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type ProjectInfo = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type TreeNode = {
  type: 'dir' | 'doc';
  path: string;
  title: string;
  children?: TreeNode[];
  updatedAt?: string;
};

const PROJECTS_ROOT = path.resolve(process.cwd(), 'backend/data/projects');

function sanitizeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureHtmlExt(filePath: string): string {
  return filePath.endsWith('.html') ? filePath : `${filePath}.html`;
}

export function resolveProjectDir(projectId: string): string {
  return path.join(PROJECTS_ROOT, sanitizeId(projectId));
}

export async function ensureProject(projectId: string, name?: string): Promise<ProjectInfo> {
  const dir = resolveProjectDir(projectId);
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  const now = new Date().toISOString();
  const metaPath = path.join(dir, 'project.json');
  let meta: ProjectInfo;
  if (existsSync(metaPath)) {
    const raw = JSON.parse(await readFile(metaPath, 'utf-8')) as ProjectInfo;
    meta = { ...raw, id: projectId, name: name ?? raw.name, updatedAt: now };
  } else {
    meta = { id: projectId, name: name ?? projectId, createdAt: now, updatedAt: now };
  }
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  await mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await readdir(PROJECTS_ROOT);
  const out: ProjectInfo[] = [];
  for (const id of entries) {
    const metaPath = path.join(PROJECTS_ROOT, id, 'project.json');
    if (existsSync(metaPath)) {
      try {
        const raw = JSON.parse(await readFile(metaPath, 'utf-8')) as ProjectInfo;
        out.push({ ...raw, id });
      } catch {}
    }
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return out;
}

function safeJoinDocs(projectId: string, relPath: string): string {
  const base = path.join(resolveProjectDir(projectId), 'docs');
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = path.resolve(base, normalized);
  if (!candidate.startsWith(base)) {
    throw new Error('Invalid path');
  }
  return candidate;
}

export async function upsertDoc(projectId: string, relPath: string, html: string): Promise<{ path: string; updatedAt: string }> {
  const filePath = ensureHtmlExt(relPath);
  const abs = safeJoinDocs(projectId, filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, html ?? '', 'utf-8');
  const now = new Date().toISOString();
  // bump project updatedAt
  await ensureProject(projectId);
  return { path: filePath, updatedAt: now };
}

export async function readDoc(projectId: string, relPath: string): Promise<{ html: string; updatedAt: string } | null> {
  const filePath = ensureHtmlExt(relPath);
  const abs = safeJoinDocs(projectId, filePath);
  try {
    const html = await readFile(abs, 'utf-8');
    const st = await stat(abs);
    return { html, updatedAt: st.mtime.toISOString() };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getTree(projectId: string): Promise<TreeNode> {
  const rootDir = path.join(resolveProjectDir(projectId), 'docs');
  await mkdir(rootDir, { recursive: true });
  async function walk(dir: string, rel = ''): Promise<TreeNode> {
    const entries = await readdir(dir, { withFileTypes: true });
    const children: TreeNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = path.posix.join(rel || '', e.name);
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        const subtree = await walk(abs, childRel);
        children.push(subtree);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
        const st = await stat(abs);
        children.push({ type: 'doc', path: childRel, title: path.parse(e.name).name, updatedAt: st.mtime.toISOString() });
      }
    }
    children.sort((a, b) => a.type === b.type ? a.title.localeCompare(b.title) : a.type === 'dir' ? -1 : 1);
    return { type: 'dir', path: rel || '/', title: rel ? path.parse(rel).name : '/', children };
  }
  return walk(rootDir, '');
}

