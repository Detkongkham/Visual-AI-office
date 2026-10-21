import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApprovals, autoEffective } from '../server/approvals.js';

const tool = (id, taskId = 't1') => ({ id, taskId, kind: 'tool' });
const plan = (id, taskId = 't1') => ({ id, taskId, kind: 'plan' });
const setup = () => {
  const added = [], done = [];
  const a = createApprovals({ onAdd: x => added.push(x.id), onDone: id => done.push(id) });
  return { a, added, done };
};
// true if the promise has not settled yet
const isPending = async p => (await Promise.race([p, Promise.resolve('__pending__')])) === '__pending__';

test('ask adds to list; decide resolves tool with boolean and fires onDone', async () => {
  const { a, added, done } = setup();
  const p = a.ask(tool('a1'));
  assert.deepEqual(added, ['a1']);
  assert.equal(a.list().length, 1);
  assert.equal(a.list()[0].id, 'a1');
  assert.equal('resolve' in a.list()[0], false);
  assert.ok(a.decide('a1', { allow: true }));
  assert.equal(await p, true);
  assert.deepEqual(done, ['a1']);
  assert.equal(a.list().length, 0);
});

test('decide resolves plan with { allow, feedback }', async () => {
  const { a } = setup();
  const p = a.ask(plan('p1'));
  a.decide('p1', { allow: false, feedback: 'redo' });
  assert.deepEqual(await p, { allow: false, feedback: 'redo' });
});

test('decide on unknown id returns falsy and does not call onDone', () => {
  const { a, done } = setup();
  assert.ok(!a.decide('nope', { allow: true }));
  assert.deepEqual(done, []);
});

test('setAuto(on) resolves only that task\'s pending tool requests', async () => {
  const { a, done } = setup();
  const t1 = a.ask(tool('a1', 't1'));
  const p1 = a.ask(plan('p1', 't1'));
  const t2 = a.ask(tool('b1', 't2'));
  const res = a.setAuto('t1', true);
  assert.deepEqual(res.map(x => x.id), ['a1']);
  assert.equal(await t1, true);
  assert.deepEqual(done, ['a1']);
  assert.equal(await isPending(p1), true);
  assert.equal(await isPending(t2), true);
  assert.deepEqual(a.list().map(x => x.id).sort(), ['b1', 'p1']);
  assert.equal(a.isAuto('t1'), true);
  assert.equal(a.isAuto('t2'), false);
});

test('with auto on, later tool asks resolve true without onAdd', async () => {
  const { a, added } = setup();
  a.setAuto('t1', true);
  assert.equal(await a.ask({ ...tool('a2', 't1'), autoOk: true }), true);
  assert.deepEqual(added, []);
  assert.equal(a.list().length, 0);
});

test('plan requests are never auto-allowed', async () => {
  const { a, added } = setup();
  a.setAuto('t1', true);
  const p = a.ask(plan('p1', 't1'));
  assert.deepEqual(added, ['p1']);
  assert.equal(await isPending(p), true);
  assert.equal(a.list().length, 1);
});

test('setAuto(off) makes next tool ask pending again', async () => {
  const { a, added } = setup();
  a.setAuto('t1', true);
  a.setAuto('t1', false);
  assert.equal(a.isAuto('t1'), false);
  const p = a.ask(tool('a3', 't1'));
  assert.deepEqual(added, ['a3']);
  assert.equal(await isPending(p), true);
});

test('clearTask resets auto and leaves other tasks untouched', async () => {
  const { a, done } = setup();
  a.setAuto('t1', true);
  const p = a.ask(plan('p1', 't1'));
  const other = a.ask(tool('b1', 't2'));
  a.clearTask('t1');
  assert.deepEqual(await p, { allow: false });
  assert.equal(a.isAuto('t1'), false);
  assert.deepEqual(done, ['p1']);
  assert.equal(await isPending(other), true);
});

test('clearTask denies pending tool requests with false', async () => {
  const { a } = setup();
  const t = a.ask(tool('a1', 't1'));
  const p = a.ask(plan('p1', 't1'));
  a.clearTask('t1');
  assert.equal(await t, false);
  assert.deepEqual(await p, { allow: false });
  assert.equal(a.list().length, 0);
});

test('autoEffective: single mode follows autoApprove', () => {
  assert.equal(autoEffective({ mode: 'single', autoApprove: true }), true);
  assert.equal(autoEffective({ mode: 'single', autoApprove: false }), false);
});

test('autoEffective: team mode needs planApproved too', () => {
  assert.equal(autoEffective({ mode: 'team', autoApprove: true, planApproved: false }), false);
  assert.equal(autoEffective({ mode: 'team', autoApprove: true }), false);
  assert.equal(autoEffective({ mode: 'team', autoApprove: true, planApproved: true }), true);
});

test('autoEffective: missing or undefined autoApprove is false', () => {
  assert.equal(autoEffective({ mode: 'single' }), false);
  assert.equal(autoEffective({ mode: 'single', autoApprove: undefined }), false);
  assert.equal(autoEffective({ mode: 'team', planApproved: true }), false);
});
