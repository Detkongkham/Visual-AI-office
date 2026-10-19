// Runs work with the Claude Agent SDK and reports, per employee, what they are doing.
//  - runTask: one employee does one task
//  - runTeam: the tech lead plans with Superpowers, waits for the human to approve the plan,
//             then delegates each step to teammates who run as sub-agents
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const LAO_SUMMARY = 'When you finish, reply with a short summary in the Lao language: what you did, which files you created or changed, and anything the human should check.';
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
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const d = describeTool(block.name, block.input);
          emit({ kind: 'tool', who, tool: block.name, activity: d.kind, text: d.text, toolUseId: block.id, input: block.input });
        } else if (block.type === 'text' && block.text?.trim()) {
          emit({ kind: 'say', who, text: block.text.trim().slice(0, 600) });
        }
      }
    } else if (msg.type === 'user' && !msg.parent_tool_use_id) {
      // tool results on the main thread: a finished delegation means that teammate is done
      const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
      for (const block of content) if (block.type === 'tool_result') emit({ kind: 'toolDone', toolUseId: block.tool_use_id, isError: !!block.is_error });
    } else if (msg.type === 'result') {
      final = msg;
    }
  }
  return final;
}

function permissionHandler({ askApproval, keyForAgentId, onPlan }) {
  return async (toolName, input, opts = {}) => {
    if (toolName === 'ExitPlanMode' && onPlan) {
      const res = await onPlan(String(input.plan || ''));
      return res.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: `The human wants changes to the plan before you start: ${res.feedback || 'please revise it.'}` };
    }
    const d = describeTool(toolName, input);
    const who = keyForAgentId?.(opts.agentID);
    const ok = await askApproval({ tool: toolName, summary: d.text, input, who });
    return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The human declined this action. Continue without it or explain what you need.' };
  };
}

/** One employee, one task. */
export async function runTask({ task, agent, team, env, emit, askApproval, budgetUsd, abortController, onSession }) {
  const roster = team.map(a => `- ${a.name} (${a.role})`).join('\n');
  const append = [`You are ${agent.name}, the ${agent.role} of a small AI software team.`, agent.prompt, `Your teammates:\n${roster}`, SAFETY, LAO_SUMMARY].join('\n\n');
  const { allowedTools, disallowedTools } = accessOptions(agent.access);
  const q = query({
    prompt: `Task: ${task.title}\n\n${task.detail || ''}`.trim(),
    options: {
      model: agent.model, effort: agent.effort, cwd: task.cwd, env,
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      allowedTools, disallowedTools, permissionMode: 'default',
      maxTurns: agent.maxTurns || 40, maxBudgetUsd: budgetUsd, abortController,
      settingSources: ['project'],
      ...(task.resume ? { resume: task.resume } : {}),
      canUseTool: permissionHandler({ askApproval }),
    },
  });
  return consume(q, { emit, onInit: m => onSession?.(m.session_id, m), keyForParent: () => agent.key });
}

/** The whole team: lead plans with Superpowers, human approves, teammates do the steps as sub-agents. */
export async function runTeam({ task, lead, team, env, emit, askApproval, askPlan, budgetUsd, abortController, onSession }) {
  const sp = findSuperpowers();
  const mates = team.filter(a => a.key !== lead.key);
  const agents = Object.fromEntries(mates.map(a => [a.key, {
    description: `${a.name} – ${a.role}. ${a.prompt}`,
    prompt: [`You are ${a.name}, the ${a.role} on this team.`, a.prompt, SAFETY,
      a.access === 'read' ? 'You only read and report; never change files.' : 'Keep changes focused on the step you were given.',
      sp ? 'Use the matching superpowers skill when it applies (test-driven-development for code, requesting-code-review for reviews, verification-before-completion before you report done).' : '',
      'Report back to the lead in English with a short list of what you changed.'].filter(Boolean).join('\n\n'),
    tools: toolsFor(a.access),
    model: a.model,
    effort: a.effort,
    maxTurns: a.maxTurns || 40,
  }]));
  const roster = mates.map(a => `- ${a.key}: ${a.name}, ${a.role}${a.access === 'read' ? ' (read-only)' : ''}`).join('\n');
  const append = [
    `You are ${lead.name}, the tech lead and coordinator of an AI software team. You coordinate; you do not write the code yourself.`,
    sp ? 'Follow the superpowers workflow: use the brainstorming skill to clarify the goal (make reasonable assumptions instead of asking questions), then the writing-plans skill to write a step-by-step plan, then present it with ExitPlanMode. After approval, use subagent-driven-development to carry it out.'
       : 'First explore the project and write a step-by-step plan, then present it with ExitPlanMode. After approval, carry it out step by step.',
    `Delegate every step to the teammate whose role fits, using the Agent tool with subagent_type set to their key:\n${roster}`,
    'In the plan, name the teammate for every step. Read-only teammates may work in parallel; teammates who change files must work one at a time.',
    'After each implementation step, ask keo to review it and toy to test it; send fixes back to the same teammate.',
    SAFETY,
    'At the end, reply with a summary in the Lao language: who did what, which files changed, test results, and anything the human should check.',
  ].join('\n\n');

  let q;
  q = query({
    prompt: `Goal: ${task.title}\n\n${task.detail || ''}`.trim(),
    options: {
      model: lead.model, effort: lead.effort, cwd: task.cwd, env,
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      agents,
      allowedTools: [...READ_TOOLS, ...EDIT_TOOLS, 'Agent', 'Task', 'Skill', 'TodoWrite'],
      permissionMode: 'plan',
      maxTurns: lead.maxTurns || 80, maxBudgetUsd: budgetUsd, abortController,
      settingSources: ['project'],
      plugins: sp ? [{ type: 'local', path: sp.path }] : [],
      ...(task.resume ? { resume: task.resume } : {}),
      canUseTool: permissionHandler({
        askApproval,
        keyForAgentId: id => agentKeys.get(id),
        onPlan: async plan => {
          const res = await askPlan(plan);
          if (res.allow) await q.setPermissionMode('default');
          return res;
        },
      }),
    },
  });

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
  return { result: await consume(q, { emit: wrapped, onInit: m => onSession?.(m.session_id, m), keyForParent }), superpowers: !!sp };
}
