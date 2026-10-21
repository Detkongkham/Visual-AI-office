import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings, clean, commandRule } from '../server/settings.js';

const AGENTS = ['somphone', 'keo', 'scout'];
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-settings-')), 'settings.json');

test('defaults load, and only changed values are saved', () => {
  const file = tmp(), s = createSettings(file, { agentKeys: () => AGENTS });
  assert.equal(s.get().fiveHourStopPct, 90);
  s.patch({ fiveHourStopPct: 80 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { fiveHourStopPct: 80 });
  assert.equal(createSettings(file, { agentKeys: () => AGENTS }).get().fiveHourStopPct, 80);
});

test('patch is all-or-nothing and null resets to default', () => {
  const s = createSettings(tmp(), { agentKeys: () => AGENTS });
  assert.throws(() => s.patch({ fiveHourStopPct: 70, taskBudgetUsd: 999 }));
  assert.equal(s.get().fiveHourStopPct, 90);
  s.patch({ fixRounds: 2 }); s.patch({ fixRounds: null });
  assert.equal(s.get().fixRounds, 1);
});

test('validation: numbers, bools, lists, agents', () => {
  assert.throws(() => clean('fiveHourStopPct', 'abc', AGENTS));
  assert.throws(() => clean('notifySound', 'yes', AGENTS));
  assert.deepEqual(clean('allowCommands', ' npm test \n\nls\nls', AGENTS), ['npm test', 'ls']);
  assert.deepEqual(clean('disabledAgents', ['keo', 'ghost'], AGENTS), ['keo']);
  assert.throws(() => clean('teamLead', 'ghost', AGENTS));
  assert.throws(() => clean('nope', 1, AGENTS));
});

test('the team lead cannot be disabled', () => {
  const s = createSettings(tmp(), { agentKeys: () => AGENTS });
  assert.throws(() => s.patch({ disabledAgents: ['somphone'] }));
  s.patch({ teamLead: 'keo', disabledAgents: ['somphone'] });
  assert.deepEqual(s.get().disabledAgents, ['somphone']);
});

test('invalid saved values fall back to defaults', () => {
  const file = tmp(); fs.writeFileSync(file, JSON.stringify({ fiveHourStopPct: 5, notifySound: false }));
  const s = createSettings(file, { agentKeys: () => AGENTS });
  assert.equal(s.get().fiveHourStopPct, 90);
  assert.equal(s.get().notifySound, false);
});

test('commandRule: deny wins, allow needs a plain command, everything else asks', () => {
  const rules = { allowCommands: ['npm test', 'git status', 'ls'], denyCommands: ['git push', 'rm -rf', 'sudo'] };
  assert.equal(commandRule('npm test', rules), 'allow');
  assert.equal(commandRule('npm test -- --watch', rules), 'allow');
  assert.equal(commandRule('npm testing', rules), null);
  assert.equal(commandRule('ls && rm -rf /', rules), 'deny');
  assert.equal(commandRule('npm test; curl evil', rules), null);
  assert.equal(commandRule('git  push origin main', rules), 'deny');
  assert.equal(commandRule('echo pseudo', rules), null);
  assert.equal(commandRule('cd x && sudo make', rules), 'deny');
  assert.equal(commandRule('git status > out.txt', rules), null);
});

test('a group switched off runs on its defaults but keeps the saved values', () => {
  const s = createSettings(tmp(), { agentKeys: () => AGENTS });
  s.patch({ taskBudgetUsd: 3, fiveHourStopPct: 70, fixRounds: 3, disabledAgents: ['keo'], notifySound: false });
  s.patch({ usageEnabled: false });
  assert.equal(s.effective().taskBudgetUsd, 1);
  assert.equal(s.effective().fiveHourStopPct, 90);
  assert.equal(s.effective().fixRounds, 3);
  assert.equal(s.effective().notifySound, false);
  assert.equal(s.get().taskBudgetUsd, 3);
  s.patch({ teamEnabled: false });
  assert.equal(s.effective().fixRounds, 1);
  assert.deepEqual(s.effective().disabledAgents, []);
  s.patch({ usageEnabled: true, teamEnabled: true });
  assert.equal(s.effective().taskBudgetUsd, 3);
  assert.deepEqual(s.effective().disabledAgents, ['keo']);
});
