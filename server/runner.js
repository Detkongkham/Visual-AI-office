// Runs work with the Claude Agent SDK and reports, per employee, what they are doing.
//  - runTask: one employee does one task
//  - runTeam: the tech lead plans with Superpowers, waits for the human to approve the plan,
//             then, in a fresh session that starts from the plan alone, delegates each step to teammates who run as sub-agents
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toChat } from './chat.js';
import { commandRule } from './settings.js';

const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const DELEGATE_TOOLS = new Set(['Agent', 'Task']);

// Human-readable activity for the office bubbles (Lao)
export function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  const short = file ? path.basename(String(file)) : '';
  switch (name) {
    case 'Read': return { kind: 'read', text: `ອ່ານ ${short}` };
    case 'Glob': case 'Grep': return { kind: 'search', text: `ຄົ້ນຫາ ${input.pattern || ''}`.trim() };
    case 'Edit': case 'Write': case 'NotebookEdit': return { kind: 'edit', text: `ແກ້ໄຂ ${short}` };
    case 'Bash': return { kind: 'bash', text: `ລັນຄຳສັ່ງ: ${String(input.command || '').slice(0, 60)}` };
    case 'WebSearch': case 'WebFetch': return { kind: 'web', text: 'ຄົ້ນຂໍ້ມູນໃນເວັບ' };
    case 'Agent': case 'Task': return { kind: 'delegate', text: `ມອບວຽກ: ${String(input.description || '').slice(0, 40)}` };
    case 'Skill': return { kind: 'plan', text: `ໃຊ້ skill ${String(input.skill || input.name || '').replace(/^superpowers:/, '')}` };
    case 'TodoWrite': return { kind: 'plan', text: 'ວາງແຜນວຽກ' };
    case 'ExitPlanMode': return { kind: 'plan', text: 'ສົ່ງແຜນໃຫ້ເຈົ້າອະນຸມັດ' };
    default: return { kind: 'tool', text: name };
  }
}

const toolsFor = access => access === 'read' ? [...READ_TOOLS] : [...READ_TOOLS, ...EDIT_TOOLS, 'Bash', 'TodoWrite'];

function accessOptions(access) {
  if (access === 'read') return { allowedTools: READ_TOOLS, disallowedTools: [...EDIT_TOOLS, 'Bash'] };
  // write: reading and editing files inside the project is automatic; commands (Bash) and anything else ask the human
  return { allowedTools: [...READ_TOOLS, ...EDIT_TOOLS], disallowedTools: [] };
}

// The lead coordinates. It reads little itself (scout explores for it) and only runs read-only git and the Superpowers scripts.
const LEAD_GREP_LINES = 100;
const NO_SHELL = /[;&|`$<>\n]/;
export function leadBashOk(command) {
  let c = String(command || '').trim();
  const cd = c.match(/^cd +(\S+) *&& *(.*)$/s);
  if (cd) { if (!/superpowers/.test(cd[1])) return false; c = cd[2].trim(); if (/^bash +scripts\/[\w-]+( +[\w./@~-]+)*$/.test(c)) return true; }
  if (/^bash +\S*superpowers\S*\/scripts\/[\w-]+( +[\w./@~-]+)*$/.test(c)) return true;
  if (/^mkdir +-p +\.superpowers\/(?!.*\.\.)[\w./-]+$/.test(c)) return true;
  if (/^git +(diff|show)\b[^;&|`$<>\n]*? *> *\.superpowers\/(?!.*\.\.)[\w./-]+$/.test(c)) return true;
  if (NO_SHELL.test(c)) return false;
  if (/^git +(status|log|rev-parse|branch)\b/.test(c)) return true;
  if (/^git +(diff|show)\b/.test(c) && /--(stat|name-only|name-status|shortstat)\b/.test(c)) return true;
  return false;
}
const leadHooks = (readLines = 300) => ({
  PreToolUse: [{
    hooks: [async input => {
      if (input.agent_id) return {}; // teammates keep their own rules
      const ti = input.tool_input || {}, allow = updatedInput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } });
      if (input.tool_name === 'Read' && !(ti.limit > 0 && ti.limit <= readLines)) return allow({ ...ti, limit: readLines });
      if (input.tool_name === 'Grep' && ti.output_mode === 'content' && !(ti.head_limit > 0 && ti.head_limit <= LEAD_GREP_LINES)) return allow({ ...ti, head_limit: LEAD_GREP_LINES });
      if (input.tool_name === 'Bash') {
        if (leadBashOk(ti.command)) return allow(ti);
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The lead has no general shell. Ask scout to look things up, or ask the teammate who owns the step to run it. Allowed: git status/log/rev-parse, git diff --stat (or a full diff redirected into .superpowers/), and the Superpowers skill scripts.' } };
      }
      return {};
    }],
  }],
});

const LANGS = { lo: 'Lao', en: 'English', th: 'Thai' };
/** The closing summary for the human, in the language and length set in the office settings. */
export function summaryLine({ reportLanguage = 'lo', reportLength = 'short' } = {}, team = false) {
  const lang = LANGS[reportLanguage] || 'Lao';
  const what = team ? 'who did what, which files changed, test results, and anything the human should check' : 'what you did, which files you created or changed, and anything the human should check';
  return reportLength === 'detailed'
    ? `${team ? 'At the end' : 'When you finish'}, reply with a detailed summary in the ${lang} language, using short headed sections: ${what}.`
    : `${team ? 'At the end' : 'When you finish'}, reply with a short summary (under 150 words) in the ${lang} language: ${what}.`;
}
const SAFETY = 'Work only inside the current project folder. Do not push, deploy or publish anything.';

/** Superpowers plugin installed in the user's Claude Code, if any. */
export function findSuperpowers() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/plugins/installed_plugins.json'), 'utf8'));
    const plugins = d.plugins || d;
    for (const [key, val] of Object.entries(plugins)) {
      if (!key.startsWith('superpowers@')) continue;
      const entry = Array.isArray(val) ? val[0] : val;
      const p = entry?.installPath || entry?.path;
      if (p && fs.existsSync(p)) return { key, path: p };
    }
  } catch { /* not installed */ }
  return null;
}

// Shared loop: streams SDK messages and turns them into office events.
async function consume(q, { emit, onInit, keyForParent }) {
  let final = null;
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      onInit?.(msg);
    } else if (msg.type === 'assistant') {
      const who = keyForParent(msg.parent_tool_use_id, msg.agent_id);
      for (const c of toChat(msg, who)) emit({ kind: 'chat', msg: c });
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const d = describeTool(block.name, block.input);
          emit({ kind: 'tool', who, tool: block.name, activity: d.kind, text: d.text, toolUseId: block.id, input: block.input });
        } else if (block.type === 'text' && block.text?.trim()) {
          emit({ kind: 'say', who, text: block.text.trim().slice(0, 600) });
        }
      }
    } else if (msg.type === 'user' && msg.parent_tool_use_id) {
      // a sub-agent's own tool results, for the history view
      const who = keyForParent(msg.parent_tool_use_id, msg.agent_id);
      for (const c of toChat(msg, who)) if (c.type === 'toolResult') emit({ kind: 'chat', msg: c });
    } else if (msg.type === 'user' && !msg.parent_tool_use_id) {
      for (const c of toChat(msg, keyForParent(null))) if (c.type === 'toolResult') emit({ kind: 'chat', msg: c });
      // tool results on the main thread: a finished delegation means that teammate is done
      const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
      for (const block of content) if (block.type === 'tool_result') emit({ kind: 'toolDone', toolUseId: block.tool_use_id, isError: !!block.is_error });
    } else if (msg.type === 'rate_limit_event') {
      emit({ kind: 'rateLimit', info: msg.rate_limit_info });
    } else if (msg.type === 'result') {
      final = msg;
    }
  }
  return final;
}

// prefs: the office settings (allow/deny command lists); onRule reports a command decided by those lists
function permissionHandler({ askApproval, keyForAgentId, onPlan, prefs = {}, onRule }) {
  return async (toolName, input, opts = {}) => {
    if (toolName === 'ExitPlanMode' && onPlan) {
      const res = await onPlan(String(input.plan || ''));
      return res.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: `The human wants changes to the plan before you start: ${res.feedback || 'please revise it.'}` };
    }
    const d = describeTool(toolName, input);
    const who = keyForAgentId?.(opts.agentID);
    if (toolName === 'Bash') {
      const rule = commandRule(input.command, prefs);
      if (rule) onRule?.({ rule, who, summary: d.text, command: String(input.command || '') });
      if (rule === 'deny') return { behavior: 'deny', message: 'This command is on the office deny list and is never allowed. Do the work another way, or say in your summary that the human must run it.' };
      if (rule === 'allow') return { behavior: 'allow', updatedInput: input };
    }
    const ok = await askApproval({ tool: toolName, summary: d.text, input, who });
    return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The human declined this action. Continue without it or explain what you need.' };
  };
}

/** One employee, one task. */
export async function runTask({ task, agent, team, env, emit, askApproval, budgetUsd, abortController, onSession, prefs = {}, onRule }) {
  const roster = team.map(a => `- ${a.name} (${a.role})`).join('\n');
  const append = [`You are ${agent.name}, the ${agent.role} of a small AI software team.`, agent.prompt, `Your teammates:\n${roster}`, SAFETY, summaryLine(prefs)].join('\n\n');
  const { allowedTools, disallowedTools } = accessOptions(agent.access);
  const q = query({
    prompt: [task.handoff, `Task: ${task.title}\n\n${task.detail || ''}`.trim()].filter(Boolean).join('\n\n'),
    options: {
      model: agent.model, effort: agent.effort, cwd: task.cwd, env,
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      allowedTools, disallowedTools, permissionMode: 'default',
      maxTurns: agent.maxTurns || 40, maxBudgetUsd: budgetUsd, abortController,
      settingSources: ['project'],
      ...(task.resume ? { resume: task.resume } : {}),
      canUseTool: permissionHandler({ askApproval, prefs, onRule }),
    },
  });
  return consume(q, { emit, onInit: m => onSession?.(m.session_id, m), keyForParent: () => agent.key });
}

/** Office review rules for the lead, from the settings (who checks the work, and how many fix rounds). */
export function reviewRules(prefs, keys) {
  const has = k => keys.includes(k), p = { fixRounds: 1, alwaysTest: true, autoSecurity: false, ...prefs };
  const checks = [has('keo') && 'keo for one review of the whole change', p.alwaysTest && has('toy') && 'toy for one test run', p.autoSecurity && has('sy') && 'sy for one security review'].filter(Boolean);
  const optional = ['sy', 'ceo', 'thong', 'saeng'].filter(k => has(k) && !(k === 'sy' && p.autoSecurity));
  const fix = p.fixRounds > 0
    ? `If they report Critical or Important problems, send a fix dispatch to the teammate who owns the code, then one scoped re-review${has('keo') ? ' by keo' : ''}; at most ${p.fixRounds} such round${p.fixRounds > 1 ? 's' : ''}. Then stop: list any remaining minor issues in your summary instead of looping.`
    : 'Do not send fixes: list the problems they report in your summary for the human.';
  return [
    'Work in the current folder: no git worktrees, no finishing-a-development-branch.',
    'Group small related tasks for the same teammate into one dispatch.',
    checks.length ? `Review once, not per task: after all implementation tasks are done, dispatch ${checks.join(', ')}${checks.length > 1 ? ', in parallel' : ''}. ${fix}` : 'No review step: report what changed so the human can check it.',
    optional.length ? `Only involve ${optional.join(', ')} when the plan names them.` : '',
    'Give a reviewer a list of changed files (git diff --stat) or a diff file under .superpowers/; never paste a full diff into your own context.',
  ].filter(Boolean).map((r, i) => `${i + 1}. ${r}`).join('\n');
}

/** The whole team: lead plans with Superpowers, human approves, teammates do the steps as sub-agents. */
export async function runTeam({ task, lead, team, env, emit, askApproval, askPlan, budgetUsd, abortController, onSession, prefs = {}, onRule }) {
  const p = { superpowers: true, splitPhases: true, useTdd: true, leadReadLines: 300, mateReportWords: 200, ...prefs };
  const sp = p.superpowers ? findSuperpowers() : null;
  const mates = team.filter(a => a.key !== lead.key);
  const agents = Object.fromEntries(mates.map(a => [a.key, {
    description: `${a.name} – ${a.role}. ${a.prompt}`,
    prompt: [`You are ${a.name}, the ${a.role} on this team.`, a.prompt, SAFETY,
      a.access === 'read' ? 'You only read and report; never change files.' : 'Keep changes focused on the step you were given.',
      sp && a.access !== 'read' ? (a.key === 'toy' || !p.useTdd ? 'Use superpowers:verification-before-completion before you report.' : 'Use superpowers:test-driven-development when you write code and superpowers:verification-before-completion before you report done.') : '',
      a.access === 'read' ? `Report back to the lead in English in under ${p.mateReportWords + 50} words, most important first, with file:line references. No long code quotes.`
        : `Report back to the lead in English in under ${p.mateReportWords} words: what you changed (files), test results, and any concern. No code listings.`].filter(Boolean).join('\n\n'),
    tools: toolsFor(a.access),
    model: a.model,
    effort: a.effort,
    maxTurns: a.maxTurns || 40,
  }]));
  const roster = mates.map(a => `- ${a.key}: ${a.name}, ${a.role}${a.access === 'read' ? ' (read-only)' : ''}`).join('\n');
  const who = `You are ${lead.name}, the tech lead and coordinator of an AI software team. You coordinate; you do not write the code yourself.`;
  const teamText = `Teammates (use the Agent tool with subagent_type set to their key):\n${roster}`;
  const lean = `${agents.scout ? 'For facts about the code, ask scout (it replies with a short summary) instead of reading files yourself' : 'Read only what you need'}; your Read is capped at ${p.leadReadLines} lines and your Bash at read-only git plus the Superpowers scripts.`;
  const rules = reviewRules(p, Object.keys(agents));
  const laoSummary = summaryLine(p, true);
  const goal = [task.handoff, `Goal: ${task.title}\n\n${task.detail || ''}`.trim()].filter(Boolean).join('\n\n');

  // which teammate a sub-agent message belongs to
  const byToolUse = new Map(); // Agent/Task tool_use id -> teammate key
  const agentKeys = new Map(); // sub-agent id -> teammate key
  const keyForParent = (parentId, agentId) => {
    if (!parentId) return lead.key;
    const k = byToolUse.get(parentId);
    if (k && agentId) agentKeys.set(agentId, k);
    return k || lead.key;
  };
  const wrapped = ev => {
    if (ev.kind === 'tool' && DELEGATE_TOOLS.has(ev.tool) && ev.who === lead.key) {
      const key = String(ev.input?.subagent_type || '');
      if (agents[key]) { byToolUse.set(ev.toolUseId, key); emit({ kind: 'delegate', who: lead.key, to: key, text: `ຮັບວຽກຈາກ ${lead.name}: ${String(ev.input?.description || '').slice(0, 50)}`, toolUseId: ev.toolUseId }); }
    }
    if (ev.kind === 'toolDone' && byToolUse.has(ev.toolUseId)) emit({ kind: 'mateDone', who: byToolUse.get(ev.toolUseId), isError: ev.isError });
    emit(ev);
  };
  const common = {
    model: lead.model, effort: lead.effort, cwd: task.cwd, env, agents, abortController,
    allowedTools: [...READ_TOOLS, ...EDIT_TOOLS, 'Agent', 'Task', 'Skill', 'TodoWrite'],
    maxTurns: lead.maxTurns || 40,
    settingSources: ['project'],
    plugins: sp ? [{ type: 'local', path: sp.path }] : [],
    hooks: leadHooks(p.leadReadLines),
  };
  const sum = (a, b) => b ? { ...b, total_cost_usd: (a?.total_cost_usd || 0) + (b.total_cost_usd || 0), num_turns: (a?.num_turns || 0) + (b.num_turns || 0) } : a;

  // Phase 1: plan. Everything read while planning stays in this session.
  let approvedPlan = null;
  const planAppend = [
    who, teamText, lean,
    sp ? 'Plan with the superpowers:writing-plans skill. Skip brainstorming: nobody can answer questions, so state your assumptions in the plan.' : 'Write a step-by-step plan.',
    'Keep the plan compact: for each task give the teammate key, the files, what to change and how to check it. No full code listings; the teammates write the code. Group small related changes for the same teammate into one task. Then present it with ExitPlanMode.',
    ...(p.splitPhases ? [] : [sp ? 'After approval, carry the plan out with the superpowers:subagent-driven-development skill. These office rules take priority over the skill:' : 'After approval, carry the plan out step by step. Office rules:', rules, laoSummary]),
    SAFETY,
  ].join('\n\n');
  const q1 = query({
    prompt: goal,
    options: {
      ...common,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: planAppend },
      permissionMode: 'plan', maxBudgetUsd: budgetUsd,
      ...(task.resume ? { resume: task.resume } : {}),
      canUseTool: permissionHandler({
        askApproval,
        keyForAgentId: id => agentKeys.get(id), prefs, onRule,
        onPlan: async plan => {
          const res = await askPlan(plan);
          if (!res.allow) return res;
          if (!p.splitPhases) { await q1.setPermissionMode('default'); return res; }
          approvedPlan = plan;
          return { allow: false, feedback: 'Approved. A fresh session will carry this plan out, so do nothing else now. Reply only: OK' };
        },
      }),
    },
  });
  const planned = await consume(q1, { emit: wrapped, onInit: m => onSession?.(m.session_id, m), keyForParent });
  if (!approvedPlan || abortController.signal.aborted) return { result: planned, superpowers: !!sp };

  // Phase 2: carry out the approved plan in a fresh session, starting from the plan alone.
  const runAppend = [
    who, teamText, lean,
    sp ? 'Carry out the plan with the superpowers:subagent-driven-development skill. These office rules take priority over the skill:' : 'Carry out the plan step by step. Office rules:',
    rules,
    SAFETY,
    laoSummary,
  ].join('\n\n');
  const q2 = query({
    prompt: `${goal}\n\nThe human approved this plan:\n\n${approvedPlan}\n\nCarry it out now.`,
    options: {
      ...common,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: runAppend },
      permissionMode: 'default', maxBudgetUsd: Math.max(0.1, budgetUsd - (planned?.total_cost_usd || 0)),
      canUseTool: permissionHandler({ askApproval, keyForAgentId: id => agentKeys.get(id), prefs, onRule, onPlan: async () => ({ allow: true }) }),
    },
  });
  emit({ kind: 'phase', text: 'ແຜນຜ່ານແລ້ວ: ເລີ່ມ session ໃໝ່ສຳລັບລົງມືເຮັດ (ເອົາໄປແຕ່ແຜນ ເພື່ອປະຢັດ token)' });
  const done = await consume(q2, { emit: wrapped, onInit: m => onSession?.(m.session_id, m, 'run'), keyForParent });
  return { result: sum(planned, done), superpowers: !!sp };
}
