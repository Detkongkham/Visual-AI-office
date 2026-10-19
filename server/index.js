// AI Office server: serves the 2D office and runs the AI employees with the Claude Agent SDK.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { runTask, runTeam, findSuperpowers } from './runner.js';
import { detectAuth, fetchUsage } from './auth.js';
import { createProjects, pickFolder, openFolder, sessionsFor } from './projects.js';
import { sessionChat } from './chat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAM_FILE = path.join(ROOT, 'config', 'team.json');
const PORT = Number(process.env.PORT || 4317);
const DEFAULT_DIR = path.resolve(ROOT, process.env.WORKSPACE_DIR || './workspace');
const TASK_BUDGET = Number(process.env.TASK_BUDGET_USD || 1);
const TEAM_BUDGET = Number(process.env.TEAM_BUDGET_USD || 5);
const LEAD = process.env.TEAM_LEAD || 'somphone';

fs.mkdirSync(DEFAULT_DIR, { recursive: true });
let config = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
const store = createStore(path.join(ROOT, 'data', 'state.json'));
const projects = createProjects(path.join(ROOT, 'data', 'projects.json'), DEFAULT_DIR);
let auth = { mode: 'checking', label: 'ກຳລັງກວດ login…', env: { ...process.env } };
let usage = null; // real plan limits: 5-hour and weekly windows

// live state of each employee
const live = Object.fromEntries(config.agents.map(a => [a.key, { status: 'idle', activity: 'ວ່າງ', taskId: null }]));
const queues = Object.fromEntries(config.agents.map(a => [a.key, []]));
const running = new Map();   // taskId -> AbortController
const approvals = new Map(); // id -> { ...request, resolve }

// ---------- server-sent events ----------
const clients = new Set();
function broadcast(ev) { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); }
function setLive(key, patch) { if (!live[key]) return; Object.assign(live[key], patch); broadcast({ type: 'agent', key, ...live[key] }); }
function taskUpdate(task) { store.touch(); broadcast({ type: 'task', task: publicTask(task) }); }
const publicTask = ({ messages, ...t }) => ({ ...t, log: (t.log || []).slice(-80), messageCount: (messages || []).length });
// chat history entries for a task (what the history view shows)
function addMsg(task, m) { task.messages = task.messages || []; const e = { t: Date.now(), ...m }; task.messages.push(e); if (task.messages.length > 800) task.messages.splice(0, task.messages.length - 800); store.touch(); broadcast({ type: 'msg', taskId: task.id, msg: e }); }
const agentByKey = k => config.agents.find(a => a.key === k);
const publicAuth = () => ({ mode: auth.mode, label: auth.label, email: auth.email, plan: auth.plan });

async function refreshAuth() {
  auth = { mode: 'checking', label: 'ກຳລັງກວດ login…', env: { ...process.env } }; broadcast({ type: 'auth', auth: publicAuth() });
  try { auth = await detectAuth(DEFAULT_DIR); } catch (err) { auth = { mode: 'none', label: 'ກວດ login ບໍ່ໄດ້', error: String(err?.message || err), env: { ...process.env } }; }
  broadcast({ type: 'auth', auth: publicAuth() });
  console.log(`  Sign-in    →  ${auth.label}${auth.plan ? ' · ' + auth.plan : ''}`);
  refreshUsage();
}
let usageBusy = false;
async function refreshUsage() {
  if (auth.mode !== 'login' || usageBusy) { if (auth.mode !== 'login') { usage = null; broadcast({ type: 'usage', usage }); } return usage; }
  usageBusy = true;
  try { const u = await fetchUsage(auth.env, DEFAULT_DIR); if (u) usage = u; } finally { usageBusy = false; }
  broadcast({ type: 'usage', usage }); return usage;
}
setInterval(refreshUsage, 60_000);
// rate-limit events arrive while agents work: update the matching window right away
function applyRateLimit(info) {
  if (!info || !usage) return;
  const key = { five_hour: 'fiveHour', seven_day: 'weekly', seven_day_opus: 'weeklyOpus', seven_day_sonnet: 'weeklySonnet' }[info.rateLimitType];
  if (!key) return;
  usage[key] = { pct: info.utilization != null ? Math.round(info.utilization * (info.utilization <= 1 ? 100 : 1)) : usage[key]?.pct ?? null, resetsAt: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : usage[key]?.resetsAt, status: info.status };
  broadcast({ type: 'usage', usage });
}

// ---------- queue ----------
function enqueue(task) { queues[task.assignee].push(task.id); pump(task.assignee); }
async function pump(key) {
  if (['working', 'waiting', 'meeting'].includes(live[key].status)) return;
  const id = queues[key].shift(); if (!id) return;
  const task = store.task(id); if (!task || task.status !== 'queued') return pump(key);
  await execute(task);
  pump(key);
}

async function execute(task) {
  const lead = agentByKey(task.assignee);
  const log = (kind, text, who) => { task.log.push({ t: Date.now(), kind, text, who }); broadcast({ type: 'log', taskId: task.id, entry: task.log[task.log.length - 1] }); };
  if (!(task.messages || []).length) addMsg(task, { type: 'user', who: 'you', text: [task.title, task.detail].filter(Boolean).join('\n\n') });
  if (auth.mode === 'none') { task.status = 'failed'; task.error = 'ຍັງບໍ່ໄດ້ login Claude Code: ເປີດ Claude Code ໃນ Antigravity ແລ້ວພິມ /login'; taskUpdate(task); return; }
  if (usage?.fiveHour?.pct >= 100) { task.status = 'failed'; task.error = `ໃຊ້ຂີດຈຳກັດ 5 ຊົ່ວໂມງໝົດແລ້ວ. ລໍຖ້າຮອດ ${new Date(usage.fiveHour.resetsAt).toLocaleString()}`; taskUpdate(task); return; }
  const ac = new AbortController(); running.set(task.id, ac);
  const involved = new Set([lead.key]);
  Object.assign(task, { status: 'running', startedAt: Date.now(), model: lead.model, effort: lead.effort });
  taskUpdate(task); projects.touch(task.cwd);
  const team = task.mode === 'team';
  setLive(lead.key, { status: team ? 'meeting' : 'working', activity: team ? 'ປະຊຸມວາງແຜນ' : 'ກຳລັງເລີ່ມວຽກ', taskId: task.id });
  log('info', team ? `${lead.name} ເລີ່ມວາງແຜນກັບທີມ (${lead.model})` : `${lead.name} ຮັບວຽກ (${lead.model}, effort ${lead.effort})`, lead.key);

  const askApproval = (kind, payload) => new Promise(resolve => {
    if (ac.signal.aborted) return resolve(kind === 'plan' ? { allow: false } : false);
    const id = crypto.randomUUID();
    const who = payload.who || lead.key;
    const item = { id, kind, taskId: task.id, agent: who, createdAt: Date.now(), ...payload };
    approvals.set(id, { ...item, resolve });
    task.status = 'waiting'; taskUpdate(task);
    setLive(who, { status: 'waiting', activity: kind === 'plan' ? 'ລໍຖ້າເຈົ້າອະນຸມັດແຜນ' : `ຂໍອະນຸຍາດ: ${payload.summary}` });
    log('approval', kind === 'plan' ? 'ສົ່ງແຜນໃຫ້ເຈົ້າອະນຸມັດ' : `ຂໍອະນຸຍາດ: ${payload.summary}`, who);
    if (kind === 'plan') addMsg(task, { type: 'plan', who, text: payload.plan }); else addMsg(task, { type: 'approval', who, summary: payload.summary, input: payload.input?.command || payload.input?.file_path || null });
    broadcast({ type: 'approval', approval: item });
    ac.signal.addEventListener('abort', () => { if (approvals.delete(id)) { broadcast({ type: 'approvalDone', id }); resolve(kind === 'plan' ? { allow: false } : false); } }, { once: true });
  });

  // a sub-agent's Agent tool can return before the sub-agent stops working, so wait for quiet before calling it done
  const doneTimers = new Map();
  const markDone = (who, isError) => {
    clearTimeout(doneTimers.get(who));
    doneTimers.set(who, setTimeout(() => {
      setLive(who, { status: isError ? 'error' : 'done', activity: isError ? 'ມີບັນຫາ' : 'ສົ່ງວຽກໃຫ້ຫົວໜ້າແລ້ວ', taskId: null }); log('done', `${agentByKey(who)?.name} ສົ່ງວຽກແລ້ວ`, who);
      setTimeout(() => { if (['done', 'error'].includes(live[who].status)) setLive(who, { status: 'idle', activity: 'ວ່າງ' }); }, 6000);
    }, 5000));
  };
  const emit = ev => {
    const who = ev.who || lead.key;
    if (ev.kind === 'tool' || ev.kind === 'say') { const t = doneTimers.get(who); if (t && who !== lead.key) { clearTimeout(t); doneTimers.delete(who); } }
    if (ev.kind === 'chat') { addMsg(task, ev.msg); return; }
    if (ev.kind === 'delegate') { addMsg(task, { type: 'delegate', who: lead.key, to: ev.to, text: ev.text }); involved.add(ev.to); setLive(ev.to, { status: 'working', activity: ev.text, taskId: task.id }); setLive(lead.key, { status: 'working', activity: `ມອບວຽກໃຫ້ ${agentByKey(ev.to)?.name}` }); log('delegate', `${lead.name} → ${agentByKey(ev.to)?.name}: ${ev.text}`, ev.to); }
    else if (ev.kind === 'mateDone') markDone(who, ev.isError);
    else if (ev.kind === 'tool') { if (live[who].status !== 'waiting') setLive(who, { status: live[who].status === 'meeting' ? 'meeting' : 'working', activity: ev.text, mode: ev.activity }); log('tool', ev.text, who); }
    else if (ev.kind === 'say') log('say', ev.text, who);
    else if (ev.kind === 'rateLimit') applyRateLimit(ev.info);
  };
  const onSession = id => { if (!task.sessionId) { task.sessionId = id; taskUpdate(task); } };

  try {
    let result, superpowers;
    if (team) {
      ({ result, superpowers } = await runTeam({
        task, lead, team: config.agents, env: auth.env, budgetUsd: TEAM_BUDGET, abortController: ac, emit, onSession,
        askApproval: req => askApproval('tool', req),
        askPlan: async plan => { task.plan = plan; taskUpdate(task); const res = await askApproval('plan', { plan, summary: 'ແຜນງານ' }); if (res.allow) setLive(lead.key, { status: 'working', activity: 'ເລີ່ມແຈກວຽກຕາມແຜນ' }); else setLive(lead.key, { status: 'meeting', activity: 'ກຳລັງແກ້ແຜນ' }); return res; },
      }));
      task.superpowers = superpowers;
    } else {
      result = await runTask({ task, agent: lead, team: config.agents, env: auth.env, budgetUsd: TASK_BUDGET, abortController: ac, emit, onSession, askApproval: req => askApproval('tool', req) });
    }
    if (!result) throw new Error('ບໍ່ໄດ້ຮັບຜົນຈາກ agent');
    task.costUsd = result.total_cost_usd || 0; task.turns = result.num_turns; store.addSpend(task.costUsd);
    if (result.subtype === 'success' && !result.is_error) {
      Object.assign(task, { status: 'done', result: result.result });
      setLive(lead.key, { status: 'done', activity: 'ວຽກສຳເລັດ 🎉', taskId: null });
      log('done', `ສຳເລັດ · ${result.num_turns} ຮອບ · ປະມານ $${task.costUsd.toFixed(3)}`, lead.key);
      addMsg(task, { type: 'result', who: lead.key, text: result.result, turns: result.num_turns, cost: task.costUsd });
    } else {
      Object.assign(task, { status: 'failed', error: (result.errors || [result.subtype]).join(', ') });
      setLive(lead.key, { status: 'error', activity: 'ວຽກບໍ່ສຳເລັດ', taskId: null });
      log('error', task.error, lead.key);
      addMsg(task, { type: 'error', who: lead.key, text: task.error });
    }
  } catch (err) {
    const stopped = ac.signal.aborted;
    Object.assign(task, { status: stopped ? 'stopped' : 'failed', error: stopped ? 'ຖືກຢຸດໂດຍເຈົ້າ' : String(err?.message || err) });
    setLive(lead.key, { status: stopped ? 'idle' : 'error', activity: stopped ? 'ວ່າງ' : 'ມີບັນຫາ', taskId: null });
    log('error', task.error, lead.key);
    addMsg(task, { type: 'error', who: lead.key, text: task.error });
  } finally {
    running.delete(task.id); task.endedAt = Date.now(); taskUpdate(task);
    for (const t of doneTimers.values()) clearTimeout(t);
    for (const [id, ap] of approvals) if (ap.taskId === task.id) { approvals.delete(id); broadcast({ type: 'approvalDone', id }); ap.resolve(ap.kind === 'plan' ? { allow: false } : false); }
    for (const k of involved) if (k !== lead.key && live[k].taskId === task.id) setLive(k, { status: 'idle', activity: 'ວ່າງ', taskId: null });
    setTimeout(refreshUsage, 1500);
    setTimeout(() => { if (['done', 'error'].includes(live[lead.key].status)) setLive(lead.key, { status: 'idle', activity: 'ວ່າງ' }); }, 8000);
  }
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'web')));
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ error: String(err?.message || err) }));

app.get('/api/state', (req, res) => res.json({
  agents: config.agents.map(a => ({ ...a, ...live[a.key], queued: queues[a.key].length })),
  models: config.models, efforts: config.efforts, lead: LEAD,
  tasks: store.tasks.slice(0, 80).map(publicTask),
  approvals: [...approvals.values()].map(({ resolve, ...a }) => a),
  usage,
  projects: projects.list(),
  auth: publicAuth(),
  superpowers: !!findSuperpowers(),
}));

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n'); clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

app.post('/api/usage/refresh', wrap(async (req, res) => res.json(await refreshUsage())));
app.post('/api/auth/recheck', wrap(async (req, res) => { await refreshAuth(); res.json(publicAuth()); }));

// projects and sessions
app.get('/api/projects', (req, res) => res.json(projects.list()));
app.post('/api/projects', wrap((req, res) => { const p = projects.add(req.body?.path); broadcast({ type: 'projects', projects: projects.list() }); res.json(p); }));
app.post('/api/projects/pick', wrap(async (req, res) => {
  const dir = await pickFolder(); if (!dir) return res.json({ cancelled: true });
  const p = projects.add(dir); broadcast({ type: 'projects', projects: projects.list() }); res.json(p);
}));
app.post('/api/projects/open', wrap(async (req, res) => {
  const { path: dir, editor } = req.body || {};
  if (!projects.has(dir)) throw new Error('ໂຟນເດີນີ້ຍັງບໍ່ຢູ່ໃນລາຍການໂປຣເຈັກ');
  await openFolder(path.resolve(dir), editor); res.json({ ok: true });
}));
app.get('/api/tasks/:id/messages', (req, res) => {
  const t = store.task(req.params.id); if (!t) return res.status(404).json({ error: 'ບໍ່ພົບວຽກ' });
  res.json(t.messages || []);
});
app.get('/api/sessions/:id/messages', wrap(async (req, res) => {
  const dir = String(req.query.dir || ''); if (!projects.has(dir)) throw new Error('ໂຟນເດີນີ້ຍັງບໍ່ຢູ່ໃນລາຍການໂປຣເຈັກ');
  // a session the office ran itself already has the richer task history
  // every office task in this conversation (the first one plus each "continue"), oldest first
  const id = req.params.id;
  const mine = store.tasks.filter(x => (x.sessionId === id || x.resume === id) && (x.messages || []).length).sort((a, b) => a.createdAt - b.createdAt);
  if (mine.length && !mine[0].resume) return res.json(mine.flatMap(x => x.messages));
  // started outside the office (e.g. Claude Code in Antigravity): read the saved transcript, then add office turns
  const past = await sessionChat(id, path.resolve(dir), 'claude');
  res.json(past); // the transcript already contains the office's own turns in this session
}));
app.get('/api/sessions', wrap(async (req, res) => {
  const dir = String(req.query.dir || ''); if (!projects.has(dir)) throw new Error('ໂຟນເດີນີ້ຍັງບໍ່ຢູ່ໃນລາຍການໂປຣເຈັກ');
  res.json(await sessionsFor(path.resolve(dir)));
}));

// change an employee's model / effort
app.patch('/api/agents/:key', (req, res) => {
  const a = agentByKey(req.params.key); if (!a) return res.status(404).json({ error: 'ບໍ່ພົບພະນັກງານ' });
  const { model, effort } = req.body || {};
  if (model) { if (!config.models.some(m => m.id === model)) return res.status(400).json({ error: 'ໂມເດວບໍ່ຖືກຕ້ອງ' }); a.model = model; }
  if (effort) { if (!config.efforts.includes(effort)) return res.status(400).json({ error: 'effort ບໍ່ຖືກຕ້ອງ' }); a.effort = effort; }
  fs.writeFileSync(TEAM_FILE, JSON.stringify(config, null, 2));
  broadcast({ type: 'agentConfig', key: a.key, model: a.model, effort: a.effort });
  res.json(a);
});

// new task: mode 'team' (lead plans + delegates) or 'single' (one employee)
app.post('/api/tasks', wrap((req, res) => {
  const { title, detail = '', mode = 'team', assignee, cwd, resume } = req.body || {};
  if (!title || !String(title).trim()) throw new Error('ກະລຸນາໃສ່ຫົວຂໍ້ວຽກ');
  const key = mode === 'team' ? LEAD : assignee;
  if (!agentByKey(key)) throw new Error('ກະລຸນາເລືອກພະນັກງານ');
  const project = projects.add(cwd || DEFAULT_DIR);
  const task = store.addTask({ id: crypto.randomUUID().slice(0, 8), mode: mode === 'team' ? 'team' : 'single', title: String(title).trim(), detail: String(detail), assignee: key, cwd: project.path, resume: resume || null, status: 'queued', createdAt: Date.now(), log: [], costUsd: 0 });
  broadcast({ type: 'projects', projects: projects.list() });
  taskUpdate(task); enqueue(task); res.json(publicTask(task));
}));

app.post('/api/tasks/:id/stop', (req, res) => {
  const task = store.task(req.params.id); if (!task) return res.status(404).end();
  const ac = running.get(task.id);
  if (ac) ac.abort();
  else if (task.status === 'queued') { task.status = 'stopped'; task.error = 'ຖືກຍົກເລີກ'; queues[task.assignee] = queues[task.assignee].filter(i => i !== task.id); taskUpdate(task); }
  res.json({ ok: true });
});

app.post('/api/approvals/:id', (req, res) => {
  const ap = approvals.get(req.params.id); if (!ap) return res.status(404).json({ error: 'ຄຳຂໍນີ້ໝົດອາຍຸແລ້ວ' });
  approvals.delete(ap.id);
  const allow = Boolean(req.body?.allow), feedback = String(req.body?.feedback || '');
  const task = store.task(ap.taskId);
  if (task) addMsg(task, { type: 'decision', who: 'you', allow, kind: ap.kind, text: feedback });
  if (task && task.status === 'waiting') { task.status = 'running'; task.log.push({ t: Date.now(), kind: 'info', text: allow ? 'ເຈົ້າອະນຸມັດແລ້ວ' : `ເຈົ້າບໍ່ອະນຸມັດ${feedback ? ': ' + feedback : ''}` }); taskUpdate(task); }
  if (ap.kind !== 'plan') setLive(ap.agent, { status: 'working', activity: allow ? 'ໄດ້ຮັບອະນຸຍາດ ກຳລັງເຮັດຕໍ່' : 'ຖືກປະຕິເສດ ກຳລັງຫາທາງອື່ນ' });
  broadcast({ type: 'approvalDone', id: ap.id });
  ap.resolve(ap.kind === 'plan' ? { allow, feedback } : allow); res.json({ ok: true });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AI Office  →  http://localhost:${PORT}`);
  console.log(`  Projects   →  ${projects.list().map(p => p.path).join(', ')}`);
  console.log(`  Superpowers→  ${findSuperpowers() ? 'ພົບແລ້ວ' : 'ບໍ່ພົບ (ໂໝດທີມຈະວາງແຜນເອງ)'}`);
  refreshAuth();
});
