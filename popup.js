import { initialState, transition, remaining, formatTime, LABELS } from './timer.js';
const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
const fullPage = !extension || new URLSearchParams(location.search).has('view');
document.body.classList.toggle('full-page', fullPage); $('expand').hidden = fullPage;
let state = null, busy = false, finishing = false;

async function request(command) {
  if (extension) {
    const result = await chrome.runtime.sendMessage({ target: 'little-focus', command });
    if (!result?.ok) throw new Error(result?.error || 'Chrome could not update the timer. Please try again.');
    return result.state;
  }
  const saved = JSON.parse(localStorage.getItem('little-focus-preview') || 'null');
  const result = transition(saved || initialState(), command);
  localStorage.setItem('little-focus-preview', JSON.stringify(result.state));
  return result.state;
}
function render() {
  if (!state) return;
  const running = state.status === 'running', paused = state.status === 'paused';
  $('clock').textContent = formatTime(remaining(state));
  document.title = `${$('clock').textContent} · ${LABELS[state.mode]} · Little Focus`;
  $('phase').textContent = paused ? `${LABELS[state.mode]} paused` : running ? (state.mode === 'focus' ? 'Time to focus' : 'Take a little breather') : `Ready for ${state.mode === 'focus' ? 'focus' : 'a ' + LABELS[state.mode].toLowerCase()}`;
  $('hint').textContent = state.notice || (paused ? 'Your time is right here when you’re ready.' : state.mode === 'focus' ? 'One thing at a time.' : 'Step away. Stretch. Come back fresh.');
  $('toggle').textContent = running ? 'Pause' : paused ? 'Resume' : `Start ${state.mode === 'focus' ? 'focus' : 'break'}`;
  $('toggle').disabled = busy;
  $('reset').disabled = busy || (state.status === 'ready' && !state.notice);
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    button.disabled = busy || state.status !== 'ready';
  });
  const count = state.cycle % 4 || (state.cycle > 0 && state.mode === 'long' ? 4 : 0);
  [...$('dots').children].forEach((dot, i) => dot.classList.toggle('complete', i < count));
  $('cycle').textContent = `${count} of 4 focus sessions · then a long break`;
  $('today').textContent = `${state.today} focus session${state.today === 1 ? '' : 's'} today${extension ? '' : ' · preview only'}`;
  const locked = busy || state.status !== 'ready';
  ['focus', 'short', 'long'].forEach(mode => { $(mode + '-minutes').disabled = locked; });
  $('save-settings').disabled = locked;
}
async function send(command, updateSettings = false) {
  if (busy) return;
  busy = true; $('status').textContent = ''; render();
  try {
    state = await request(command);
    $('retry').hidden = true;
    if (updateSettings) for (const mode of ['focus', 'short', 'long']) $(mode + '-minutes').value = state.settings[mode];
  } catch (error) { $('status').textContent = error.message; $('retry').hidden = false; }
  finally { busy = false; render(); }
}
$('toggle').addEventListener('click', () => { if (state) void send({ type: state.status === 'running' ? 'pause' : 'start' }); });
$('reset').addEventListener('click', () => { void send({ type: 'reset' }); });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { void send({ type: 'mode', mode: button.dataset.mode }); }));
$('settings-toggle').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').setAttribute('aria-expanded', String(!$('settings').hidden));
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  await send({ type: 'settings', settings: Object.fromEntries(['focus', 'short', 'long'].map(mode => [mode, Number($(mode + '-minutes').value)])) }, true);
});
$('expand').addEventListener('click', () => { void chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') }); });
$('retry').addEventListener('click', () => { void send({ type: 'get' }, true); });
if (extension) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.timer?.newValue) { state = changes.timer.newValue; render(); }
});
else window.addEventListener('storage', event => { if (event.key === 'little-focus-preview') void send({ type: 'get' }); });
setInterval(() => {
  render();
  if (!busy && !finishing && state?.status === 'running' && remaining(state) <= 0) {
    finishing = true; void send({ type: 'get' }).finally(() => { finishing = false; });
  }
}, 250);
void send({ type: 'get' }, true);
