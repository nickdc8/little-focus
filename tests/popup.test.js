import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { initialState, transition, remaining, formatTime, LABELS } from '../timer.js';

function setup() {
  let now = Date.now(), saved = initialState(now), fail = false, tick, changed;
  class Element {
    constructor() {
      Object.assign(this, { textContent: '', value: '', disabled: false, hidden: false, dataset: {}, children: [], attributes: {}, listeners: {} });
      const classes = new Set();
      this.classList = { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const ids = ['expand', 'clock', 'phase', 'hint', 'toggle', 'reset', 'dots', 'cycle', 'today', 'save-settings', 'focus-minutes', 'short-minutes', 'long-minutes', 'status', 'retry', 'settings-toggle', 'settings', 'settings-form'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  elements.settings.hidden = true; elements.dots.children = Array.from({ length: 4 }, () => new Element());
  const modes = ['focus', 'short', 'long'].map(mode => { const el = new Element(); el.dataset.mode = mode; return el; });
  const document = { body: new Element(), title: '', getElementById: id => elements[id], querySelectorAll: () => modes };
  const chrome = {
    runtime: { id: 'test', async sendMessage({ command }) {
      if (fail) return { ok: false, error: 'Could not save the timer' };
      try { saved = transition(saved, command, now).state; return { ok: true, state: structuredClone(saved) }; }
      catch (error) { return { ok: false, error: error.message }; }
    } },
    storage: { onChanged: { addListener(fn) { changed = fn; } } }
  };
  const context = vm.createContext({ document, chrome, location: { search: '' }, URLSearchParams,
    initialState, transition, remaining: state => remaining(state, now), formatTime, LABELS,
    setInterval(fn) { tick = fn; }
  });
  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8').replace(/^import .*?;\n/, '');
  vm.runInContext(source, context);
  return { elements, modes, advance(ms) { now += ms; tick(); }, get state() { return saved; }, fail(value) { fail = value; }, external(state) { saved = state; changed({ timer: { newValue: structuredClone(saved) } }, 'local'); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('popup starts, ticks by elapsed time, pauses, resumes, and resets', async () => {
  const h = setup(); await settle(); const e = h.elements;
  assert.equal(e.clock.textContent, '25:00'); assert.equal(e.toggle.textContent, 'Start focus');
  e.toggle.listeners.click(); await settle();
  assert.equal(e.toggle.textContent, 'Pause'); assert.ok(h.modes.every(mode => mode.disabled));
  h.advance(12345); assert.equal(e.clock.textContent, '24:48');
  e.toggle.listeners.click(); await settle(); assert.equal(e.toggle.textContent, 'Resume');
  h.advance(60000); assert.equal(e.clock.textContent, '24:48');
  e.toggle.listeners.click(); await settle(); h.advance(1000); assert.equal(e.clock.textContent, '24:47');
  e.reset.listeners.click(); await settle(); assert.equal(e.clock.textContent, '25:00');
  assert.equal(h.state.today, 0); assert.ok(h.modes.every(mode => !mode.disabled));
});
test('expired timer shows the ready break and completion count', async () => {
  const h = setup(); await settle(); h.elements.toggle.listeners.click(); await settle();
  h.advance(25 * 60000 + 1000); await settle();
  assert.equal(h.elements.clock.textContent, '05:00');
  assert.equal(h.elements.toggle.textContent, 'Start break');
  assert.equal(h.elements.today.textContent, '1 focus session today');
  assert.match(h.elements.hint.textContent, /Focus complete/);
});
test('settings update idle durations and remain locked while a timer runs', async () => {
  const h = setup(); await settle(); const e = h.elements;
  e['focus-minutes'].value = '45'; e['short-minutes'].value = '7'; e['long-minutes'].value = '20';
  await e['settings-form'].listeners.submit({ preventDefault() {} });
  assert.equal(e.clock.textContent, '45:00');
  h.modes[1].listeners.click(); await settle(); assert.equal(e.clock.textContent, '07:00');
  e.toggle.listeners.click(); await settle();
  assert.equal(e['save-settings'].disabled, true); assert.equal(e['focus-minutes'].disabled, true);
});
test('failed controls show an error and leave saved time available for retry', async () => {
  const h = setup(); await settle(); h.fail(true);
  h.elements.toggle.listeners.click(); await settle();
  assert.match(h.elements.status.textContent, /Could not save/);
  assert.equal(h.elements.toggle.disabled, false); assert.equal(h.state.status, 'ready');
  h.fail(false); h.elements.toggle.listeners.click(); await settle();
  assert.equal(h.state.status, 'running'); assert.equal(h.elements.status.textContent, '');
});
test('another extension view updates the visible timer without losing settings drafts', async () => {
  const h = setup(); await settle(); h.elements['focus-minutes'].value = '55';
  h.external({ ...h.state, mode: 'short', remainingMs: 5 * 60000 });
  assert.equal(h.elements.clock.textContent, '05:00');
  assert.equal(h.elements['focus-minutes'].value, '55');
});
