import test from 'node:test';
import assert from 'node:assert/strict';

test('worker persists deadlines, restores alarms, sends one notification, and serializes controls', async () => {
  const events = {}, alarms = new Map(), badge = {}, notifications = [];
  let data = {}, failWrites = false, failNotifications = false;
  const listen = name => ({ addListener(fn) { events[name] = fn; } });
  globalThis.chrome = {
    runtime: { id: 'test', onMessage: listen('message'), onStartup: listen('startup'), onInstalled: listen('installed') },
    storage: { local: {
      async get() { return structuredClone(data); },
      async set(values) { if (failWrites) throw new Error('Storage unavailable'); Object.assign(data, structuredClone(values)); }
    } },
    alarms: {
      onAlarm: listen('alarm'), async get(name) { return alarms.get(name); },
      async create(name, value) { alarms.set(name, { scheduledTime: value.when, ...value }); },
      async clear(name) { return alarms.delete(name); }
    },
    action: { async setBadgeText(value) { badge.text = value.text; }, async setBadgeBackgroundColor() {}, async setTitle() {} },
    notifications: { async create(id, value) { if (failNotifications) throw new Error('Notifications disabled'); notifications.push({ id, ...value }); } }
  };
  await import('../background.js');
  const send = command => new Promise(resolve => assert.equal(events.message({ target: 'little-focus', command }, { id: 'test' }, resolve), true));
  assert.equal(events.message({ target: 'little-focus', command: { type: 'start' } }, { id: 'other' }, () => assert.fail()), undefined);
  await send({ type: 'start' });
  const deadline = data.timer.endsAt;
  assert.equal(alarms.get('little-focus-end').when, deadline);
  assert.equal(alarms.get('little-focus-badge').periodInMinutes, 0.5);
  assert.equal(badge.text, '25m');
  alarms.clear(); events.startup(); await send({ type: 'get' });
  assert.equal(alarms.get('little-focus-end').when, deadline);
  const actions = await Promise.all([send({ type: 'pause' }), send({ type: 'start' }), send({ type: 'pause' })]);
  assert.deepEqual(actions.map(result => result.state.status), ['paused', 'running', 'paused']);
  assert.equal(alarms.size, 0); assert.equal(badge.text, 'Ⅱ');
  await send({ type: 'start' });
  data.timer.endsAt = Date.now() - 1;
  events.alarm({ name: 'little-focus-end' }); await send({ type: 'get' });
  assert.equal(data.timer.today, 1); assert.equal(data.timer.mode, 'short');
  assert.equal(data.timer.status, 'ready'); assert.equal(notifications.length, 1);
  events.alarm({ name: 'little-focus-end' }); await send({ type: 'get' });
  assert.equal(notifications.length, 1); assert.equal(data.timer.today, 1);
  failWrites = true;
  assert.equal((await send({ type: 'start' })).ok, false);
  assert.equal(data.timer.status, 'ready');
  failWrites = false;
  assert.equal((await send({ type: 'start' })).ok, true);
  failNotifications = true; data.timer.endsAt = Date.now() - 1;
  const finished = await send({ type: 'get' });
  assert.equal(finished.ok, true); assert.equal(finished.state.mode, 'focus');
  assert.equal(finished.state.status, 'ready');
  delete globalThis.chrome;
});
