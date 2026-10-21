import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(here, '..', 'web', 'theme.js');

function load({ stored, look, matches = false, throwing = false, noMatchMedia = false } = {}) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const store = new Map();
  if (stored !== undefined) store.set('aiOffice.theme', stored);
  if (look !== undefined) store.set('aiOffice.look', typeof look === 'string' ? look : JSON.stringify(look));

  const localStorage = throwing
    ? {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); },
      }
    : {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
      };

  const listeners = [];
  const mql = {
    matches,
    addEventListener(type, fn) { if (type === 'change') listeners.push(fn); },
  };
  const props = new Map();
  const style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) };
  const documentElement = { dataset: {}, style };
  const sandbox = {
    document: { documentElement },
    localStorage,
    matchMedia: noMatchMedia ? undefined : () => mql,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);

  return {
    THEME: sandbox.window.THEME,
    dataset: documentElement.dataset,
    props,
    store,
    fireChange(newMatches) {
      mql.matches = newMatches;
      for (const fn of listeners) fn({ matches: newMatches, type: 'change' });
    },
  };
}

test('defaults to system and resolves from OS', () => {
  const { dataset } = load({ matches: true });
  assert.equal(dataset.theme, 'dark');
  assert.equal(dataset.themePref, 'system');
});

test('stored light wins over dark OS', () => {
  const { dataset } = load({ stored: 'light', matches: true });
  assert.equal(dataset.theme, 'light');
});

test('stored dark wins over light OS', () => {
  const { dataset } = load({ stored: 'dark', matches: false });
  assert.equal(dataset.theme, 'dark');
});

test('invalid stored value falls back to system', () => {
  const { THEME } = load({ stored: 'blue' });
  assert.equal(THEME.getPref(), 'system');
});

test('throwing localStorage does not crash', () => {
  const { THEME, dataset } = load({ throwing: true });
  assert.equal(THEME.getPref(), 'system');
  assert.doesNotThrow(() => THEME.setPref('dark'));
  assert.equal(dataset.theme, 'dark');
});

test('next cycles', () => {
  const { THEME } = load();
  assert.equal(THEME.next('system'), 'light');
  assert.equal(THEME.next('light'), 'dark');
  assert.equal(THEME.next('dark'), 'system');
});

test('setPref persists', () => {
  const { THEME, store } = load();
  THEME.setPref('dark');
  assert.equal(store.get('aiOffice.theme'), 'dark');
});

test('system follows live OS change', () => {
  const a = load({ matches: false });
  assert.equal(a.dataset.theme, 'light');
  a.fireChange(true);
  assert.equal(a.dataset.theme, 'dark');

  const b = load({ stored: 'light', matches: false });
  b.fireChange(true);
  assert.equal(b.dataset.theme, 'light');
});

test('KEY and PREFS are fixed', () => {
  const { THEME } = load();
  assert.equal(THEME.KEY, 'aiOffice.theme');
  assert.deepEqual([...THEME.PREFS], ['system', 'light', 'dark']);
});

test('missing matchMedia does not throw and resolves light', () => {
  const { THEME, dataset } = load({ noMatchMedia: true });
  assert.ok(THEME);
  assert.equal(dataset.theme, 'light');
});

test('throwing localStorage keeps current pref in memory', () => {
  const { THEME } = load({ throwing: true });
  THEME.setPref('dark');
  assert.equal(THEME.current(), 'dark');
  assert.equal(THEME.next(THEME.current()), 'system');
});

test('invalid pref is coerced to system and not stored', () => {
  const { THEME, store, dataset } = load({ matches: true });
  THEME.setPref('blue');
  assert.equal(store.has('aiOffice.theme') && store.get('aiOffice.theme') !== 'system', false);
  assert.equal(dataset.themePref, 'system');
  assert.equal(THEME.current(), 'system');
});

test('look defaults: normal font size, built-in colours', () => {
  const { THEME, props, dataset } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(THEME.getLook())), { fontScale: 1, light: { accent: null, bg: null }, dark: { accent: null, bg: null } });
  assert.equal(props.get('--fs'), '1');
  assert.equal(props.has('--accent'), false);
  assert.equal('customAccent' in dataset, false);
});

test('font scale is clamped and stored', () => {
  const { THEME, props, store } = load();
  THEME.setLook({ fontScale: 9 });
  assert.equal(THEME.getLook().fontScale, THEME.FONT_MAX);
  assert.equal(props.get('--fs'), String(THEME.FONT_MAX));
  THEME.setLook({ fontScale: 'abc' });
  assert.equal(THEME.getLook().fontScale, 1);
  THEME.setLook({ fontScale: 1.25 });
  assert.equal(JSON.parse(store.get('aiOffice.look')).fontScale, 1.25);
});

test('colours are kept per mode and follow the mode on screen', () => {
  const a = load({ stored: 'light' });
  a.THEME.setLook({ accent: '#FF0000', bg: '#ffffff' });
  assert.equal(a.props.get('--accent'), '#ff0000');
  assert.equal(a.props.get('--accent-fg'), '#ffffff');
  assert.equal(a.props.get('--bg'), '#ffffff');
  assert.equal(a.dataset.customAccent, '');
  a.THEME.setPref('dark');
  assert.equal(a.props.has('--accent'), false);
  assert.equal(a.props.has('--bg'), false);
  a.THEME.setLook({ accent: '#ffee00' });
  assert.equal(a.props.get('--accent-fg'), '#160f2e');
  a.THEME.setPref('light');
  assert.equal(a.props.get('--accent'), '#ff0000');
  a.THEME.setLook({ accent: null });
  assert.equal(a.props.has('--accent'), false);
  assert.equal(a.THEME.getLook().dark.accent, '#ffee00');
});

test('bad saved look and bad colours fall back to built-in', () => {
  assert.equal(load({ look: '{not json' }).THEME.getLook().fontScale, 1);
  const { THEME } = load({ look: { fontScale: 1.1, light: { accent: 'red', bg: '#12345' } } });
  assert.deepEqual({ ...THEME.getLook().light }, { accent: null, bg: null });
  assert.equal(THEME.getLook().fontScale, 1.1);
});

test('rgb helpers round-trip', () => {
  const { THEME } = load();
  assert.deepEqual([...THEME.toRgb('#6a4fd8')], [106, 79, 216]);
  assert.equal(THEME.toHex([106, 79, 216]), '#6a4fd8');
  assert.equal(THEME.toHex([300, -5, 'x']), '#ff0000');
});

test('throwing localStorage still applies the look', () => {
  const { THEME, props } = load({ throwing: true });
  assert.doesNotThrow(() => THEME.setLook({ fontScale: 1.2 }));
  assert.equal(props.get('--fs'), '1.2');
});
