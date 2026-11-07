import { initialState, transition, remaining, LABELS } from './timer.js';
const END = 'little-focus-end', TICK = 'little-focus-badge';
let queue = Promise.resolve();

async function display(state) {
  const ms = remaining(state);
  const text = state.status === 'running' ? (ms <= 60000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60000)}m`)
    : state.status === 'paused' ? 'Ⅱ' : state.notice ? '✓' : '';
  await chrome.action.setBadgeBackgroundColor({ color: state.mode === 'focus' ? '#276747' : '#526c82' });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: `Little Focus · ${LABELS[state.mode]}${state.status === 'paused' ? ' (paused)' : ''}` });
}

async function schedule(state) {
  if (state.status === 'running') {
    const alarm = await chrome.alarms.get(END);
    if (!alarm || alarm.scheduledTime !== state.endsAt) await chrome.alarms.create(END, { when: state.endsAt });
    if (!await chrome.alarms.get(TICK)) await chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(END); await chrome.alarms.clear(TICK);
  }
}

async function execute(command) {
  const saved = (await chrome.storage.local.get('timer')).timer;
  const now = Date.now();
  // Persist a reconciled completion before applying a user command. Invalid commands
  // cannot cause an already completed session to be counted again on the next wake.
  const reconciled = transition(saved || initialState(now), { type: 'get' }, now);
  if (JSON.stringify(saved) !== JSON.stringify(reconciled.state)) await chrome.storage.local.set({ timer: reconciled.state });
  if (reconciled.completion) {
    try {
      await chrome.notifications.create('little-focus-complete', {
        type: 'basic', iconUrl: 'icons/icon-128.png', title: reconciled.completion.title,
        message: reconciled.completion.message, priority: 1
      });
    } catch (error) { console.warn('Notification unavailable:', error.message); }
  }
  const { state } = transition(reconciled.state, command, now);
  if (JSON.stringify(state) !== JSON.stringify(reconciled.state)) await chrome.storage.local.set({ timer: state });
  await schedule(state); await display(state);
  return state;
}
function enqueue(command) {
  const job = queue.catch(() => {}).then(() => execute(command));
  queue = job;
  return job;
}
const recover = () => { void enqueue({ type: 'get' }).catch(error => console.warn('Timer recovery failed:', error.message)); };
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'little-focus') return;
  enqueue(message.command).then(state => respond({ ok: true, state }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === END || alarm.name === TICK) recover(); });
chrome.runtime.onStartup.addListener(recover);
chrome.runtime.onInstalled.addListener(recover);
