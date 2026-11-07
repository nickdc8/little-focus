export const DEFAULTS = { focus: 25, short: 5, long: 15 };
export const LABELS = { focus: 'Focus', short: 'Short break', long: 'Long break' };
export const dayKey = now => new Date(now).toLocaleDateString('en-CA');
export function initialState(now = Date.now()) {
  return { mode: 'focus', status: 'ready', remainingMs: 25 * 60000, endsAt: null,
    settings: { ...DEFAULTS }, cycle: 0, today: 0, day: dayKey(now), notice: '' };
}
export function remaining(state, now = Date.now()) {
  return state.status === 'running' ? Math.max(0, state.endsAt - now) : state.remainingMs;
}
export function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function transition(previous, command = { type: 'get' }, now = Date.now()) {
  const state = structuredClone(previous || initialState(now));
  let completion = null;
  if (state.day !== dayKey(now)) { state.day = dayKey(now); state.today = 0; }
  if (state.status === 'running' && state.endsAt <= now) {
    const finished = state.mode;
    // Attribute completed sessions to the day on which their deadline fell.
    if (finished === 'focus') { state.cycle++; if (dayKey(state.endsAt) === state.day) state.today++; }
    state.mode = finished === 'focus' ? (state.cycle % 4 === 0 ? 'long' : 'short') : 'focus';
    state.status = 'ready'; state.endsAt = null;
    state.remainingMs = state.settings[state.mode] * 60000;
    state.notice = finished === 'focus' ? 'Focus complete. Time for a little breather.' : 'Break complete. Ready when you are.';
    completion = { title: finished === 'focus' ? 'Time for a break' : 'Ready for another focus?',
      message: finished === 'focus' ? `Nice work. Your ${state.settings[state.mode]}-minute ${LABELS[state.mode].toLowerCase()} is ready.` : 'Your break is over. Start your next focus when you’re ready.' };
  }
  switch (command.type) {
    case 'get': break;
    case 'start':
      if (state.status !== 'running') { state.endsAt = now + state.remainingMs; state.status = 'running'; state.notice = ''; }
      break;
    case 'pause':
      if (state.status === 'running') { state.remainingMs = remaining(state, now); state.endsAt = null; state.status = 'paused'; }
      break;
    case 'reset':
      state.status = 'ready'; state.endsAt = null; state.remainingMs = state.settings[state.mode] * 60000; state.notice = '';
      break;
    case 'mode':
      if (!Object.hasOwn(DEFAULTS, command.mode)) throw new Error('Choose a valid timer.');
      if (state.status !== 'ready') throw new Error('Reset the timer before changing modes.');
      state.mode = command.mode; state.remainingMs = state.settings[state.mode] * 60000; state.notice = '';
      break;
    case 'settings':
      if (state.status !== 'ready') throw new Error('Reset the timer before changing durations.');
      for (const mode of Object.keys(DEFAULTS)) {
        const value = command.settings?.[mode];
        if (!Number.isInteger(value) || value < 1 || value > 120) throw new Error('Use whole minutes between 1 and 120.');
      }
      state.settings = { focus: command.settings.focus, short: command.settings.short, long: command.settings.long };
      state.remainingMs = state.settings[state.mode] * 60000; state.notice = '';
      break;
    default: throw new Error('Unknown timer action.');
  }
  return { state, completion };
}
