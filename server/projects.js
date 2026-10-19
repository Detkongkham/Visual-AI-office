// Project folders the team can work in, plus opening them in an editor and listing past Claude Code sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';

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
    list: () => list,
    add,
    has: p => list.some(x => x.path === norm(p)),
    touch: p => { const i = list.find(x => x.path === norm(p)); if (i) { i.lastUsed = Date.now(); save(); } },
    remove: p => { list = list.filter(x => x.path !== norm(p)); save(); },
  };
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
  return items.map(s => ({ id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || '(ບໍ່ມີຫົວຂໍ້)', firstPrompt: s.firstPrompt, branch: s.gitBranch, updatedAt: s.lastModified }));
}
