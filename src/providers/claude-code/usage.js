'use strict';

// How much of the Claude plan's usage limits is spent: the 5-hour session limit and the weekly one,
// as Claude Code's /usage shows them. Whenever Claude Code fetches them, it caches the reading in its
// global config file (~/.claude.json, or .claude.json in CLAUDE_CONFIG_DIR) under
// "cachedUsageUtilization", so Agent Watch reads it there instead of asking for it online: no network
// calls and no credentials. The format is internal to Claude Code: anything unexpected means no usage
// is shown, never a failed refresh.

const fs = require('fs');
const { toMillis } = require('../../util');

const LIMITS = [
  { key: 'session', field: 'five_hour', label: '5-hour', short: '5h' },
  { key: 'weekly', field: 'seven_day', label: 'Weekly', short: '7d' },
];

class UsageCache {
  // file: Claude Code's global config file.
  constructor({ file } = {}) {
    this.file = file;
    this.usage = undefined;
    this.mtime = undefined;
  }

  // The last reading Claude Code cached, or undefined if there is none (signed in with an API key,
  // signed out, or no usage fetched yet). The file is read again only when it changes.
  async get() {
    let mtime;
    try {
      mtime = (await fs.promises.stat(this.file)).mtimeMs;
    } catch {
      this.usage = this.mtime = undefined;
      return undefined;
    }
    if (mtime === this.mtime) return this.usage;
    try {
      this.usage = usageIn(JSON.parse(await fs.promises.readFile(this.file, 'utf8')));
      this.mtime = mtime;
    } catch {
      // Caught mid-write; the next refresh reads it again. Until then the last reading holds.
    }
    return this.usage;
  }
}

// config: Claude Code's global config. Returns { fetchedAt, limits: [{ key, label, short, used, resetsAt }] }
// with used in percent, or undefined.
function usageIn(config) {
  const cached = config && config.cachedUsageUtilization;
  const utilization = cached && cached.utilization;
  if (!utilization || typeof utilization !== 'object') return undefined;
  const limits = [];
  for (const { field, ...limit } of LIMITS) {
    const reading = utilization[field];
    if (!reading || typeof reading.utilization !== 'number' || !Number.isFinite(reading.utilization)) continue;
    const resetsAt = Date.parse(reading.resets_at);
    limits.push({
      ...limit,
      used: Math.min(100, Math.max(0, reading.utilization)),
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined,
    });
  }
  return limits.length ? { fetchedAt: toMillis(cached.fetchedAtMs), limits } : undefined;
}

module.exports = { UsageCache, usageIn };
