import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeam, normalize, SEATS } from '../server/team.js';

const MODELS = [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }];
const base = () => ({
  models: MODELS, efforts: ['low', 'medium', 'high'],
  agents: [
    { key: 'somphone', name: 'ສົມພອນ', role: 'Tech Lead', model: 'claude-sonnet-5-5', effort: 'medium', access: 'write', maxTurns: 40, prompt: 'lead' },
    { key: 'dao', name: 'ດາວ', role: 'Frontend Developer', model: 'claude-sonnet-5-5', effort: 'medium', access: 'write', maxTurns: 60, prompt: 'frontend' },
    { key: 'scout', name: 'ສຸກ', role: 'Code Scout', model: 'claude-haiku-5-5', effort: 'low', access: 'read', maxTurns: 15, prompt: 'scout' },
  ],
});
const make = (cfg = base(), opts = {}) => { let saves = 0; const t = createTeam(cfg, { save: () => saves++, lead: () => 'somphone', ...opts }); return { t, cfg, saves: () => saves }; };

test('an old team.json gets the seats, drawings and spots the office used before', () => {
  const cfg = base();
  assert.equal(normalize(cfg), true);
  assert.deepEqual(cfg.agents.map(a => [a.seat, a.look.sprite]), [['labSeat1', 'somphone'], ['dev1', 'dao'], ['dev4', 'kham']]);
  assert.deepEqual(cfg.agents[1].spot, ['core2', 'ກວດໜ້າ UI ໃນ hologram']);
  assert.equal(cfg.agents[0].look.shirt, null);
  assert.deepEqual(cfg.archived, []);
  assert.equal(normalize(cfg), false, 'a second pass changes nothing');
});

test('duplicate or unknown seats are moved to a free desk', () => {
  const cfg = base(); cfg.agents[1].seat = 'labSeat1'; cfg.agents[2].seat = 'nowhere';
  normalize(cfg);
  const seats = cfg.agents.map(a => a.seat);
  assert.equal(new Set(seats).size, 3);
  assert.ok(seats.every(s => SEATS.includes(s)));
});

test('hire from a template: copies role and settings, takes a free desk, gets a fresh key', () => {
  const { t, saves } = make();
  const a = t.add({ name: 'ນາງ', copyFrom: 'dao', look: { shirt: '#2F7DE1' } });
  assert.equal(a.key, 'emp1');
  assert.equal(a.role, 'Frontend Developer');
  assert.equal(a.maxTurns, 60);
  assert.deepEqual(a.look, { sprite: 'dao', shirt: '#2f7de1', color: null });
  assert.ok(SEATS.includes(a.seat) && !['labSeat1', 'dev1', 'dev4'].includes(a.seat));
  assert.equal(t.add({ name: 'ສອງ', role: 'QA', prompt: 'test things' }).key, 'emp2');
  assert.ok(saves() >= 2);
});

test('hiring checks every field', () => {
  const { t } = make();
  assert.throws(() => t.add({ role: 'x', prompt: 'y' }), /ຊື່/);
  assert.throws(() => t.add({ name: 'a', role: 'x', prompt: 'y', access: 'admin' }), /ສິດ/);
  assert.throws(() => t.add({ name: 'a', role: 'x', prompt: 'y', model: 'gpt' }), /ໂມເດວ/);
  assert.throws(() => t.add({ name: 'a', role: 'x', prompt: 'y', seat: 'dev1' }), /ດາວ/);
  assert.throws(() => t.add({ name: 'a', role: 'x', prompt: 'y', look: { sprite: 'robot' } }), /ຮູບ/);
  assert.throws(() => t.add({ name: 'a', role: 'x', prompt: 'y', look: { shirt: 'red' } }), /#rrggbb/);
  assert.throws(() => t.add({ name: 'x'.repeat(31), role: 'x', prompt: 'y' }), /30/);
  assert.equal(t.list().length, 3, 'nothing was added');
});

test('edit only touches the given fields; look changes merge', () => {
  const { t } = make();
  t.update('dao', { look: { shirt: '#112233' } });
  t.update('dao', { name: 'ດາວ 2', look: { color: '#abcdef' } });
  const a = t.get('dao');
  assert.equal(a.name, 'ດາວ 2'); assert.equal(a.role, 'Frontend Developer');
  assert.deepEqual(a.look, { sprite: 'dao', shirt: '#112233', color: '#abcdef' });
  t.update('dao', { look: { shirt: null } });
  assert.equal(a.look.shirt, null);
  t.update('dao', { seat: 'dev3' }); assert.equal(a.seat, 'dev3');
  t.update('dao', { seat: 'dev3' }); // own seat is fine
  assert.throws(() => t.update('dao', { seat: 'labSeat1' }), /ສົມພອນ/);
  assert.throws(() => t.update('ghost', { name: 'x' }), /ບໍ່ພົບ/);
});

test('archive and restore: not the lead, not someone busy; the desk is freed and retaken', () => {
  let busy = false;
  const { t, cfg } = make(base(), { isBusy: () => busy });
  assert.throws(() => t.archive('somphone'), /ຫົວໜ້າ/);
  busy = true; assert.throws(() => t.archive('dao'), /ກຳລັງເຮັດວຽກ/); busy = false;
  t.archive('dao');
  assert.deepEqual(t.list().map(a => a.key), ['somphone', 'scout']);
  assert.equal(cfg.archived[0].key, 'dao'); assert.equal(cfg.archived[0].seat, null);
  assert.ok(t.freeSeats().includes('dev1'));
  const back = t.restore('dao');
  assert.ok(SEATS.includes(back.seat));
  assert.equal(t.archived().length, 0);
  assert.equal(t.add({ name: 'n', role: 'r', prompt: 'p' }).key, 'emp1');
});

test('archived keys are never reused for new hires', () => {
  const { t } = make();
  const a = t.add({ name: 'n', role: 'r', prompt: 'p' }); t.archive(a.key);
  assert.equal(t.add({ name: 'm', role: 'r', prompt: 'p' }).key, 'emp2');
});

test('reorder needs every active key exactly once', () => {
  const { t } = make();
  t.reorder(['scout', 'somphone', 'dao']);
  assert.deepEqual(t.list().map(a => a.key), ['scout', 'somphone', 'dao']);
  assert.throws(() => t.reorder(['scout', 'somphone']));
  assert.throws(() => t.reorder(['scout', 'scout', 'dao']));
  assert.throws(() => t.reorder(['scout', 'somphone', 'ghost']));
});
