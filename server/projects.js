// Project folders the team can work in, plus opening them in an editor and listing past Claude Code sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { sessionTokens } from './handoff.js';

const EDITORS = {
  antigravity: ['Antigravity'],
  vscode: ['Visual Studio Code'],
  finder: [],
};

export function createProjects(file, defaultDir) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const save = () => fs.writeFileSync(file, JSON.stringify(list, null, 2));
  const norm = p => path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
  const add = (p, name) => {
    const dir = norm(p);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('ບໍ່ພົບໂຟນເດີນີ້: ' + dir);
    let item = list.find(x => x.path === dir);
    if (!item) { item = { path: dir, name: name || path.basename(dir) }; list.unshift(item); }
    item.lastUsed = Date.now(); list.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)); save();
    return item;
  };
  if (!list.length) add(defaultDir, 'workspace');

  return {
    list: () => list.map(p => ({ ...p, ...folderWarning(p.path) })),
    add,
    has: p => list.some(x => x.path === norm(p)),
    touch: p => { const i = list.find(x => x.path === norm(p)); if (i) { i.lastUsed = Date.now(); save(); } },
    remove: p => { list = list.filter(x => x.path !== norm(p)); save(); },
  };
}

const isProject = dir => ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].some(f => fs.existsSync(path.join(dir, f)));
/** A folder that only holds other projects makes the team search far more than it needs to; suggest the project inside. */
export function folderWarning(dir) {
  try {
    if (isProject(dir)) return {};
    const inner = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map(d => path.join(dir, d.name)).filter(isProject);
    return inner.length ? { warn: 'ໂຟນເດີນີ້ບໍ່ແມ່ນໂປຣເຈັກ ແຕ່ມີໂປຣເຈັກຢູ່ຂ້າງໃນ. ເລືອກໂຟນເດີຂອງໂປຣເຈັກໂດຍກົງ ເພື່ອໃຫ້ AI ຄົ້ນຫາໜ້ອຍລົງ ແລະ ປະຢັດ token', inner } : {};
  } catch { return {}; }
}

// ---------- finding folders on this Mac ----------
// folders never worth walking into; the office settings can replace this list
const SKIP = ['node_modules', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'vendor', 'venv', '.venv', 'dist', 'build', 'target', '__pycache__', 'Pods', 'DerivedData'];
const visibleWith = skip => { const set = new Set(skip); return d => d.isDirectory() && !d.name.startsWith('.') && !set.has(d.name); };
const entry = dir => ({ path: dir, name: path.basename(dir) || dir, project: isProject(dir) });
const byProject = (a, b) => (b.project - a.project) || a.name.localeCompare(b.name);

/** Sub-folders of a folder (default: home), for browsing. */
export async function listFolder(dir, { skip = SKIP } = {}) {
  const visible = visibleWith(skip);
  const d = path.resolve(String(dir || '').replace(/^~(?=$|\/)/, os.homedir()) || os.homedir());
  const items = await fs.promises.readdir(d, { withFileTypes: true });
  return { path: d, parent: d === path.dirname(d) ? null : path.dirname(d), home: os.homedir(), folders: items.filter(visible).map(x => entry(path.join(d, x.name))).sort(byProject) };
}

/** Folders under home whose name contains the query; project folders first. Bounded so it answers fast:
 *  folders are read in parallel batches, and the search does not walk inside a project's own source tree. */
export async function searchFolders(query, { maxDepth = 6, maxDirs = 30000, maxMs = 3000, limit = 40, skip = SKIP } = {}) {
  const visible = visibleWith(skip);
  const q = String(query || '').trim().toLowerCase(); if (!q) return [];
  const start = Date.now(), found = [];
  let level = [os.homedir()], seen = 0;
  for (let depth = 0; depth <= maxDepth && level.length && seen < maxDirs && Date.now() - start < maxMs; depth++) {
    const next = [];
    for (let i = 0; i < level.length && Date.now() - start < maxMs; i += 64) {
      const batch = level.slice(i, i + 64); seen += batch.length;
      const lists = await Promise.all(batch.map(d => fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])));
      lists.forEach((items, k) => {
        for (const x of items) {
          if (!visible(x)) continue;
          const full = path.join(batch[k], x.name), hit = x.name.toLowerCase().includes(q);
          const proj = (hit || depth < maxDepth) && isProject(full);
          if (hit) found.push({ path: full, name: x.name, project: proj });
          if (depth < maxDepth && !proj) next.push(full);
        }
      });
    }
    level = next;
  }
  return found.sort(byProject).slice(0, limit);
}

/** Native macOS folder picker. Resolves to an absolute path, or null when cancelled. */
export function pickFolder() {
  return new Promise(resolve => {
    execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "ເລືອກໂຟນເດີໂປຣເຈັກ")'], (err, out) => resolve(err ? null : out.trim().replace(/\/$/, '')));
  });
}

/** Open a folder in Antigravity, VS Code or Finder. */
export function openFolder(dir, editor = 'antigravity') {
  const app = EDITORS[editor] ?? EDITORS.antigravity;
  const args = app.length ? ['-a', app[0], dir] : [dir];
  return new Promise((resolve, reject) => execFile('open', args, err => err ? reject(err) : resolve()));
}

/** Past Claude Code sessions for a folder (includes sessions started from the IDE extension). */
export async function sessionsFor(dir, limit = 25) {
  const items = await listSessions({ dir, limit });
  return items.map(s => ({ id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || '(ບໍ່ມີຫົວຂໍ້)', firstPrompt: s.firstPrompt, branch: s.gitBranch, updatedAt: s.lastModified, tokens: sessionTokens(s.sessionId) }));
}
