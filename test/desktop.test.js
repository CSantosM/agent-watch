'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { DesktopNotifier } = require('../src/desktop');
const { delay } = require('./helpers');

// mode: 'ok' exits 0, 'missing' fails to spawn, 'hang' never exits.
function makeNotifier(platform, mode = 'ok') {
  const calls = [];
  const warnings = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.kill = () => calls.push(['kill', command]);
    calls.push([command, args]);
    setTimeout(() => {
      if (mode === 'ok') child.emit('exit', 0, null);
      if (mode === 'missing') child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    }, 2);
    return child;
  };
  const notifier = new DesktopNotifier({ icon: '/ext/media/icon.png', platform, spawn, timeoutMs: 30, log: { warn: (m) => warnings.push(m) } });
  return { notifier, calls, warnings };
}

test('on Linux, notify-send shows the title and the body, which cannot pass for options', () => {
  const { notifier, calls } = makeNotifier('linux');
  notifier.notify('-"feat/login" finished', 'Worked 3 min');
  assert.deepEqual(calls, [
    ['notify-send', ['--app-name=Agent Watch', '--icon=/ext/media/icon.png', '--', '-"feat/login" finished', 'Worked 3 min']],
  ]);
});

test('on macOS, quotes and backslashes cannot break out of the AppleScript strings', () => {
  const { notifier, calls } = makeNotifier('darwin');
  notifier.notify('"a" finished', 'C:\\x" & do shell script "rm');
  assert.deepEqual(calls, [
    ['osascript', ['-e', 'display notification "C:\\\\x\\" & do shell script \\"rm" with title "\\"a\\" finished"']],
  ]);
});

test('elsewhere, nothing runs', () => {
  const { notifier, calls } = makeNotifier('win32');
  notifier.notify('a', 'b');
  assert.deepEqual(calls, []);
});

test('a missing notify-send is reported once, with the package that has it', async () => {
  const { notifier, warnings } = makeNotifier('linux', 'missing');
  notifier.notify('a', 'b');
  notifier.notify('a', 'b');
  await delay(10);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ENOENT.*libnotify-bin/);
});

test('a notifier that never exits is stopped', async () => {
  const { notifier, calls } = makeNotifier('linux', 'hang');
  notifier.notify('a', 'b');
  await delay(50);
  assert.deepEqual(calls[1], ['kill', 'notify-send']);
});
