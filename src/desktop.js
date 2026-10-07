'use strict';

// System notifications, for when VS Code is minimized or behind another window and neither the chip
// nor VS Code's own notifications can be seen. VS Code has no API for them, so the system's own tool
// shows them. Only Linux and macOS have one that needs no setup.

const childProcess = require('child_process');

// AppleScript string literal: arguments are passed without a shell, so only quotes and backslashes matter.
const appleString = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;

const NOTIFIERS = {
  linux: (title, body, icon) => ['notify-send', ['--app-name=Agent Watch', ...(icon ? [`--icon=${icon}`] : []), '--', title, body]],
  darwin: (title, body) => ['osascript', ['-e', `display notification ${appleString(body)} with title ${appleString(title)}`]],
};
const TIMEOUT_MS = 5000;

class DesktopNotifier {
  constructor({ icon, log, platform = process.platform, spawn = childProcess.spawn, timeoutMs = TIMEOUT_MS }) {
    Object.assign(this, { icon, log, spawn, timeoutMs });
    this.notifier = NOTIFIERS[platform];
    this.problem = undefined;
  }

  notify(title, body) {
    if (!this.notifier) return;
    const [command, args] = this.notifier(title, body, this.icon);
    let child;
    try {
      child = this.spawn(command, args, { stdio: 'ignore' });
    } catch (err) {
      this.report(`${command} could not show a notification: ${err.message}`);
      return;
    }
    // A notification daemon that does not answer would leave one stuck process per notification.
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, this.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      const hint = err.code === 'ENOENT' && command === 'notify-send' ? ' Install it with the libnotify-bin package.' : '';
      this.report(`${command} could not show a notification: ${err.code || err.message}.${hint}`);
    });
    child.on('exit', () => clearTimeout(timer));
  }

  // Each distinct problem is logged once.
  report(problem) {
    if (problem === this.problem) return;
    this.problem = problem;
    if (this.log) this.log.warn(problem);
  }
}

module.exports = { DesktopNotifier, NOTIFIERS };
