'use strict';

// How much of the Claude plan's usage limits is spent, as Claude Code's /usage lists them: the 5-hour
// session limit, the weekly one for all models and the weekly ones for a single model. Whenever Claude
// Code fetches them, it caches the reading in its global config file (~/.claude.json, or .claude.json
// in CLAUDE_CONFIG_DIR) under "cachedUsageUtilization", so Agent Watch reads it there instead of
// asking for it online: no network calls and no credentials. The format is internal to Claude Code:
// anything unexpected means no usage is shown, never a failed refresh.

const fs = require('fs');
const { toMillis } = require('../../util');

// The limits with a ring in the status bar, besides the hover (see providers/index.js).
const SESSION = { key: 'session', label: '5-hour limit' };
const WEEKLY = { key: 'weekly', label: 'Weekly limit' };
const KINDS = { session: SESSION, weekly_all: WEEKLY };
// Readings without a "limits" list have one field per limit.
const FIELDS = [
  { field: 'five_hour', ...SESSION },
  { field: 'seven_day', ...WEEKLY },
  { field: 'seven_day_opus', ...scoped('Opus') },
  { field: 'seven_day_sonnet', ...scoped('Sonnet') },
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

// config: Claude Code's global config. Returns { fetchedAt, limits: [{ key, label, used, resetsAt? }] }
// with used in percent, in the order /usage lists them, or undefined.
function usageIn(config) {
  const cached = config && config.cachedUsageUtilization;
  const utilization = cached && cached.utilization;
  if (!utilization || typeof utilization !== 'object') return undefined;
  let limits = Array.isArray(utilization.limits) ? fromList(utilization.limits) : [];
  if (!limits.length) limits = fromFields(utilization);
  return limits.length ? { fetchedAt: toMillis(cached.fetchedAtMs), limits } : undefined;
}

// [{ kind, percent, resets_at, scope }]: "session", "weekly_all", and "weekly_scoped" for one model.
// Kinds it does not know are left out.
function fromList(entries) {
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const scope = entry.kind === 'weekly_scoped' && scopeName(entry.scope);
    const limit = KINDS[entry.kind] || (scope && scoped(scope));
    return limit ? reading(limit, entry.percent, entry.resets_at) : [];
  });
}

function fromFields(utilization) {
  return FIELDS.flatMap(({ field, ...limit }) => {
    const entry = utilization[field];
    return entry ? reading(limit, entry.utilization, entry.resets_at) : [];
  });
}

function reading(limit, used, resetsAt) {
  if (typeof used !== 'number' || !Number.isFinite(used)) return [];
  const at = Date.parse(resetsAt);
  return [{ ...limit, used: Math.min(100, Math.max(0, used)), resetsAt: Number.isFinite(at) ? at : undefined }];
}

function scoped(name) {
  return { key: `weekly:${name}`, label: `Weekly limit, ${name}` };
}

// The model (or surface) a weekly limit applies to, as Claude Code names it.
function scopeName(scope) {
  const named = scope && typeof scope === 'object' && (scope.model || scope.surface);
  const name = named && named.display_name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

module.exports = { UsageCache, usageIn };
