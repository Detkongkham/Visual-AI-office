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
import { createProjects, pickFolder, openFolder, sessionsFor, listFolder, searchFolders } from './projects.js';
import { sessionChat } from './chat.js';
import { createApprovals, autoEffective } from './approvals.js';
import { sessionTokens, sessionHandoff } from './handoff.js';
import { createSettings } from './settings.js';
import { createTeam } from './team.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAM_FILE = path.join(ROOT, 'config', 'team.json');
const PORT = Number(process.env.PORT || 4317);
const DEFAULT_DIR = path.resolve(ROOT, process.env.WORKSPACE_DIR || './workspace');

fs.mkdirSync(DEFAULT_DIR, { recursive: true });
let config = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
const store = createStore(path.join(ROOT, 'data', 'state.json'), { maxTasks: () => set().keepTasks });
// budgets, limits, team rules, command lists, notifications: read live, so changes apply to the next task without a restart
const settings = createSettings(path.join(ROOT, 'data', 'settings.json'), { agentKeys: () => config.agents.map(a => a.key) });
const set = () => settings.effective(); // what the office runs with; the page edits settings.get()
const activeAgents = () => config.agents.filter(a => !set().disabledAgents.includes(a.key));
const projects = createProjects(path.join(ROOT, 'data', 'projects.json'), DEFAULT_DIR);
let auth = { mode: 'checking', label: 'ກຳລັງກວດ login…', env: { ...process.env } };
let usage = null; // real plan limits: 5-hour and weekly windows

// live state of each employee (new hires get theirs when they join)
const live = {}, queues = {};
const ensureLive = key => { live[key] ||= { status: 'idle', activity: 'ວ່າງ', taskId: null }; queues[key] ||= []; };
config.agents.forEach(a => ensureLive(a.key));
// roster: order, desks, looks, hiring and archiving; writes config/team.json
const saveTeam = () => fs.writeFileSync(TEAM_FILE, JSON.stringify(config, null, 2));
const team = createTeam(config, {
  save: saveTeam, lead: () => settings.get().teamLead,
  isBusy: key => ['working', 'waiting', 'meeting'].includes(live[key]?.status) || (queues[key] || []).length > 0,
});
const running = new Map();   // taskId -> AbortController

// ---------- server-sent events ----------
const clients = new Set();
function broadcast(ev) { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); }
const approvals = createApprovals({ onAdd: approval => broadcast({ type: 'approval', approval }), onDone: id => broadcast({ type: 'approvalDone', id }) });
function setLive(key, patch) { if (!live[key]) return; Object.assign(live[key], patch); broadcast({ type: 'agent', key, ...live[key] }); }
// enforce the human's auto-approve intent (task.autoApprove) according to autoEffective: resolve pending tool requests when it turns on
function syncAuto(task) {
  for (const ap of approvals.setAuto(task.id, autoEffective(task))) { addMsg(task, { type: 'decision', who: 'you', allow: true, kind: 'tool', auto: true, text: 'ອະນຸຍາດອັດຕະໂນມັດ' }); setLive(ap.agent, { status: 'working', activity: 'ໄດ້ຮັບອະນຸຍາດ ກຳລັງເຮັດຕໍ່' }); }
  if (task.status === 'waiting' && !approvals.list().some(a => a.taskId === task.id)) task.status = 'running';
  taskUpdate(task);
}
function taskUpdate(task) { store.touch(); broadcast({ type: 'task', task: publicTask(task) }); }
const publicTask = ({ messages, handoff, ...t }) => ({ ...t, log: (t.log || []).slice(-80), messageCount: (messages || []).length });
// chat history entries for a task (what the history view shows)
function addMsg(task, m) { task.messages = task.messages || []; const e = { t: Date.now(), ...m }; task.messages.push(e); const max = set().keepMessages; if (task.messages.length > max) task.messages.splice(0, task.messages.length - max); store.touch(); broadcast({ type: 'msg', taskId: task.id, msg: e }); }
const agentByKey = k => config.agents.find(a => a.key === k);
const publicAgents = () => config.agents.map(a => ({ ...a, ...live[a.key], queued: queues[a.key].length }));
function teamChanged() { config.agents.forEach(a => ensureLive(a.key)); broadcast({ type: 'team', agents: publicAgents(), archived: config.archived }); }
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
  if (auth.mode === 'none') { task.status = 'failed'; task.error = 'ຍັງບໍ່ໄດ້ login Claude Code: ເປີດ Claude Code ໃນ Antigravity ແລ້ວພິມ /login'; approvals.clearTask(task.id); task.autoApprove = false; taskUpdate(task); return; }
  if (usage?.fiveHour?.pct >= set().fiveHourStopPct) { task.status = 'failed'; task.error = `ຮອບ 5 ຊົ່ວໂມງໃຊ້ໄປ ${usage.fiveHour.pct}% ແລ້ວ (ຕັ້ງໃຫ້ຢຸດທີ່ ${set().fiveHourStopPct}%). ລໍຖ້າຮອດ ${new Date(usage.fiveHour.resetsAt).toLocaleString()} ຫຼື ປັບໃນ ການຕັ້ງຄ່າ`; approvals.clearTask(task.id); task.autoApprove = false; taskUpdate(task); return; }
  const ac = new AbortController(); running.set(task.id, ac);
  const involved = new Set([lead.key]);
  Object.assign(task, { status: 'running', startedAt: Date.now(), model: lead.model, effort: lead.effort });
  taskUpdate(task); projects.touch(task.cwd);
  const team = task.mode === 'team'; task.planApproved = !team; syncAuto(task);
  setLive(lead.key, { status: team ? 'meeting' : 'working', activity: team ? 'ປະຊຸມວາງແຜນ' : 'ກຳລັງເລີ່ມວຽກ', taskId: task.id });
  if (task.handoffFrom) log('info', `session ເກົ່າໃຫຍ່ ~${Math.round(task.handoffTokens / 1000)}k token: ເລີ່ມ session ໃໝ່ພ້ອມສະຫຼຸບແທນການໂຫຼດທັງໝົດ`, lead.key);
  log('info', team ? `${lead.name} ເລີ່ມວາງແຜນກັບທີມ (${lead.model})` : `${lead.name} ຮັບວຽກ (${lead.model}, effort ${lead.effort})`, lead.key);

  const askApproval = (kind, payload) => {
    if (ac.signal.aborted) return Promise.resolve(kind === 'plan' ? { allow: false } : false);
    const id = crypto.randomUUID();
    const who = payload.who || lead.key;
    const item = { id, kind, taskId: task.id, agent: who, createdAt: Date.now(), autoOk: autoEffective(task), ...payload };
    const input = payload.input?.command || payload.input?.file_path || null;
    if (kind === 'tool' && approvals.isAuto(task.id) && !autoEffective(task)) syncAuto(task);
    if (kind === 'tool' && approvals.isAuto(task.id)) { log('approval', `ອະນຸຍາດອັດຕະໂນມັດ: ${payload.summary}`, who); addMsg(task, { type: 'approval', auto: true, who, summary: payload.summary, input }); return approvals.ask(item); }
    const p = approvals.ask(item);
    task.status = 'waiting'; taskUpdate(task);
    setLive(who, { status: 'waiting', activity: kind === 'plan' ? 'ລໍຖ້າເຈົ້າອະນຸມັດແຜນ' : `ຂໍອະນຸຍາດ: ${payload.summary}` });
    log('approval', kind === 'plan' ? 'ສົ່ງແຜນໃຫ້ເຈົ້າອະນຸມັດ' : `ຂໍອະນຸຍາດ: ${payload.summary}`, who);
    if (kind === 'plan') addMsg(task, { type: 'plan', who, text: payload.plan }); else addMsg(task, { type: 'approval', who, summary: payload.summary, input });
    ac.signal.addEventListener('abort', () => approvals.clearTask(task.id), { once: true });
    return p;
  };

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
    else if (ev.kind === 'phase') { log('info', ev.text, lead.key); addMsg(task, { type: 'delegate', who: lead.key, to: lead.key, text: ev.text }); }
  };
  // team mode runs the approved plan in a second session: "continue" should pick up that one
  // a command decided by the settings' allow/deny lists, shown in the log and chat like an approval
  const onRule = ({ rule, who, summary, command }) => {
    const w = who || lead.key;
    log('approval', `${rule === 'allow' ? 'ອະນຸຍາດຕາມການຕັ້ງຄ່າ' : 'ປະຕິເສດຕາມການຕັ້ງຄ່າ'}: ${summary}`, w);
    if (rule === 'allow') addMsg(task, { type: 'approval', auto: true, who: w, summary, input: command });
    else addMsg(task, { type: 'decision', who: 'you', allow: false, kind: 'tool', auto: true, text: `ປະຕິເສດອັດຕະໂນມັດ (ຢູ່ໃນລາຍການຫ້າມ): ${command.slice(0, 200)}` });
  };
  const onSession = id => { if (task.sessionId !== id) { task.sessionId = id; taskUpdate(task); } };

  try {
    let result, superpowers;
    if (team) {
      ({ result, superpowers } = await runTeam({
        task, lead, team: activeAgents(), env: auth.env, budgetUsd: set().teamBudgetUsd, abortController: ac, emit, onSession, prefs: set(), onRule,
        askApproval: req => askApproval('tool', req),
        askPlan: async plan => { task.plan = plan; const wasAuto = autoEffective(task); task.planApproved = false; if (wasAuto) log('info', 'ອະນຸຍາດອັດຕະໂນມັດ ພັກໄວ້ ລໍຖ້າອະນຸມັດແຜນ', lead.key); syncAuto(task); const res = await askApproval('plan', { plan, summary: 'ແຜນງານ' }); task.planApproved = !!res.allow; syncAuto(task); if (res.allow) setLive(lead.key, { status: 'working', activity: 'ເລີ່ມແຈກວຽກຕາມແຜນ' }); else setLive(lead.key, { status: 'meeting', activity: 'ກຳລັງແກ້ແຜນ' }); return res; },
      }));
      task.superpowers = superpowers;
    } else {
      result = await runTask({ task, agent: lead, team: activeAgents(), env: auth.env, budgetUsd: set().taskBudgetUsd, abortController: ac, emit, onSession, prefs: set(), onRule, askApproval: req => askApproval('tool', req) });
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
    running.delete(task.id); task.endedAt = Date.now(); approvals.clearTask(task.id); task.autoApprove = false; taskUpdate(task);
    for (const t of doneTimers.values()) clearTimeout(t);
    for (const k of involved) if (k !== lead.key && live[k].taskId === task.id) setLive(k, { status: 'idle', activity: 'ວ່າງ', taskId: null });
    setTimeout(refreshUsage, 1500);
    setTimeout(() => { if (['done', 'error'].includes(live[lead.key].status)) setLive(lead.key, { status: 'idle', activity: 'ວ່າງ' }); }, 8000);
  }
}

// ---------- HTTP ----------
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(err => res.status(400).json({ error: String(err?.message || err) }));
const app = express();
// mask editor (web/mask-editor.html): save one drawing's shirt mask as web/assets/shirts/<sprite>.png
app.put('/api/dev/shirt-mask/:sprite', express.json({ limit: '12mb' }), wrap((req, res) => {
  const sprite = req.params.sprite, png = String(req.body?.png || '');
  if (!team.SPRITES.includes(sprite)) throw new Error('ບໍ່ພົບຮູບຕົວລະຄອນນີ້');
  if (!png.startsWith('data:image/png;base64,')) throw new Error('ຕ້ອງເປັນຮູບ PNG');
  const dir = path.join(ROOT, 'web', 'assets', 'shirts'); fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(png.slice(22), 'base64'); fs.writeFileSync(path.join(dir, sprite + '.png'), buf);
  res.json({ ok: true, bytes: buf.length });
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'web')));

app.get('/api/state', (req, res) => res.json({
  agents: publicAgents(), archived: config.archived, seats: team.SEATS, sprites: team.SPRITES,
  models: config.models, efforts: config.efforts, lead: set().teamLead, resumeMaxTokens: set().resumeMaxTokens,
  settings: settings.get(), settingsSchema: settings.schema(), system: systemInfo(),
  tasks: store.tasks.slice(0, 80).map(publicTask),
  approvals: approvals.list(),
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

// facts the page shows but cannot change (they need .env and a restart)
const systemInfo = () => ({ port: PORT, dataDir: path.join(ROOT, 'data'), workspace: DEFAULT_DIR });
app.get('/api/settings', (req, res) => res.json({ schema: settings.schema(), values: settings.get(), system: systemInfo() }));
// history: download everything as JSON, or clear finished tasks (running and queued ones stay)
app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="ai-office-history-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), tasks: store.tasks });
});
app.post('/api/tasks/clear', (req, res) => {
  const removed = store.prune(t => ['queued', 'running', 'waiting'].includes(t.status));
  broadcast({ type: 'tasks', tasks: store.tasks.slice(0, 80).map(publicTask) });
  res.json({ removed });
});
app.patch('/api/settings', wrap((req, res) => { const values = settings.patch(req.body || {}); broadcast({ type: 'settings', settings: values }); res.json(values); }));
app.post('/api/usage/refresh', wrap(async (req, res) => res.json(await refreshUsage())));
app.post('/api/auth/recheck', wrap(async (req, res) => { await refreshAuth(); res.json(publicAuth()); }));

// projects and sessions
app.get('/api/projects', (req, res) => res.json(projects.list()));
app.post('/api/projects', wrap((req, res) => { const p = projects.add(req.body?.path); broadcast({ type: 'projects', projects: projects.list() }); res.json(p); }));
app.post('/api/projects/pick', wrap(async (req, res) => {
  const dir = await pickFolder(); if (!dir) return res.json({ cancelled: true });
  const p = projects.add(dir); broadcast({ type: 'projects', projects: projects.list() }); res.json(p);
}));
app.get('/api/folders', wrap(async (req, res) => res.json(await listFolder(req.query.dir, { skip: set().folderSkip }))));
app.get('/api/folders/search', wrap(async (req, res) => res.json(await searchFolders(req.query.q, { maxDepth: set().folderSearchDepth, skip: set().folderSkip }))));
app.post('/api/projects/open', wrap(async (req, res) => {
  const { path: dir, editor } = req.body || {};
  if (!projects.has(dir)) throw new Error('ໂຟນເດີນີ້ຍັງບໍ່ຢູ່ໃນລາຍການໂປຣເຈັກ');
  await openFolder(path.resolve(dir), editor || set().editor); res.json({ ok: true });
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

// the team: edit (name, role, prompt, access, model, effort, maxTurns, seat, look), hire, archive, restore, order
app.patch('/api/agents/:key', wrap((req, res) => {
  if (!agentByKey(req.params.key)) return res.status(404).json({ error: 'ບໍ່ພົບພະນັກງານ' });
  const a = team.update(req.params.key, req.body || {});
  broadcast({ type: 'agentConfig', key: a.key, model: a.model, effort: a.effort, maxTurns: a.maxTurns });
  teamChanged(); res.json(a);
}));
app.post('/api/agents', wrap((req, res) => { const a = team.add(req.body || {}); teamChanged(); res.json(a); }));
app.delete('/api/agents/:key', wrap((req, res) => { const a = team.archive(req.params.key); teamChanged(); res.json(a); }));
app.post('/api/agents/:key/restore', wrap((req, res) => { const a = team.restore(req.params.key); teamChanged(); res.json(a); }));
app.put('/api/agents/order', wrap((req, res) => { team.reorder(req.body?.keys); teamChanged(); res.json({ ok: true }); }));

// new task: mode 'team' (lead plans + delegates) or 'single' (one employee)
app.post('/api/tasks', wrap((req, res) => {
  const { title, detail = '', mode = 'team', assignee, cwd, autoApprove, fullResume } = req.body || {};
  let resume = req.body?.resume || null, handoff = null, handoffFrom = null, handoffTokens = 0;
  if (resume && fullResume !== true) {
    handoffTokens = sessionTokens(resume);
    if (handoffTokens > set().resumeMaxTokens) { handoff = sessionHandoff(resume); handoffFrom = resume; resume = null; }
  }
  if (!title || !String(title).trim()) throw new Error('ກະລຸນາໃສ່ຫົວຂໍ້ວຽກ');
  const key = mode === 'team' ? set().teamLead : assignee;
  if (!agentByKey(key)) throw new Error('ກະລຸນາເລືອກພະນັກງານ');
  if (set().disabledAgents.includes(key)) throw new Error(`${agentByKey(key).name} ຖືກປິດໄວ້ໃນ ການຕັ້ງຄ່າ`);
  const project = projects.add(cwd || set().defaultProject || DEFAULT_DIR);
  const task = store.addTask({ id: crypto.randomUUID().slice(0, 8), mode: mode === 'team' ? 'team' : 'single', title: String(title).trim(), detail: String(detail), assignee: key, cwd: project.path, resume, handoff, handoffFrom, handoffTokens: handoffFrom ? handoffTokens : 0, status: 'queued', createdAt: Date.now(), log: [], costUsd: 0, autoApprove: autoApprove === true });
  broadcast({ type: 'projects', projects: projects.list() });
  taskUpdate(task); enqueue(task); res.json(publicTask(task));
}));

app.post('/api/tasks/:id/stop', (req, res) => {
  const task = store.task(req.params.id); if (!task) return res.status(404).end();
  const ac = running.get(task.id);
  if (ac) ac.abort();
  else if (task.status === 'queued') { task.status = 'stopped'; task.error = 'ຖືກຍົກເລີກ'; queues[task.assignee] = queues[task.assignee].filter(i => i !== task.id); approvals.clearTask(task.id); task.autoApprove = false; taskUpdate(task); }
  res.json({ ok: true });
});

app.post('/api/approvals/:id', (req, res) => {
  const allow = Boolean(req.body?.allow), feedback = String(req.body?.feedback || '');
  const ap = approvals.decide(req.params.id, { allow, feedback }); if (!ap) return res.status(404).json({ error: 'ຄຳຂໍນີ້ໝົດອາຍຸແລ້ວ' });
  const task = store.task(ap.taskId);
  if (task) addMsg(task, { type: 'decision', who: 'you', allow, kind: ap.kind, text: feedback });
  if (task) { task.log.push({ t: Date.now(), kind: 'info', text: allow ? 'ເຈົ້າອະນຸມັດແລ້ວ' : `ເຈົ້າບໍ່ອະນຸມັດ${feedback ? ': ' + feedback : ''}` }); if (task.status === 'waiting' && !approvals.list().some(a => a.taskId === task.id)) task.status = 'running'; taskUpdate(task); }
  if (ap.kind !== 'plan') setLive(ap.agent, { status: 'working', activity: allow ? 'ໄດ້ຮັບອະນຸຍາດ ກຳລັງເຮັດຕໍ່' : 'ຖືກປະຕິເສດ ກຳລັງຫາທາງອື່ນ' });
  res.json({ ok: true });
});

// per-task auto-approve: allow this task's tool requests without asking (plans still need a click)
app.post('/api/tasks/:id/auto-approve', (req, res) => {
  const task = store.task(req.params.id); if (!task) return res.status(404).json({ error: 'ບໍ່ພົບວຽກ' });
  if (!['running', 'waiting', 'queued'].includes(task.status)) return res.status(400).json({ error: 'ວຽກນີ້ບໍ່ໄດ້ກຳລັງເຮັດຢູ່' });
  task.autoApprove = (req.body?.on === true);
  task.log.push({ t: Date.now(), kind: 'info', text: task.autoApprove ? (autoEffective(task) ? 'ເປີດອະນຸຍາດອັດຕະໂນມັດ' : 'ເປີດອະນຸຍາດອັດຕະໂນມັດ (ພັກໄວ້ ລໍຖ້າອະນຸມັດແຜນ)') : 'ປິດອະນຸຍາດອັດຕະໂນມັດ' });
  syncAuto(task); res.json({ ok: true, autoApprove: task.autoApprove, effective: autoEffective(task) });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AI Office  →  http://localhost:${PORT}`);
  console.log(`  Projects   →  ${projects.list().map(p => p.path).join(', ')}`);
  console.log(`  Superpowers→  ${findSuperpowers() ? 'ພົບແລ້ວ' : 'ບໍ່ພົບ (ໂໝດທີມຈະວາງແຜນເອງ)'}`);
  refreshAuth();
});
