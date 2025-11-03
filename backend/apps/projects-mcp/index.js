// Projects MCP server (stdio)
// Manages simple filesystem-based project documents (HTML) with a tree view
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'projects-mcp', version: '0.1.0' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.PROJECTS_MCP_LOG ?? path.resolve(__dirname, '../../logs/projects-mcp.log');

function log(message, extra) {
  try {
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const payload = typeof extra === 'undefined' ? message : `${message} ${JSON.stringify(extra)}`;
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${payload}\n`, { encoding: 'utf-8' });
  } catch {}
}

const PROJECTS_DIR_CANDIDATES = [
  process.env.CHATAPP_PROJECTS_DIR,
  path.resolve(__dirname, '../backend/data/projects'),
  path.resolve(__dirname, '../../backend/data/projects'),
  path.resolve(__dirname, '../../data/projects'),
  path.resolve(process.cwd(), 'backend/data/projects'),
  '/workspace/chatapp/backend/data/projects',
  '/home/ubuntu/Projects/chatapp/backend/data/projects',
];

function detectProjectsDir() {
  for (const candidate of PROJECTS_DIR_CANDIDATES) {
    if (!candidate) continue;
    if (existsSync(candidate)) return candidate;
  }
  return PROJECTS_DIR_CANDIDATES.find((c) => typeof c === 'string' && c.length > 0)
    ?? path.resolve(__dirname, '../../backend/data/projects');
}

const PROJECTS_ROOT = detectProjectsDir();
log('Detected projects directory', { projectsRoot: PROJECTS_ROOT });

function sanitizeId(input) {
  return String(input || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureHtmlExt(p) {
  return p.endsWith('.html') ? p : `${p}.html`;
}

function resolveProjectDir(projectId) {
  return path.join(PROJECTS_ROOT, sanitizeId(projectId));
}

async function ensureProject(projectId, name) {
  const dir = resolveProjectDir(projectId);
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  const now = new Date().toISOString();
  const metaPath = path.join(dir, 'project.json');
  let meta;
  if (existsSync(metaPath)) {
    const raw = JSON.parse(await readFile(metaPath, 'utf-8'));
    meta = { ...raw, id: projectId, name: name ?? raw.name, updatedAt: now };
  } else {
    meta = { id: projectId, name: name ?? projectId, createdAt: now, updatedAt: now };
  }
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

async function listProjects() {
  await mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await readdir(PROJECTS_ROOT);
  const out = [];
  for (const id of entries) {
    const metaPath = path.join(PROJECTS_ROOT, id, 'project.json');
    if (existsSync(metaPath)) {
      try {
        const raw = JSON.parse(await readFile(metaPath, 'utf-8'));
        out.push({ ...raw, id });
      } catch {}
    }
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return out;
}

function safeJoinDocs(projectId, relPath) {
  const base = path.join(resolveProjectDir(projectId), 'docs');
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = path.resolve(base, normalized);
  if (!candidate.startsWith(base)) {
    throw new Error('Invalid path');
  }
  return candidate;
}

async function readDoc(projectId, relPath) {
  const filePath = ensureHtmlExt(relPath);
  const abs = safeJoinDocs(projectId, filePath);
  const html = await readFile(abs, 'utf-8');
  const st = await stat(abs);
  return { html, updatedAt: st.mtime.toISOString() };
}

async function upsertDoc(projectId, relPath, html) {
  const filePath = ensureHtmlExt(relPath);
  const abs = safeJoinDocs(projectId, filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, html ?? '', 'utf-8');
  const now = new Date().toISOString();
  await ensureProject(projectId);
  return { path: filePath, updatedAt: now };
}

async function getTree(projectId) {
  const rootDir = path.join(resolveProjectDir(projectId), 'docs');
  await mkdir(rootDir, { recursive: true });
  async function walk(dir, rel = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const children = [];
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
    children.sort((a, b) => (a.type === b.type ? a.title.localeCompare(b.title) : a.type === 'dir' ? -1 : 1));
    return { type: 'dir', path: rel || '/', title: rel ? path.parse(rel).name : '/', children };
  }
  return walk(rootDir, '');
}

// Schemas
const CreateProjectInput = z.object({ name: z.string().min(1), id: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional() });
const ProjectIdInput = z.object({ id: z.string().min(1) });
const ReadDocInput = z.object({ projectId: z.string().min(1), path: z.string().min(1) });
const UpsertDocInput = z.object({ projectId: z.string().min(1), path: z.string().min(1), html: z.string().optional() });

server.registerTool(
  'projects_list_projects',
  {
    title: 'List projects',
    description: 'Returns list of available projects',
    inputSchema: {},
    outputSchema: { projects: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string(), updatedAt: z.string() })) },
  },
  async () => {
    const projects = await listProjects();
    const payload = { projects };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  }
);

server.registerTool(
  'projects_create_project',
  {
    title: 'Create project',
    description: 'Creates a new project with given name (and optional id/slug)',
    inputSchema: CreateProjectInput.shape,
    outputSchema: { project: z.object({ id: z.string(), name: z.string(), createdAt: z.string(), updatedAt: z.string() }) },
  },
  async ({ name, id }) => {
    const pid = id ?? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const project = await ensureProject(pid, name);
    const payload = { project };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  }
);

server.registerTool(
  'projects_get_tree',
  {
    title: 'Get project tree',
    description: 'Returns tree structure of documents and folders for a project',
    inputSchema: ProjectIdInput.shape,
    outputSchema: { id: z.string(), tree: z.any() },
  },
  async ({ id }) => {
    await ensureProject(id);
    const tree = await getTree(id);
    const payload = { id, tree };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  }
);

server.registerTool(
  'projects_read_doc',
  {
    title: 'Read document HTML',
    description: 'Reads a document HTML content from a project',
    inputSchema: ReadDocInput.shape,
    outputSchema: { html: z.string(), updatedAt: z.string() },
  },
  async ({ projectId, path: docPath }) => {
    const doc = await readDoc(projectId, docPath);
    if (!doc) throw new Error('Document not found');
    const payload = { html: doc.html, updatedAt: doc.updatedAt };
    return { content: [{ type: 'text', text: doc.html }], structuredContent: payload };
  }
);

server.registerTool(
  'projects_upsert_doc',
  {
    title: 'Create or update document',
    description: 'Creates or replaces a document HTML at the given path inside project',
    inputSchema: UpsertDocInput.shape,
    outputSchema: { path: z.string(), updatedAt: z.string() },
  },
  async ({ projectId, path: docPath, html }) => {
    const res = await upsertDoc(projectId, docPath, html);
    const payload = { path: res.path, updatedAt: res.updatedAt };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
