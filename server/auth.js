// Find out how the agents can sign in, without spending any tokens.
// Order: the Claude Code login on this Mac (shared with the Claude Code extension in Antigravity / VS Code),
// then ANTHROPIC_API_KEY from .env as a fallback.
import { query } from '@anthropic-ai/claude-agent-sdk';

function envWithout(key) { const e = { ...process.env }; delete e[key]; return e; }

// Start a session, ask who is signed in, and close it before any prompt is sent.
async function probe(env, cwd) {
  const ac = new AbortController();
  let release;
  const never = (async function* () { await new Promise(r => { release = r; }); })();
  const q = query({ prompt: never, options: { cwd, env, abortController: ac, settingSources: [], maxTurns: 1 } });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000));
  try {
    return await Promise.race([q.accountInfo(), timeout]);
  } finally {
    ac.abort(); release?.();
    try { await q.return?.(); } catch { /* closed */ }
  }
}

/** @returns {Promise<{mode:'login'|'apiKey'|'none', label:string, email?:string, plan?:string, env:object, error?:string}>} */
export async function detectAuth(cwd) {
  // 1) Claude Code login (OAuth) - ignore any API key so the login wins
  try {
    const info = await probe(envWithout('ANTHROPIC_API_KEY'), cwd);
    const viaLogin = info && (info.email || info.subscriptionType || info.tokenSource) && info.apiKeySource !== 'none';
    if (viaLogin) return { mode: 'login', label: 'Claude Code login', email: info.email, plan: info.subscriptionType, env: envWithout('ANTHROPIC_API_KEY') };
  } catch (err) { /* fall through */ }
  // 2) API key fallback
  if (process.env.ANTHROPIC_API_KEY) return { mode: 'apiKey', label: 'API key (.env)', env: { ...process.env } };
  return { mode: 'none', label: 'ຍັງບໍ່ໄດ້ login', env: { ...process.env } };
}

// Real plan limits (the data behind /usage): 5-hour and weekly windows. Opens a session but never sends a prompt.
// The SDK marks this call experimental, so failures just return null.
export async function fetchUsage(env, cwd) {
  const ac = new AbortController();
  let release;
  const never = (async function* () { await new Promise(r => { release = r; }); })();
  const q = query({ prompt: never, options: { cwd, env, abortController: ac, settingSources: [] } });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000));
  try {
    const u = await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skip_behaviors: true }), timeout]);
    const w = x => x && x.utilization != null ? { pct: Math.round(x.utilization), resetsAt: x.resets_at } : null;
    const rl = u.rate_limits || {};
    return {
      available: !!u.rate_limits_available,
      plan: u.subscription_type,
      fiveHour: w(rl.five_hour),
      weekly: w(rl.seven_day),
      weeklyOpus: w(rl.seven_day_opus),
      weeklySonnet: w(rl.seven_day_sonnet),
      fetchedAt: Date.now(),
    };
  } catch { return null; }
  finally { ac.abort(); release?.(); try { await q.return?.(); } catch { /* closed */ } }
}
