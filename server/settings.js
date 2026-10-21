// Office settings the human can change from the page. Saved to data/settings.json; .env values are the starting defaults.
// Every value is validated against SCHEMA, and the rest of the server reads them live through get(), so no restart is needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

/** group, key, type, label/help (Lao), default and limits. type: number | bool | select | list | agents | path. `toggle` marks a group's on/off switch.
 *  A select lists its own `options` ([{ value, label }]), or the team's agents when options is 'agents'. */
export const SCHEMA = [
  // 1. tokens and budget
  { group: 'usage', key: 'usageEnabled', type: 'bool', toggle: true, def: () => true, label: 'ເປີດໃຊ້ການຕັ້ງຄ່າໝວດນີ້', help: 'ປິດ = ລະບົບໃຊ້ຄ່າເລີ່ມຕົ້ນຂອງໝວດນີ້ແທນ. ຄ່າທີ່ເຈົ້າຕັ້ງໄວ້ຍັງເກັບໄວ້ ເປີດຄືນເມື່ອໃດກໍໄດ້' },
  { group: 'usage', key: 'taskBudgetUsd', type: 'number', min: 0.1, max: 20, step: 0.1, def: () => Number(env('TASK_BUDGET_USD', 1)), label: 'ເພດານຄ່າໃຊ້ຈ່າຍຕໍ່ວຽກ (ຄົນດຽວ, USD)', help: 'ວຽກຈະຢຸດເມື່ອຄ່າໃຊ້ຈ່າຍໂດຍປະມານເກີນນີ້' },
  { group: 'usage', key: 'teamBudgetUsd', type: 'number', min: 0.1, max: 50, step: 0.1, def: () => Number(env('TEAM_BUDGET_USD', 1.5)), label: 'ເພດານຄ່າໃຊ້ຈ່າຍຕໍ່ວຽກ (ທີມ, USD)', help: 'ລວມທັງຫົວໜ້າ ແລະ ພະນັກງານທຸກຄົນໃນວຽກນັ້ນ' },
  { group: 'usage', key: 'resumeMaxTokens', type: 'number', min: 5000, max: 500000, step: 5000, def: () => Number(env('RESUME_MAX_TOKENS', 50000)), label: 'ຂະໜາດ session ສູງສຸດທີ່ "ດຳເນີນຕໍ່" ໄດ້ (token)', help: 'ໃຫຍ່ກວ່ານີ້ ຈະເລີ່ມ session ໃໝ່ພ້ອມສະຫຼຸບແທນການໂຫຼດທັງໝົດ' },
  { group: 'usage', key: 'fiveHourStopPct', type: 'number', min: 50, max: 100, step: 5, def: () => 90, label: 'ຢຸດຮັບວຽກໃໝ່ເມື່ອຮອບ 5 ຊົ່ວໂມງຮອດ (%)', help: 'ເຫຼືອໂຄຕ້າໄວ້ໃຫ້ Claude Code ທີ່ເຈົ້າໃຊ້ເອງ' },
  { group: 'usage', key: 'weeklyWarnPct', type: 'number', min: 50, max: 100, step: 5, def: () => 80, label: 'ເຕືອນເມື່ອໂຄຕ້າລາຍອາທິດເກີນ (%)', help: 'ແຖບຂີດຈຳກັດຈະຂຶ້ນສີເຕືອນ' },
  { group: 'usage', key: 'approvalWarnMin', type: 'number', min: 1, max: 30, step: 1, def: () => 4, label: 'ເຕືອນເມື່ອຄຳຂໍລໍຖ້າເກີນ (ນາທີ)', help: 'ຫຼັງ 5 ນາທີ cache ຂອງໂມເດວໝົດ ແລະ ຕ້ອງເສຍ token ໂຫຼດ context ໃໝ່' },
  { group: 'usage', key: 'leadReadLines', type: 'number', min: 50, max: 2000, step: 50, def: () => 300, label: 'ຫົວໜ້າອ່ານໄຟລ໌ໄດ້ເທື່ອລະ (ແຖວ)', help: 'ໜ້ອຍ = ປະຢັດ token; ໃຫ້ສຸກ (Code Scout) ສຳຫຼວດແທນ' },
  // 2. team and workflow
  { group: 'team', key: 'teamEnabled', type: 'bool', toggle: true, def: () => true, label: 'ເປີດໃຊ້ການຕັ້ງຄ່າໝວດນີ້', help: 'ປິດ = ລະບົບໃຊ້ຄ່າເລີ່ມຕົ້ນຂອງໝວດນີ້ແທນ (ຫົວໜ້າເລີ່ມຕົ້ນ, ພະນັກງານທຸກຄົນເຮັດວຽກ). ຄ່າທີ່ເຈົ້າຕັ້ງໄວ້ຍັງເກັບໄວ້' },
  { group: 'team', key: 'teamLead', type: 'select', options: 'agents', def: () => env('TEAM_LEAD', 'somphone'), label: 'ຫົວໜ້າທີມ', help: 'ຜູ້ວາງແຜນ ແລະ ແຈກວຽກໃນໂໝດທີມ' },
  { group: 'team', key: 'disabledAgents', type: 'agents', def: () => [], label: 'ພະນັກງານທີ່ເຮັດວຽກ', help: 'ຄົນທີ່ປິດ ຈະບໍ່ຖືກແຈກວຽກ ແລະ ລາຍຊື່ທີມໃນ prompt ຈະສັ້ນລົງ' },
  { group: 'team', key: 'superpowers', type: 'bool', def: () => true, label: 'ໃຊ້ Superpowers', help: 'ວາງແຜນດ້ວຍ writing-plans ແລະ ແຈກວຽກດ້ວຍ subagent-driven-development (ຖ້າຕິດຕັ້ງໄວ້)' },
  { group: 'team', key: 'splitPhases', type: 'bool', def: () => true, label: 'ແຍກຊ່ວງວາງແຜນ ແລະ ລົງມືເຮັດ', help: 'ຫຼັງອະນຸມັດແຜນ ເລີ່ມ session ໃໝ່ທີ່ເອົາໄປແຕ່ແຜນ (ປະຢັດ token)' },
  { group: 'team', key: 'useTdd', type: 'bool', def: () => true, label: 'ໃຫ້ນັກພັດທະນາໃຊ້ TDD', help: 'ຂຽນ test ກ່ອນໂຄດ (superpowers:test-driven-development)' },
  { group: 'team', key: 'alwaysTest', type: 'bool', def: () => true, label: 'ໃຫ້ ຕ້ອຍ (QA) ເທສທຸກວຽກ', help: 'ລັນ test ເທື່ອດຽວຫຼັງວຽກທັງໝົດແລ້ວ' },
  { group: 'team', key: 'autoSecurity', type: 'bool', def: () => false, label: 'ໃຫ້ ສີ ກວດຄວາມປອດໄພທຸກວຽກ', help: 'ປິດໄວ້ = ກວດສະເພາະເມື່ອແຜນລະບຸ' },
  { group: 'team', key: 'fixRounds', type: 'number', min: 0, max: 3, step: 1, def: () => 1, label: 'ຈຳນວນຮອບແກ້ຄືນຫຼັງກວດ', help: '0 = ລາຍງານບັນຫາຢ່າງດຽວ, ບໍ່ແກ້ຄືນ' },
  // 3. permissions
  { group: 'perm', key: 'autoApproveDefault', type: 'bool', def: () => false, label: 'ເປີດ "ອະນຸຍາດອັດຕະໂນມັດ" ໃຫ້ວຽກໃໝ່', help: 'ແຜນງານຍັງຕ້ອງອະນຸມັດດ້ວຍມືສະເໝີ' },
  { group: 'perm', key: 'allowCommands', type: 'list', def: () => ['npm test', 'npm run test', 'npm run lint', 'node --check', 'node --test', 'git status', 'git diff', 'git log', 'ls', 'pwd'], label: 'ຄຳສັ່ງທີ່ອະນຸຍາດອັດຕະໂນມັດ', help: 'ແຖວລະອັນ. ອະນຸຍາດເມື່ອຄຳສັ່ງຂຶ້ນຕົ້ນດ້ວຍຂໍ້ຄວາມນີ້ ແລະ ບໍ່ມີ ; & | > ` $' },
  { group: 'perm', key: 'denyCommands', type: 'list', def: () => ['git push', 'npm publish', 'rm -rf', 'sudo', 'git reset --hard', 'git clean'], label: 'ຄຳສັ່ງທີ່ປະຕິເສດສະເໝີ', help: 'ແຖວລະອັນ. ປະຕິເສດເມື່ອພົບຂໍ້ຄວາມນີ້ຢູ່ບ່ອນໃດກໍໄດ້ໃນຄຳສັ່ງ' },
  // 5. notifications
  { group: 'notify', key: 'notifyPlan', type: 'bool', def: () => true, label: 'ແຈ້ງເຕືອນເມື່ອມີແຜນລໍຖ້າອະນຸມັດ' },
  { group: 'notify', key: 'notifyApproval', type: 'bool', def: () => true, label: 'ແຈ້ງເຕືອນເມື່ອມີຄຳຂໍອະນຸຍາດ' },
  { group: 'notify', key: 'notifyDone', type: 'bool', def: () => true, label: 'ແຈ້ງເຕືອນເມື່ອວຽກສຳເລັດ ຫຼື ລົ້ມເຫຼວ' },
  { group: 'notify', key: 'notifySound', type: 'bool', def: () => true, label: 'ມີສຽງແຈ້ງເຕືອນ' },
  // 4. projects and tools
  { group: 'project', key: 'defaultProject', type: 'path', def: () => '', label: 'ໂຟນເດີໂປຣເຈັກເລີ່ມຕົ້ນ', help: 'ເປີດໜ້າມາຈະເລືອກໂຟນເດີນີ້ກ່ອນ ແລະ ໃຊ້ເມື່ອວຽກບໍ່ໄດ້ລະບຸໂຟນເດີ. ວ່າງ = ໂຟນເດີທີ່ໃຊ້ລ່າສຸດ' },
  { group: 'project', key: 'editor', type: 'select', options: [{ value: 'antigravity', label: 'Antigravity' }, { value: 'vscode', label: 'VS Code' }, { value: 'finder', label: 'Finder' }], def: () => 'antigravity', label: 'ເປີດໂຟນເດີດ້ວຍ', help: 'ປຸ່ມ 📂 ໃນແຜງໂປຣເຈັກ ແລະ ໃນປະຫວັດການສົນທະນາ' },
  { group: 'project', key: 'folderSearchDepth', type: 'number', min: 2, max: 10, step: 1, def: () => 6, label: 'ຄວາມເລິກຂອງການຄົ້ນຫາໂຟນເດີ (ຊັ້ນ)', help: 'ນັບຈາກ home. ເລິກ = ພົບຫຼາຍ ແຕ່ຊ້າລົງ' },
  { group: 'project', key: 'folderSkip', type: 'list', def: () => ['node_modules', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'vendor', 'venv', '.venv', 'dist', 'build', 'target', '__pycache__', 'Pods', 'DerivedData'], label: 'ໂຟນເດີທີ່ຂ້າມເວລາຄົ້ນຫາ', help: 'ແຖວລະຊື່. ໂຟນເດີທີ່ຂຶ້ນຕົ້ນດ້ວຍ . ຖືກຂ້າມສະເໝີ' },
  // 6. language and reports
  { group: 'report', key: 'reportLanguage', type: 'select', options: [{ value: 'lo', label: 'ພາສາລາວ' }, { value: 'en', label: 'English' }, { value: 'th', label: 'ภาษาไทย' }], def: () => 'lo', label: 'ພາສາຂອງບົດສະຫຼຸບ', help: 'ບົດສະຫຼຸບຕອນວຽກຈົບ. ການສື່ສານລະຫວ່າງ AI ຍັງເປັນພາສາອັງກິດ (ປະຢັດ token)' },
  { group: 'report', key: 'reportLength', type: 'select', options: [{ value: 'short', label: 'ສັ້ນ (ບໍ່ເກີນ ~150 ຄຳ)' }, { value: 'detailed', label: 'ລະອຽດ (ແບ່ງເປັນຫົວຂໍ້)' }], def: () => 'short', label: 'ຄວາມຍາວຂອງບົດສະຫຼຸບ' },
  { group: 'report', key: 'mateReportWords', type: 'number', min: 100, max: 800, step: 50, def: () => 200, label: 'ພະນັກງານລາຍງານຫົວໜ້າບໍ່ເກີນ (ຄຳ)', help: 'ລາຍງານສັ້ນ = context ຂອງຫົວໜ້າໂຕຊ້າລົງ ແລະ ປະຢັດ token' },
  // 7. display
  { group: 'display', key: 'animSpeed', type: 'number', min: 0.5, max: 3, step: 0.5, def: () => 1, label: 'ຄວາມໄວການເຄື່ອນໄຫວໃນຫ້ອງການ (ເທົ່າ)', help: '1 = ປົກກະຕິ' },
  { group: 'display', key: 'showBubbles', type: 'bool', def: () => true, label: 'ສະແດງຂໍ້ຄວາມເທິງຫົວພະນັກງານ', help: 'ປ້າຍບອກວ່າແຕ່ລະຄົນກຳລັງເຮັດຫຍັງ' },
  // 8. data and history
  { group: 'data', key: 'keepTasks', type: 'number', min: 50, max: 2000, step: 50, def: () => 300, label: 'ຈຳນວນວຽກທີ່ເກັບໄວ້', help: 'ວຽກເກົ່າກວ່ານີ້ຈະຖືກລຶບອອກເອງ' },
  { group: 'data', key: 'keepMessages', type: 'number', min: 100, max: 5000, step: 100, def: () => 800, label: 'ຈຳນວນຂໍ້ຄວາມທີ່ເກັບຕໍ່ວຽກ', help: 'ປະຫວັດການສົນທະນາຂອງແຕ່ລະວຽກ' },
];
export const GROUPS = [
  { key: 'usage', label: 'ການໃຊ້ token ແລະ ງົບປະມານ', toggle: 'usageEnabled' },
  { key: 'team', label: 'ທີມ ແລະ ຂັ້ນຕອນການເຮັດວຽກ', toggle: 'teamEnabled' },
  { key: 'perm', label: 'ຄວາມປອດໄພ ແລະ ການອະນຸຍາດ' },
  { key: 'notify', label: 'ການແຈ້ງເຕືອນ' },
  { key: 'project', label: 'ໂປຣເຈັກ ແລະ ເຄື່ອງມື' },
  { key: 'report', label: 'ພາສາ ແລະ ການລາຍງານ' },
  { key: 'display', label: 'ການສະແດງຜົນ' },
  { key: 'data', label: 'ຂໍ້ມູນ ແລະ ປະຫວັດ' },
];
const BY_KEY = new Map(SCHEMA.map(s => [s.key, s]));

/** Validate one value; returns the clean value or throws (message in Lao). */
export function clean(key, value, agentKeys = []) {
  const s = BY_KEY.get(key); if (!s) throw new Error(`ບໍ່ຮູ້ຈັກການຕັ້ງຄ່າ: ${key}`);
  switch (s.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${s.label}: ຕ້ອງເປັນຕົວເລກ`);
      if (n < s.min || n > s.max) throw new Error(`${s.label}: ຕ້ອງຢູ່ລະຫວ່າງ ${s.min} ແລະ ${s.max}`);
      return n;
    }
    case 'bool': if (typeof value !== 'boolean') throw new Error(`${s.label}: ຕ້ອງເປັນ ເປີດ/ປິດ`); return value;
    case 'select':
      if (Array.isArray(s.options)) { if (!s.options.some(o => o.value === value)) throw new Error(`${s.label}: ຄ່າບໍ່ຖືກຕ້ອງ`); return value; }
      if (!agentKeys.includes(value)) throw new Error(`${s.label}: ບໍ່ພົບພະນັກງານ ${value}`); return value;
    case 'path': {
      const raw = String(value ?? '').trim(); if (!raw) return '';
      const dir = path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
      let ok = false; try { ok = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
      if (!ok) throw new Error(`${s.label}: ບໍ່ພົບໂຟນເດີ ${dir}`);
      return dir;
    }
    case 'list': {
      const arr = (Array.isArray(value) ? value : String(value ?? '').split('\n')).map(x => String(x).trim()).filter(Boolean);
      if (arr.length > 100 || arr.some(x => x.length > 200)) throw new Error(`${s.label}: ຍາວເກີນໄປ`);
      return [...new Set(arr)];
    }
    case 'agents': {
      if (!Array.isArray(value)) throw new Error(`${s.label}: ຮູບແບບບໍ່ຖືກ`);
      return [...new Set(value.map(String))].filter(k => agentKeys.includes(k));
    }
  }
  throw new Error(`unknown type ${s.type}`);
}

export function createSettings(file, { agentKeys = () => [] } = {}) {
  const defaults = () => Object.fromEntries(SCHEMA.map(s => [s.key, s.def()]));
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first run */ }
  let values = defaults();
  for (const [k, v] of Object.entries(saved)) { try { values[k] = clean(k, v, agentKeys()); } catch { /* drop invalid saved value */ } }
  const write = () => {
    const d = defaults(), out = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(d[k])));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out, null, 2));
  };
  /** values the office actually runs with: a group switched off uses its defaults, while the saved values stay for when it is switched back on */
  const effective = () => {
    const d = defaults(), out = { ...values };
    for (const g of GROUPS) if (g.toggle && values[g.toggle] === false) for (const s of SCHEMA) if (s.group === g.key && s.key !== g.toggle) out[s.key] = d[s.key];
    return out;
  };
  return {
    get: () => values,
    effective,
    schema: () => ({ groups: GROUPS, fields: SCHEMA.map(({ def, ...s }) => ({ ...s, default: def() })) }),
    /** apply several changes at once; all-or-nothing. `null` resets a key to its default. */
    patch(changes) {
      const next = { ...values }, d = defaults();
      for (const [k, v] of Object.entries(changes || {})) next[k] = v === null ? d[k] : clean(k, v, agentKeys());
      if (next.disabledAgents.includes(next.teamLead)) throw new Error('ປິດຫົວໜ້າທີມບໍ່ໄດ້: ເລືອກຫົວໜ້າຄົນອື່ນກ່ອນ');
      values = next; write(); return values;
    },
  };
}

const SHELL_META = /[;&|`$<>\n]/;
/** What to do with a shell command without asking: 'deny', 'allow', or null (ask the human). */
export function commandRule(command, { allowCommands = [], denyCommands = [] } = {}) {
  const c = String(command || '').trim().replace(/\s+/g, ' ');
  const word = d => new RegExp(`(^|[\\s;&|(\`$])${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s;&|)\`])`);
  if (denyCommands.some(d => d && word(d.trim()).test(c))) return 'deny';
  if (SHELL_META.test(c)) return null;
  if (allowCommands.some(a => a && (c === a || c.startsWith(a + ' ')))) return 'allow';
  return null;
}
