// The team roster: who works in the office, in which order, at which desk and how they look.
// config/team.json is the single source; the page draws people from it. Archived employees keep their record
// so old chats still show their name and picture.

// desks a person can sit at (their coordinates live in web/office.js, SP); keep the two lists in step
export const SEATS = [
  'ceoSeat', 'baSeat1', 'baSeat2', 'labSeat1', 'labSeat2', 'labSeat3', 'qaSeat', 'opsSeat1', 'opsSeat2',
  'dev1', 'dev2', 'dev3', 'dev4', 'devB1', 'devB2', 'devB3', 'devB4', 'devC1', 'devC2', 'devC3', 'devC4',
  'futA1', 'futA2', 'futA3', 'futA4', 'futA5', 'futB1', 'futB2', 'futB3', 'futB4', 'futB5',
];
// drawings in web/assets/atlas.js
export const SPRITES = ['ceo', 'manee', 'somphone', 'dao', 'bounmy', 'keo', 'noy', 'phone', 'toy', 'kham', 'sy', 'saeng', 'vanh', 'thong', 'chanh'];

// what the office used before the roster held seats and looks (filled in once for older team.json files)
const LEGACY = {
  ceo: ['ceoSeat', 'ceo', ['core1', 'ອະນຸມັດວຽກທີ່ AI Core']], manee: ['baSeat1', 'manee', ['baBoard', 'ນຳສະເໜີ requirement ທີ່ກະດານ']],
  somphone: ['labSeat1', 'somphone', ['labAct', 'ອະທິບາຍ architecture']], dao: ['dev1', 'dao', ['core2', 'ກວດໜ້າ UI ໃນ hologram']],
  bounmy: ['dev2', 'bounmy', null], keo: ['devB1', 'keo', ['cafe2', 'ອ່ານ code ພ້ອມກາເຟ']], noy: ['devB2', 'noy', null],
  phone: ['devC1', 'phone', ['lounge2', 'ທົດສອບແອັບໃນມືຖື']], toy: ['qaSeat', 'toy', ['qaHolo', 'ກວດຜົນເທສໃນ hologram']],
  kham: ['opsSeat1', 'kham', null], sy: ['opsSeat2', 'sy', null], saeng: ['baSeat2', 'saeng', ['meet1', 'ນຳປະຊຸມ planning ໃນສວນ']],
  vanh: ['labSeat3', 'vanh', ['labHolo', 'ວິເຄາະ neural network ໃນ hologram']], thong: ['devC2', 'thong', ['lounge1', 'ຂຽນເອກະສານໃນ Lounge']],
  chanh: ['devC3', 'chanh', ['meet2', 'ນຳ stand-up meeting ໃນສວນ']], scout: ['dev4', 'kham', null],
};

const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
const text = (v, label, max, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new Error(`ກະລຸນາໃສ່${label}`);
  if (s.length > max) throw new Error(`${label}ຍາວເກີນ ${max} ຕົວອັກສອນ`);
  return s;
};

/** fill in seat, look and spot for agents that lack them; returns true when something changed */
export function normalize(config) {
  let changed = false;
  config.archived = Array.isArray(config.archived) ? config.archived : [];
  const all = [...config.agents, ...config.archived];
  for (const a of all) {
    const old = LEGACY[a.key] || [];
    if (!a.look || typeof a.look !== 'object') { a.look = {}; changed = true; }
    if (!SPRITES.includes(a.look.sprite)) { a.look.sprite = old[1] || SPRITES[0]; changed = true; }
    for (const k of ['shirt', 'color']) if (a.look[k] !== null && !hex(a.look[k])) { a.look[k] = null; changed = true; }
    if (a.spot === undefined) { a.spot = old[2] || null; changed = true; }
  }
  // seats: keep a valid, unique seat; otherwise the old one, otherwise the first free desk
  const taken = new Set();
  for (const a of config.agents) {
    if (SEATS.includes(a.seat) && !taken.has(a.seat)) { taken.add(a.seat); continue; }
    const want = LEGACY[a.key]?.[0], seat = want && !taken.has(want) ? want : SEATS.find(s => !taken.has(s)) || null;
    if (a.seat !== seat) { a.seat = seat; changed = true; }
    if (seat) taken.add(seat);
  }
  return changed;
}

/** the roster API used by the server; save() persists config, isBusy(key) says whether someone has work in hand */
export function createTeam(config, { save = () => {}, isBusy = () => false, lead = () => null } = {}) {
  if (normalize(config)) save();
  const byKey = k => config.agents.find(a => a.key === k);
  const freeSeats = (except) => SEATS.filter(s => !config.agents.some(a => a.seat === s && a.key !== except));

  /** validate the editable fields; `partial` = only the fields present (an edit) */
  function clean(input, { partial = false, self = null } = {}) {
    const out = {}, has = k => !partial || input[k] !== undefined;
    if (has('name')) out.name = text(input.name, 'ຊື່', 30);
    if (has('role')) out.role = text(input.role, 'ບົດບາດ', 60);
    if (has('prompt')) out.prompt = text(input.prompt, 'ໜ້າທີ່ (prompt)', 4000);
    if (has('access')) { if (!['read', 'write'].includes(input.access)) throw new Error('ສິດຕ້ອງເປັນ read ຫຼື write'); out.access = input.access; }
    if (has('model')) { if (!config.models.some(m => m.id === input.model)) throw new Error('ໂມເດວບໍ່ຖືກຕ້ອງ'); out.model = input.model; }
    if (has('effort')) { if (!config.efforts.includes(input.effort)) throw new Error('effort ບໍ່ຖືກຕ້ອງ'); out.effort = input.effort; }
    if (has('maxTurns')) { const n = Number(input.maxTurns); if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('maxTurns ຕ້ອງເປັນ 1 ຫາ 200'); out.maxTurns = n; }
    if (has('seat')) {
      if (!SEATS.includes(input.seat)) throw new Error('ບໍ່ພົບໂຕະນີ້');
      const other = config.agents.find(a => a.seat === input.seat && a.key !== self);
      if (other) throw new Error(`ໂຕະນີ້ ${other.name} ນັ່ງຢູ່ແລ້ວ`);
      out.seat = input.seat;
    }
    if (has('look')) {
      const l = input.look || {}, cur = (self && byKey(self)?.look) || {};
      const sprite = l.sprite === undefined ? cur.sprite : l.sprite;
      if (!SPRITES.includes(sprite)) throw new Error('ບໍ່ພົບຮູບຕົວລະຄອນນີ້');
      const color = k => { const v = l[k] === undefined ? (cur[k] ?? null) : l[k]; if (v !== null && !hex(v)) throw new Error('ສີຕ້ອງເປັນຮູບແບບ #rrggbb'); return v === null ? null : hex(v); };
      out.look = { sprite, shirt: color('shirt'), color: color('color') };
    }
    return out;
  }

  // a key the lead can use as subagent_type: short ASCII, unique among active and archived people
  function newKey() {
    const used = new Set([...config.agents, ...config.archived].map(a => a.key));
    for (let n = 1; ; n++) if (!used.has('emp' + n)) return 'emp' + n;
  }

  return {
    SEATS, SPRITES,
    list: () => config.agents,
    archived: () => config.archived,
    get: byKey,
    freeSeats,
    /** hire: fields as in clean(); `copyFrom` = an employee whose settings fill the gaps */
    add(input = {}) {
      const base = input.copyFrom ? (byKey(input.copyFrom) || config.archived.find(a => a.key === input.copyFrom)) : null;
      if (input.copyFrom && !base) throw new Error('ບໍ່ພົບພະນັກງານທີ່ຈະໃຊ້ເປັນແມ່ແບບ');
      const seat = input.seat ?? freeSeats()[0];
      if (!seat) throw new Error('ບໍ່ມີໂຕະວ່າງແລ້ວ: ເກັບບາງຄົນເຂົ້າຄັງກ່ອນ');
      const merged = {
        access: 'write', model: config.models[1]?.id || config.models[0].id, effort: 'medium', maxTurns: 40,
        ...(base ? { role: base.role, prompt: base.prompt, access: base.access, model: base.model, effort: base.effort, maxTurns: base.maxTurns } : {}),
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), seat,
      };
      merged.look = { ...(base ? base.look : { sprite: SPRITES[0] }), ...(input.look || {}) };
      const a = { key: newKey(), ...clean(merged), spot: null };
      config.agents.push(a); save(); return a;
    },
    update(key, input = {}) {
      const a = byKey(key); if (!a) throw new Error('ບໍ່ພົບພະນັກງານ');
      Object.assign(a, clean(input, { partial: true, self: key })); save(); return a;
    },
    /** move to the archive: not the lead, not someone with work in hand */
    archive(key) {
      const a = byKey(key); if (!a) throw new Error('ບໍ່ພົບພະນັກງານ');
      if (key === lead()) throw new Error('ເກັບຫົວໜ້າທີມເຂົ້າຄັງບໍ່ໄດ້: ເລືອກຫົວໜ້າຄົນອື່ນໃນ ການຕັ້ງຄ່າ ກ່ອນ');
      if (config.agents.length <= 1) throw new Error('ຕ້ອງມີພະນັກງານຢ່າງໜ້ອຍ 1 ຄົນ');
      if (isBusy(key)) throw new Error(`${a.name} ກຳລັງເຮັດວຽກ ຫຼື ມີວຽກໃນຄິວ: ລໍຖ້າໃຫ້ແລ້ວກ່ອນ`);
      config.agents = config.agents.filter(x => x !== a); a.seat = null; config.archived.push(a); save(); return a;
    },
    restore(key) {
      const a = config.archived.find(x => x.key === key); if (!a) throw new Error('ບໍ່ພົບໃນຄັງ');
      const seat = freeSeats()[0]; if (!seat) throw new Error('ບໍ່ມີໂຕະວ່າງແລ້ວ');
      config.archived = config.archived.filter(x => x !== a); a.seat = seat; config.agents.push(a); save(); return a;
    },
    /** new order: every active key exactly once */
    reorder(keys) {
      const now = config.agents.map(a => a.key);
      if (!Array.isArray(keys) || keys.length !== now.length || new Set(keys).size !== keys.length || !keys.every(k => now.includes(k))) throw new Error('ລຳດັບບໍ່ຄົບ ຫຼື ມີຊື່ຊ້ຳ: ໂຫຼດໜ້າໃໝ່ແລ້ວລອງອີກ');
      config.agents = keys.map(byKey); save(); return config.agents;
    },
  };
}
