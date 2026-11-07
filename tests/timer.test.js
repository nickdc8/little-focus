import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, remaining, formatTime } from '../timer.js';
const NOW = new Date(2026, 10, 7, 12).getTime();
const run = (state, command, now = NOW) => transition(state, command, now).state;

test('starts a 25-minute focus with an absolute deadline', () => {
  const state = run(initialState(NOW), { type: 'start' });
  assert.equal(state.endsAt, NOW + 25 * 60000);
  assert.equal(remaining(state, NOW + 1000), 1499000);
  assert.equal(state.status, 'running');
});
test('pause and resume preserve the remaining time without counting paused time', () => {
  const started = run(initialState(NOW), { type: 'start' });
  const paused = run(started, { type: 'pause' }, NOW + 10000);
  assert.equal(paused.remainingMs, 1490000);
  assert.equal(paused.endsAt, null);
  assert.equal(remaining(paused, NOW + 500000), 1490000);
  const resumed = run(paused, { type: 'start' }, NOW + 500000);
  assert.equal(resumed.endsAt, NOW + 500000 + 1490000);
});
test('a late wake completes a focus once and leaves its break ready', () => {
  const started = run(initialState(NOW), { type: 'start' });
  const { state, completion } = transition(started, { type: 'get' }, NOW + 40 * 60000);
  assert.equal(state.today, 1); assert.equal(state.cycle, 1);
  assert.equal(state.mode, 'short'); assert.equal(state.status, 'ready');
  assert.equal(state.remainingMs, 5 * 60000);
  assert.match(completion.title, /break/);
  const again = transition(state, { type: 'get' }, NOW + 60 * 60000);
  assert.equal(again.state.today, 1); assert.equal(again.completion, null);
});
test('every fourth completed focus offers a long break', () => {
  let state = initialState(NOW);
  for (let i = 1; i <= 4; i++) {
    state = run(state, { type: 'mode', mode: 'focus' });
    state = run(state, { type: 'start' });
    state = run(state, { type: 'get' }, state.endsAt);
    assert.equal(state.mode, i === 4 ? 'long' : 'short');
  }
  assert.equal(state.today, 4); assert.equal(state.remainingMs, 15 * 60000);
});
test('a completed break returns to focus without adding a completed focus', () => {
  let state = run(initialState(NOW), { type: 'mode', mode: 'short' });
  state = run(state, { type: 'start' });
  const result = transition(state, { type: 'get' }, state.endsAt);
  assert.equal(result.state.mode, 'focus'); assert.equal(result.state.today, 0);
  assert.equal(result.state.status, 'ready'); assert.match(result.completion.title, /another focus/);
});
test('resetting early gives no session credit and restores full duration', () => {
  const started = run(initialState(NOW), { type: 'start' });
  const state = run(started, { type: 'reset' }, NOW + 60000);
  assert.equal(state.status, 'ready'); assert.equal(state.remainingMs, 25 * 60000);
  assert.equal(state.today, 0); assert.equal(state.endsAt, null);
});
test('duration settings apply only to an idle timer and validate all values', () => {
  const settings = { focus: 50, short: 10, long: 30 };
  const state = run(initialState(NOW), { type: 'settings', settings });
  assert.equal(state.remainingMs, 50 * 60000);
  assert.equal(run(state, { type: 'mode', mode: 'short' }).remainingMs, 10 * 60000);
  const running = run(state, { type: 'start' });
  assert.throws(() => run(running, { type: 'settings', settings }), /Reset/);
  assert.throws(() => run(running, { type: 'mode', mode: 'long' }), /Reset/);
  for (const value of [0, -1, 121, 1.5, NaN, '25']) assert.throws(() => run(state, { type: 'settings', settings: { ...settings, focus: value } }), /whole minutes/);
});
test('start is idempotent while running and does not extend a deadline', () => {
  const state = run(initialState(NOW), { type: 'start' });
  assert.equal(run(state, { type: 'start' }, NOW + 60000).endsAt, state.endsAt);
});
test('a pause arriving after completion cannot pause the next ready break', () => {
  const state = run(initialState(NOW), { type: 'start' });
  const result = transition(state, { type: 'pause' }, state.endsAt);
  assert.equal(result.state.status, 'ready'); assert.equal(result.state.mode, 'short');
  assert.equal(result.state.today, 1);
});
test('daily counts reset at midnight while the four-session cycle continues', () => {
  const state = { ...initialState(NOW), today: 3, cycle: 3 };
  const tomorrow = new Date(2026, 10, 8, 1).getTime();
  const next = run(state, { type: 'get' }, tomorrow);
  assert.equal(next.today, 0); assert.equal(next.cycle, 3);
});
test('waking tomorrow does not assign yesterday’s completion to today', () => {
  const started = run(initialState(NOW), { type: 'start' });
  const next = run(started, { type: 'get' }, NOW + 24 * 60 * 60000);
  assert.equal(next.today, 0); assert.equal(next.cycle, 1); assert.equal(next.mode, 'short');
});
test('formats the countdown without a negative time or losing its last second', () => {
  assert.equal(formatTime(25 * 60000), '25:00');
  assert.equal(formatTime(59999), '01:00');
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(-100), '00:00');
});
