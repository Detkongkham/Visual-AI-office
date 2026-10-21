// Pending human approvals plus per-task auto-allow for tool requests (plan requests are never auto-allowed).
// Auto signalling: the caller checks isAuto(taskId) before ask() to log/skip UI state; ask() also resolves true for auto tool requests as a safety net.
// task.autoApprove is the human's intent; it is only enforced for team tasks once the plan is approved
export const autoEffective = task => !!task.autoApprove && (task.mode !== 'team' || !!task.planApproved);

export function createApprovals({ onAdd = () => {}, onDone = () => {} } = {}) {
  const pending = new Map(); // id -> { ...item, resolve }
  const auto = new Set();    // taskIds with auto-allow on
  const pub = ({ resolve, autoOk, ...a }) => a;
  const deny = ap => ap.resolve(ap.kind === 'plan' ? { allow: false } : false);

  const isAuto = taskId => auto.has(taskId);
  const get = id => { const ap = pending.get(id); return ap ? pub(ap) : null; };
  const list = () => [...pending.values()].map(pub);

  const ask = item => new Promise(resolve => {
    if (item.kind === 'tool' && auto.has(item.taskId) && item.autoOk === true) return resolve(true);
    pending.set(item.id, { ...item, resolve });
    onAdd(pub(pending.get(item.id)));
  });

  // returns the stored item (without resolve) or null when it no longer exists
  const decide = (id, { allow, feedback } = {}) => {
    const ap = pending.get(id); if (!ap) return null;
    pending.delete(id); onDone(id);
    ap.resolve(ap.kind === 'plan' ? { allow, feedback } : allow);
    return pub(ap);
  };

  // on: allow this task's pending tool requests now and all later ones; returns the resolved items. off: stop auto-allowing.
  const setAuto = (taskId, on) => {
    if (!on) { auto.delete(taskId); return []; }
    auto.add(taskId);
    const done = [];
    for (const [id, ap] of pending) if (ap.taskId === taskId && ap.kind === 'tool') { pending.delete(id); onDone(id); ap.resolve(true); done.push(pub(ap)); }
    return done;
  };

  // deny everything pending for the task and drop its auto flag (task ended or was aborted)
  const clearTask = taskId => {
    auto.delete(taskId);
    for (const [id, ap] of pending) if (ap.taskId === taskId) { pending.delete(id); onDone(id); deny(ap); }
  };

  return { ask, decide, setAuto, clearTask, list, isAuto, get };
}
