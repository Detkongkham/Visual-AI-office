// Theme preference (system / light / dark) plus the look (font size, custom accent and background colours per mode).
// Loaded in <head> before style.css so the right colours apply on first paint; must not touch document.body.
(function () {
  const KEY = 'aiOffice.theme';
  const PREFS = ['system', 'light', 'dark'];
  let mql = null;
  try { mql = matchMedia('(prefers-color-scheme: dark)'); } catch { /* no matchMedia: treat as light */ }
  const valid = p => PREFS.includes(p) ? p : 'system';

  function getPref() {
    try { return valid(localStorage.getItem(KEY)); } catch { return 'system'; }
  }
  let cur = getPref(); // in-memory pref, so the UI stays correct when storage is unavailable
  const resolve = (pref, systemDark) => pref === 'dark' || (pref !== 'light' && !!systemDark) ? 'dark' : 'light';
  const next = pref => PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length];
  // ---- look: { fontScale, light: { accent, bg }, dark: { accent, bg } }; a colour of null means the built-in one ----
  const LOOK_KEY = 'aiOffice.look', FONT_MIN = 0.8, FONT_MAX = 1.5;
  const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
  const colors = m => ({ accent: hex(m && m.accent), bg: hex(m && m.bg) });
  function validLook(o) {
    o = o && typeof o === 'object' ? o : {};
    const n = Number(o.fontScale), fontScale = Number.isFinite(n) ? Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, n)) * 100) / 100 : 1;
    return { fontScale, light: colors(o.light), dark: colors(o.dark) };
  }
  let look = (() => { try { return validLook(JSON.parse(localStorage.getItem(LOOK_KEY))); } catch { return validLook(); } })();
  const toRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(Number(v) || 0))).toString(16).padStart(2, '0')).join('');
  // text on an accent-coloured button: dark on light colours, white on dark ones (WCAG relative luminance)
  const inkOn = c => { const [r, g, b] = toRgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#160f2e' : '#ffffff'; };
  function paintLook() {
    const el = document.documentElement, st = el.style, c = look[el.dataset.theme === 'dark' ? 'dark' : 'light'];
    if (!st || !st.setProperty) return;
    st.setProperty('--fs', String(look.fontScale));
    if (c.accent) { st.setProperty('--accent', c.accent); st.setProperty('--accent-fg', inkOn(c.accent)); el.dataset.customAccent = ''; }
    else { st.removeProperty('--accent'); st.removeProperty('--accent-fg'); delete el.dataset.customAccent; }
    if (c.bg) st.setProperty('--bg', c.bg); else st.removeProperty('--bg');
  }
  /** merge changes into the look; colours go to the mode on screen unless `mode` is given */
  function setLook(changes, mode) {
    const m = mode === 'dark' || mode === 'light' ? mode : (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const next = { ...look, [m]: { ...look[m] } };
    if (changes && 'fontScale' in changes) next.fontScale = changes.fontScale;
    for (const k of ['accent', 'bg']) if (changes && k in changes) next[m][k] = changes[k];
    look = validLook(next);
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* storage unavailable: still apply */ }
    paintLook();
    return look;
  }
  const getLook = () => validLook(look);

  function apply(pref) {
    cur = valid(pref);
    const el = document.documentElement;
    el.dataset.theme = resolve(cur, mql && mql.matches);
    el.dataset.themePref = cur;
    paintLook();
  }
  function setPref(pref) {
    pref = valid(pref);
    try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable: still apply */ }
    apply(pref);
  }
  const current = () => cur;

  window.THEME = { KEY, PREFS, getPref, current, resolve, next, apply, setPref, LOOK_KEY, FONT_MIN, FONT_MAX, getLook, setLook, validLook, toRgb, toHex };
  apply(cur);
  try { if (mql && mql.addEventListener) mql.addEventListener('change', () => { if (cur === 'system') apply('system'); }); } catch { /* ignore */ }
})();
