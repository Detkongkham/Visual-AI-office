// Runs one task for one AI employee with the Claude Agent SDK and reports what it is doing.
import { query } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';

const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

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
    case 'Task': case 'Agent': return { kind: 'delegate', text: 'ມອບວຽກຍ່ອຍ' };
    case 'TodoWrite': return { kind: 'plan', text: 'ວາງແຜນວຽກ' };
    default: return { kind: 'tool', text: name };
  }
}

function accessOptions(access) {
  if (access === 'read') return { allowedTools: READ_TOOLS, disallowedTools: [...EDIT_TOOLS, 'Bash'] };
  // write: reading and editing files inside the workspace is automatic; commands (Bash) and anything else ask the user
  return { allowedTools: [...READ_TOOLS, ...EDIT_TOOLS], disallowedTools: [] };
}

/**
 * @param {object} p
 * @param {object} p.task      task record (mutated with progress)
 * @param {object} p.agent     team member config
 * @param {string} p.workspace absolute folder the agent works in
 * @param {object[]} p.team    whole team (for context)
 * @param {(ev:object)=>void} p.emit   progress events
 * @param {(req:object)=>Promise<boolean>} p.askApproval  resolves true when the user allows a tool call
 * @param {number} p.budgetUsd per-task budget
 */
export async function runTask({ task, agent, workspace, team, emit, askApproval, budgetUsd, abortController }) {
  const roster = team.map(a => `- ${a.name} (${a.role})`).join('\n');
  const append = [
    `You are ${agent.name}, the ${agent.role} of a small AI software team working in this repository.`,
    agent.prompt,
    `Your teammates:\n${roster}`,
    'Work only inside the current working directory. Do not push, deploy or publish anything.',
    'When you finish, reply with a short summary in the Lao language: what you did, which files you created or changed, and anything the human should check.',
  ].join('\n\n');

  const { allowedTools, disallowedTools } = accessOptions(agent.access);
  const prompt = `Task: ${task.title}\n\n${task.detail || ''}`.trim();

  const q = query({
    prompt,
    options: {
      model: agent.model,
      effort: agent.effort,
      cwd: workspace,
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      allowedTools,
      disallowedTools,
      permissionMode: 'default',
      maxTurns: agent.maxTurns || 40,
      maxBudgetUsd: budgetUsd,
      abortController,
      settingSources: ['project'],
      env: { ...process.env },
      canUseTool: async (toolName, input) => {
        const d = describeTool(toolName, input);
        const ok = await askApproval({ tool: toolName, summary: d.text, input });
        return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The human declined this action. Continue without it or explain what you need.' };
      },
    },
  });

  let final = null;
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      emit({ kind: 'log', text: `ເລີ່ມວຽກດ້ວຍໂມເດວ ${msg.model}` });
    } else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const d = describeTool(block.name, block.input);
          emit({ kind: 'tool', tool: block.name, activity: d.kind, text: d.text });
        } else if (block.type === 'text' && block.text?.trim()) {
          emit({ kind: 'say', text: block.text.trim().slice(0, 400) });
        }
      }
    } else if (msg.type === 'result') {
      final = msg;
    }
  }
  return final;
}

/** Ask a cheap model which teammate should take a task. Returns an agent key. */
export async function routeTask({ title, detail, team, workspace }) {
  const list = team.map(a => `${a.key}: ${a.role}`).join('\n');
  const q = query({
    prompt: `Team:\n${list}\n\nTask: ${title}\n${detail || ''}\n\nReply with only the key of the single best teammate for this task.`,
    options: {
      model: 'claude-haiku-5-5',
      cwd: workspace,
      maxTurns: 1,
      allowedTools: [],
      disallowedTools: ['Read', 'Glob', 'Grep', 'Bash', ...EDIT_TOOLS, 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'],
      canUseTool: async () => ({ behavior: 'deny', message: 'No tools for routing.' }),
      settingSources: [],
      env: { ...process.env },
    },
  });
  let text = '';
  let cost = 0;
  for await (const msg of q) if (msg.type === 'result') { text = msg.result || ''; cost = msg.total_cost_usd || 0; }
  const key = team.map(a => a.key).find(k => new RegExp(`\\b${k}\\b`, 'i').test(text));
  return { key: key || 'somphone', cost };
}
