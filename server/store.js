// Small JSON-file store for tasks and spend. Good enough for one person running the office locally.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let state = { tasks: [], spend: { date: today(), usd: 0 } };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  // tasks that were running when the server stopped cannot resume
  for (const t of state.tasks) if (t.status === 'running' || t.status === 'waiting' || t.status === 'queued') { t.status = 'stopped'; t.error = 'ເຊີບເວີຖືກປິດກ່ອນວຽກສຳເລັດ'; }

  let timer = null;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(state, null, 2)), 200); };

  return {
    get tasks() { return state.tasks; },
    task(id) { return state.tasks.find(t => t.id === id); },
    addTask(t) { state.tasks.unshift(t); if (state.tasks.length > 300) state.tasks.length = 300; save(); return t; },
    touch: save,
    spentToday() { if (state.spend.date !== today()) state.spend = { date: today(), usd: 0 }; return state.spend.usd; },
    addSpend(usd) { this.spentToday(); state.spend.usd += usd || 0; save(); },
  };
}

function today() { return new Date().toISOString().slice(0, 10); }
