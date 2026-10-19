// AI Office server: serves the 2D office and runs each AI employee's tasks with the Claude Agent SDK.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { runTask, routeTask } from './runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAM_FILE = path.join(ROOT, 'config', 'team.json');
const PORT = Number(process.env.PORT || 4317);
const WORKSPACE = path.resolve(ROOT, process.env.WORKSPACE_DIR || './workspace');
const TASK_BUDGET = Number(process.env.TASK_BUDGET_USD || 1);
const DAILY_BUDGET = Number(process.env.DAILY_BUDGET_USD || 10);

fs.mkdirSync(WORKSPACE, { recursive: true });
let config = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
const store = createStore(path.join(ROOT, 'data', 'state.json'));

// live state of each employee
const live = Object.fromEntries(config.agents.map(a => [a.key, { status: 'idle', activity: 'ວ່າງ', taskId: null }]));
const queues = Object.fromEntries(config.agents.map(a => [a.key, []]));
const running = new Map();   // taskId -> AbortController
const approvals = new Map(); // id -> { ...request, resolve }

// ---------- server-sent events ----------
const clients = new Set();
function broadcast(ev) { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); }
function setLive(key, patch) { Object.assign(live[key], patch); broadcast({ type: 'agent', key, ...live[key] }); }
function taskUpdate(task) { store.touch(); broadcast({ type: 'task', task: publicTask(task) }); }
const publicTask = t => ({ ...t, log: t.log.slice(-60) });
const agentByKey = k => config.agents.find(a => a.key === k);

// ---------- queue ----------
function enqueue(task) {
  queues[task.assignee].push(task.id);
  pump(task.assignee);
}
async function pump(key) {
  if (live[key].status === 'working' || live[key].status === 'waiting') return;
  const id = queues[key].shift(); if (!id) return;
  const task = store.task(id); if (!task || task.status !== 'queued') return pump(key);
  await execute(task);
  pump(key);
}

async function execute(task) {
  const agent = agentByKey(task.assignee);
  const log = (kind, text) => { task.log.push({ t: Date.now(), kind, text }); broadcast({ type: 'log', taskId: task.id, entry: task.log[task.log.length - 1] }); };
  if (store.spentToday() >= DAILY_BUDGET) {
    task.status = 'failed'; task.error = `ເກີນງົບປະມານມື້ນີ້ ($${DAILY_BUDGET})`; taskUpdate(task); return;
  }
  const ac = new AbortController(); running.set(task.id, ac);
  Object.assign(task, { status: 'running', startedAt: Date.now(), model: agent.model, effort: agent.effort });
  taskUpdate(task);
  setLive(agent.key, { status: 'working', activity: 'ກຳລັງເລີ່ມວຽກ', taskId: task.id });
  log('info', `${agent.name} ຮັບວຽກ (${agent.model}, effort ${agent.effort})`);
  try {
    const result = await runTask({
      task, agent, workspace: WORKSPACE, team: config.agents, budgetUsd: TASK_BUDGET, abortController: ac,
      emit: ev => {
        if (ev.kind === 'tool') { setLive(agent.key, { status: 'working', activity: ev.text, mode: ev.activity }); log('tool', ev.text); }
        else if (ev.kind === 'say') log('say', ev.text);
        else log('info', ev.text);
      },
      askApproval: req => new Promise(resolve => {
        if (ac.signal.aborted) return resolve(false);
        const id = crypto.randomUUID();
        const item = { id, taskId: task.id, agent: agent.key, tool: req.tool, summary: req.summary, input: req.input, createdAt: Date.now() };
        approvals.set(id, { ...item, resolve });
        task.status = 'waiting'; taskUpdate(task);
        setLive(agent.key, { status: 'waiting', activity: `ຂໍອະນຸຍາດ: ${req.summary}` });
        log('approval', `ຂໍອະນຸຍາດ: ${req.summary}`);
        broadcast({ type: 'approval', approval: item });
        ac.signal.addEventListener('abort', () => { if (approvals.delete(id)) { broadcast({ type: 'approvalDone', id }); resolve(false); } }, { once: true });
      }),
    });
    if (!result) throw new Error('ບໍ່ໄດ້ຮັບຜົນຈາກ agent');
    task.costUsd = result.total_cost_usd || 0; task.turns = result.num_turns; store.addSpend(task.costUsd);
    if (result.subtype === 'success' && !result.is_error) {
      Object.assign(task, { status: 'done', result: result.result });
      setLive(agent.key, { status: 'done', activity: 'ວຽກສຳເລັດ 🎉', taskId: null });
      log('done', `ສຳເລັດ · ${result.num_turns} ຮອບ · $${task.costUsd.toFixed(3)}`);
    } else {
      Object.assign(task, { status: 'failed', error: (result.errors || [result.subtype]).join(', ') });
      setLive(agent.key, { status: 'error', activity: 'ວຽກບໍ່ສຳເລັດ', taskId: null });
      log('error', task.error);
    }
  } catch (err) {
    const stopped = ac.signal.aborted;
    Object.assign(task, { status: stopped ? 'stopped' : 'failed', error: stopped ? 'ຖືກຢຸດໂດຍເຈົ້າ' : String(err?.message || err) });
    setLive(agent.key, { status: stopped ? 'idle' : 'error', activity: stopped ? 'ວ່າງ' : 'ມີບັນຫາ', taskId: null });
    log('error', task.error);
  } finally {
    running.delete(task.id); task.endedAt = Date.now(); taskUpdate(task);
    for (const [id, ap] of approvals) if (ap.taskId === task.id) { approvals.delete(id); broadcast({ type: 'approvalDone', id }); ap.resolve(false); }
    broadcast({ type: 'spend', usd: store.spentToday(), limit: DAILY_BUDGET });
    setTimeout(() => { if (live[agent.key].status === 'done' || live[agent.key].status === 'error') setLive(agent.key, { status: 'idle', activity: 'ວ່າງ' }); }, 8000);
  }
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'web')));

app.get('/api/state', (req, res) => res.json({
  agents: config.agents.map(a => ({ ...a, ...live[a.key], queued: queues[a.key].length })),
  models: config.models, efforts: config.efforts,
  tasks: store.tasks.slice(0, 80).map(publicTask),
  approvals: [...approvals.values()].map(({ resolve, ...a }) => a),
  spend: { usd: store.spentToday(), limit: DAILY_BUDGET, taskLimit: TASK_BUDGET },
  workspace: WORKSPACE,
  hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
}));

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n'); clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

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

// give a task to someone (or let the team decide)
app.post('/api/tasks', async (req, res) => {
  const { title, detail = '', assignee = 'auto' } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'ກະລຸນາໃສ່ຫົວຂໍ້ວຽກ' });
  let key = assignee, routeCost = 0;
  if (key === 'auto') {
    try { ({ key, cost: routeCost } = await routeTask({ title, detail, team: config.agents, workspace: WORKSPACE })); store.addSpend(routeCost); }
    catch (err) { return res.status(500).json({ error: 'ເລືອກຄົນຮັບວຽກບໍ່ໄດ້: ' + (err?.message || err) }); }
  }
  if (!agentByKey(key)) return res.status(400).json({ error: 'ບໍ່ພົບພະນັກງານ' });
  const task = store.addTask({ id: crypto.randomUUID().slice(0, 8), title: String(title).trim(), detail: String(detail), assignee: key, status: 'queued', createdAt: Date.now(), log: [], costUsd: routeCost });
  taskUpdate(task); enqueue(task); res.json(publicTask(task));
});

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
  const allow = Boolean(req.body?.allow);
  const task = store.task(ap.taskId);
  if (task && task.status === 'waiting') { task.status = 'running'; task.log.push({ t: Date.now(), kind: 'info', text: allow ? 'ເຈົ້າອະນຸຍາດແລ້ວ' : 'ເຈົ້າບໍ່ອະນຸຍາດ' }); taskUpdate(task); }
  setLive(ap.agent, { status: 'working', activity: allow ? 'ໄດ້ຮັບອະນຸຍາດ ກຳລັງເຮັດຕໍ່' : 'ຖືກປະຕິເສດ ກຳລັງຫາທາງອື່ນ' });
  broadcast({ type: 'approvalDone', id: ap.id });
  ap.resolve(allow); res.json({ ok: true });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AI Office  →  http://localhost:${PORT}`);
  console.log(`  Workspace  →  ${WORKSPACE}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  ⚠️  ANTHROPIC_API_KEY is not set in .env – agents will use your Claude Code login if you have one, otherwise tasks will fail.');
  console.log('');
});
