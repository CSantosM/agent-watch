'use strict';

// The Claude Code provider: where Claude Code keeps its sessions, what each one is doing, and how to
// open one in the Claude Code extension.

const os = require('os');
const path = require('path');
const { readSessionRecords, normalize } = require('./records');
const { TranscriptIndex, describeTool, resolveTitle } = require('./transcript');
const { ArchivedSessions } = require('./archive');

const ID = 'claude-code';

// opener: a ClaudeCodeOpener (./open), or undefined where sessions cannot be opened.
// stateDb: VS Code's state database, where the Claude Code extension keeps its archived sessions (./archive).
function createClaudeCodeProvider({ configDir, opener, stateDb, log } = {}) {
  const dir = configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const sessionsDir = path.join(dir, 'sessions');
  const transcripts = new TranscriptIndex(path.join(dir, 'projects'));
  const archived = new ArchivedSessions({ dbPath: stateDb, log });

  return {
    id: ID,
    label: 'Claude Code',
    watchDirs: [sessionsDir],

    async listSessions() {
      const records = await readSessionRecords(sessionsDir);
      const ids = archived.get();
      return records.map((record) => ({ ...normalize(record, ID), archived: ids.has(record.sessionId) }));
    },

    // { title, action, files, branch, resumable } from the session's transcript.
    async describe(session) {
      const summary = await transcripts.get(session.raw);
      return {
        title: resolveTitle(session.raw, summary),
        // A chat without messages has no transcript to restore: asked to open one, Claude Code starts
        // a new empty chat instead.
        resumable: summary.messages > 0,
        action: summary.lastTool ? describeTool(summary.lastTool) : undefined,
        files: [...summary.files].reverse().map(([file, at]) => ({ path: file, at })),
        // Transcripts say "HEAD" outside a repository.
        branch: summary.gitBranch && summary.gitBranch !== 'HEAD' ? summary.gitBranch : undefined,
      };
    },

    prune(liveIds) {
      transcripts.prune(liveIds);
    },

    canOpen(session) {
      return session.surface === 'editor' && !!opener && opener.available();
    },

    unavailableReason() {
      return 'The Claude Code extension is not installed or is disabled.';
    },

    open(session) {
      return opener.open(session.id);
    },
  };
}

module.exports = { createClaudeCodeProvider, ID };
