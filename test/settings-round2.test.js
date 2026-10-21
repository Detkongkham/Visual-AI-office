import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from '../server/settings.js';
import { summaryLine } from '../server/runner.js';
import { createStore } from '../server/store.js';
import { searchFolders, listFolder } from '../server/projects.js';

test('select with its own options accepts only those values', () => {
  assert.equal(clean('editor', 'vscode'), 'vscode');
  assert.throws(() => clean('editor', 'notepad'));
  assert.equal(clean('reportLanguage', 'th'), 'th');
  assert.throws(() => clean('reportLength', 'huge'));
});

test('path: empty means "last used", otherwise an existing folder', () => {
  assert.equal(clean('defaultProject', ''), '');
  assert.equal(clean('defaultProject', os.tmpdir()), path.resolve(os.tmpdir()));
  assert.throws(() => clean('defaultProject', '/no/such/folder/here'));
  assert.equal(clean('defaultProject', '~'), os.homedir());
});

test('summaryLine follows language and length', () => {
  assert.match(summaryLine({}), /short summary .* Lao language/);
  assert.match(summaryLine({ reportLanguage: 'en', reportLength: 'detailed' }, true), /detailed summary in the English language.*who did what/);
});

test('store keeps at most maxTasks and prune removes finished ones', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-store-')), 'state.json');
  let max = 3;
  const store = createStore(file, { maxTasks: () => max });
  for (let i = 0; i < 5; i++) store.addTask({ id: 't' + i, status: i === 4 ? 'running' : 'done' });
  assert.equal(store.tasks.length, 3);
  assert.equal(store.prune(t => t.status === 'running'), 2);
  assert.deepEqual(store.tasks.map(t => t.id), ['t4']);
});

test('folder search honours the skip list', async () => {
  const home = os.homedir(), dir = fs.mkdtempSync(path.join(home, '.office-skip-test-'));
  try {
    // hidden roots are skipped by the search itself, so list the folder directly
    fs.mkdirSync(path.join(dir, 'keepme')); fs.mkdirSync(path.join(dir, 'skipme'));
    const names = skip => listFolder(dir, { skip }).then(r => r.folders.map(f => f.name).sort());
    assert.deepEqual(await names([]), ['keepme', 'skipme']);
    assert.deepEqual(await names(['skipme']), ['keepme']);
    assert.deepEqual(await searchFolders(''), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
