// Resuming a long session makes the model re-read (and, after a pause, re-cache) its whole context on every call.
// Past a size limit the office starts a fresh session instead, seeded with a short handoff built from the transcript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const cap = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '\n…(cut)' : s; };

/** Saved transcript of a Claude Code session, or null. */
export function transcriptPath(sessionId) {
  if (!/^[\w-]+$/.test(String(sessionId || ''))) return null;
  try {
    for (const d of fs.readdirSync(PROJECTS)) {
      const f = path.join(PROJECTS, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* no projects folder */ }
  return null;
}

/** Context size (tokens) of the session's last main-thread call: what a resume would have to load again. */
export function sessionTokens(sessionId) {
  const f = transcriptPath(sessionId); if (!f) return 0;
  const size = fs.statSync(f).size, len = Math.min(size, 512 * 1024), buf = Buffer.alloc(len);
  const fd = fs.openSync(f, 'r'); try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    const u = d.type === 'assistant' && !d.isSidechain && d.message?.usage;
    if (u) { const t = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); if (t) return t; }
  }
  return 0;
}

/** A compact summary of a session to start a fresh one from: the goal, the last plan and the last replies. */
export function sessionHandoff(sessionId) {
  const f = transcriptPath(sessionId); if (!f) return '';
  let goal = '', plan = ''; const replies = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain || d.isMeta) continue;
    const c = d.message?.content;
    if (d.type === 'user' && !goal) {
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
      const clean = t.replace(/<[\w-]+>[\s\S]*?<\/[\w-]+>/g, '').trim();
      if (clean) goal = clean;
    } else if (d.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'ExitPlanMode' && b.input?.plan) plan = b.input.plan;
        else if (b.type === 'text' && b.text?.trim()) { replies.push(b.text.trim()); if (replies.length > 3) replies.shift(); }
      }
    }
  }
  return [
    `This continues earlier work (session ${sessionId}). Only a summary is carried over; check the files themselves for details.`,
    goal && `Original request:\n${cap(goal, 2000)}`,
    plan && `Last plan:\n${cap(plan, 6000)}`,
    replies.length && `Last replies:\n${cap(replies.join('\n\n---\n\n'), 3000)}`,
  ].filter(Boolean).join('\n\n');
}
