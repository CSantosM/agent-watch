'use strict';

// Sessions archived in the Claude Code extension. Archiving only adds the session's id to that
// extension's own VS Code state (the "hiddenSessionIds" key of its global state): the process keeps
// running and its record stays in <config>/sessions, so nothing Claude Code writes there tells an
// archived session apart. Extensions cannot read each other's state through the VS Code API, so it is
// read from the SQLite database where VS Code keeps it (state.vscdb, one per profile), with the SQLite
// module built into Node. Both the database and the key are internal to VS Code and Claude Code: any
// problem reading them means no session counts as archived, never a failed refresh.

const fs = require('fs');

const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
const ARCHIVED_KEY = 'hiddenSessionIds';

class ArchivedSessions {
  // dbPath: VS Code's state.vscdb for this profile, or undefined where it is not on this machine.
  constructor({ dbPath, log } = {}) {
    Object.assign(this, { dbPath, log });
    this.ids = new Set();
    this.mtime = undefined;
    this.problem = undefined;
  }

  // The ids of the sessions archived in Claude Code. The database is read again only when it changes.
  get() {
    if (!this.dbPath) return this.ids;
    let mtime;
    try {
      mtime = fs.statSync(this.dbPath).mtimeMs;
    } catch {
      return this.ids; // Not there: a remote window keeps this state on the client.
    }
    if (mtime === this.mtime) return this.ids;
    try {
      this.ids = readArchived(this.dbPath);
      this.mtime = mtime;
      this.report(undefined);
    } catch (err) {
      // VS Code may be writing it; the next refresh tries again. Until then the last list holds.
      this.report(`Could not read the sessions archived in Claude Code: ${err.message}`);
    }
    return this.ids;
  }

  // Each distinct problem is logged once.
  report(problem) {
    if (problem === this.problem) return;
    this.problem = problem;
    if (problem && this.log) this.log.warn(problem);
  }
}

function readArchived(dbPath) {
  // Not in the Node of older VS Code versions: there, archived sessions keep showing.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // The key is the extension's id as its manifest spells it ("Anthropic.claude-code").
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ? COLLATE NOCASE').get(CLAUDE_EXTENSION_ID);
    return archivedIn(row && row.value);
  } finally {
    db.close();
  }
}

// value: the JSON Claude Code's global state is stored as.
function archivedIn(value) {
  if (typeof value !== 'string') return new Set();
  const ids = JSON.parse(value)[ARCHIVED_KEY];
  return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
}

module.exports = { ArchivedSessions, archivedIn };
