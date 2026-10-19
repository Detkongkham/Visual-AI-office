// Turns Agent SDK messages (live or from a saved Claude Code transcript) into simple chat entries for the history view.
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { describeTool } from './runner.js';

const cap = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… (ຕັດອອກ ${s.length - n} ຕົວອັກສອນ)` : s; };

export function trimInput(input) {
  if (!input || typeof input !== 'object') return input ?? null;
  const out = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === 'string' ? cap(v, 1500) : v;
  const json = JSON.stringify(out);
  return json.length > 4000 ? { note: cap(json, 4000) } : out;
}

export function resultText(content) {
  if (typeof content === 'string') return cap(content, 2500);
  if (Array.isArray(content)) return cap(content.map(c => c?.type === 'text' ? c.text : c?.type === 'image' ? '[ຮູບ]' : '').filter(Boolean).join('\n'), 2500);
  return '';
}

// Claude Code adds hidden wrappers to user turns (reminders, command output); keep only what a person typed.
function cleanUserText(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<(task-notification|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

/**
 * Convert one SDK message into chat entries.
 * @param {object} msg  SDK message ({ type, message, parent_tool_use_id })
 * @param {string} who  employee key the message belongs to
 */
export function toChat(msg, who) {
  const out = [];
  const content = msg.message?.content;
  if (msg.type === 'assistant') {
    for (const b of Array.isArray(content) ? content : []) {
      if (b.type === 'text' && b.text?.trim()) out.push({ type: 'text', who, text: cap(b.text.trim(), 12000) });
      else if (b.type === 'tool_use') out.push({ type: 'tool', who, id: b.id, tool: b.name, summary: describeTool(b.name, b.input).text, input: trimInput(b.input) });
    }
  } else if (msg.type === 'user') {
    if (typeof content === 'string') { const t = cleanUserText(content); if (t && !msg.parent_tool_use_id) out.push({ type: 'user', who: 'you', text: cap(t, 12000) }); }
    else for (const b of Array.isArray(content) ? content : []) {
      if (b.type === 'tool_result') out.push({ type: 'toolResult', who, id: b.tool_use_id, isError: !!b.is_error, output: resultText(b.content) });
      else if (b.type === 'text' && !msg.parent_tool_use_id) { const t = cleanUserText(b.text); if (t) out.push({ type: 'user', who: 'you', text: cap(t, 12000) }); }
    }
  }
  return out;
}

/** Chat history of a saved Claude Code session (main thread), e.g. one started in Antigravity. */
export async function sessionChat(sessionId, dir, defaultWho) {
  const msgs = await getSessionMessages(sessionId, { dir, limit: 600 });
  const out = [];
  for (const m of msgs) for (const c of toChat(m, defaultWho)) out.push(c);
  return out;
}
