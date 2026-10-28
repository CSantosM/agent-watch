'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createClaudeDir, archiveInClaudeCode, cacheUsage } = require('./helpers');
const { readSessionRecords, normalize } = require('../src/providers/claude-code/records');
const { archivedIn } = require('../src/providers/claude-code/archive');
const { usageIn } = require('../src/providers/claude-code/usage');
const { createClaudeCodeProvider } = require('../src/providers/claude-code');

test('readSessionRecords keeps valid records and skips broken ones', async () => {
  const dir = createClaudeDir();
  const sessions = path.join(dir, 'sessions');
  fs.writeFileSync(path.join(sessions, '100.json'), JSON.stringify({ pid: 100, sessionId: 'a', cwd: '/x' }));
  fs.writeFileSync(path.join(sessions, '101.json'), '{"pid":101,"sessionId":"b"'); // mid-write
  fs.writeFileSync(path.join(sessions, '102.json'), JSON.stringify({ pid: 102, sessionId: 'c', cwd: '/x', spare: true }));
  fs.writeFileSync(path.join(sessions, '103.json'), JSON.stringify({ pid: '103', sessionId: 'd', cwd: '/x' }));
  fs.writeFileSync(path.join(sessions, '104.key'), 'secret');
  const records = await readSessionRecords(sessions);
  assert.deepEqual(records.map((r) => r.sessionId), ['a']);
  assert.deepEqual(await readSessionRecords(path.join(dir, 'missing')), []);
});

test('normalize maps Claude Code records to the provider-neutral shape', () => {
  const session = normalize(
    { pid: 7, sessionId: 's', cwd: '/x', status: 'waiting', waitingFor: 'Bash', entrypoint: 'claude-vscode', startedAt: 1790768543 },
    'claude-code',
  );
  assert.equal(session.provider, 'claude-code');
  assert.equal(session.id, 's');
  assert.equal(session.surface, 'editor');
  assert.equal(session.startedAt, 1790768543000, 'seconds become milliseconds');
  assert.equal(normalize({ pid: 7, sessionId: 's', cwd: '/x', entrypoint: 'cli' }, 'claude-code').surface, 'cli');
  assert.equal(normalize({ pid: 7, sessionId: 's', cwd: '/x', entrypoint: 'sdk-ts' }, 'claude-code').surface, 'other');
});

test('the provider lists and describes sessions from its config directory', async () => {
  const dir = createClaudeDir();
  fs.writeFileSync(
    path.join(dir, 'sessions', '200.json'),
    JSON.stringify({ pid: 200, sessionId: 'abc', cwd: '/tmp/p', status: 'busy', entrypoint: 'claude-vscode' }),
  );
  const transcript = path.join(dir, 'projects', '-tmp-p', 'abc.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(
    transcript,
    [
      { type: 'custom-title', customTitle: 'feat/login', gitBranch: 'feat/login' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/p/a.ts' } }] } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n',
  );
  const provider = createClaudeCodeProvider({ configDir: dir });
  const [session] = await provider.listSessions();
  assert.equal(session.id, 'abc');
  const details = await provider.describe(session);
  assert.equal(details.title, 'feat/login');
  assert.deepEqual(details.action, { text: 'Editing a.ts', icon: 'edit' });
  assert.deepEqual(details.files.map((f) => f.path), ['/tmp/p/a.ts']);
  assert.equal(details.branch, 'feat/login');
  assert.equal(provider.canOpen(session), false, 'no opener, no Claude Code extension');
});

test('only sessions with messages in their transcript can be restored', async () => {
  const dir = createClaudeDir();
  const write = (id, entries) => {
    fs.writeFileSync(path.join(dir, 'sessions', `${id}.json`), JSON.stringify({ pid: 300, sessionId: id, cwd: '/tmp/q', status: 'idle' }));
    if (!entries) return;
    const file = path.join(dir, 'projects', '-tmp-q', `${id}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e) + '\n').join(''));
  };
  write('no-transcript');
  write('titles-only', [{ type: 'ai-title', aiTitle: 'Nothing said yet' }]);
  write('prompted', [{ type: 'user', message: { content: 'Fix the login' } }]);
  const provider = createClaudeCodeProvider({ configDir: dir });
  const resumable = {};
  for (const session of await provider.listSessions()) resumable[session.id] = (await provider.describe(session)).resumable;
  assert.deepEqual(resumable, { 'no-transcript': false, 'titles-only': false, prompted: true });
});

test('the provider marks the sessions archived in the Claude Code extension', async () => {
  const dir = createClaudeDir();
  for (const [pid, sessionId] of [[300, 'kept'], [301, 'archived']]) {
    fs.writeFileSync(path.join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: '/x' }));
  }
  const stateDb = path.join(dir, 'state.vscdb');
  const provider = createClaudeCodeProvider({ configDir: dir, stateDb });
  const archived = async () => (await provider.listSessions()).filter((s) => s.archived).map((s) => s.id);
  assert.deepEqual(await archived(), [], 'no state database yet');

  archiveInClaudeCode(stateDb, ['archived', 'gone']);
  assert.deepEqual(await archived(), ['archived']);

  archiveInClaudeCode(stateDb, []);
  fs.utimesSync(stateDb, new Date(), new Date(Date.now() + 1000)); // Read again only when it changes.
  assert.deepEqual(await archived(), [], 'unarchived in Claude Code');
});

test('a state database that cannot be read archives nothing and is reported once', async () => {
  const dir = createClaudeDir();
  fs.writeFileSync(path.join(dir, 'sessions', '400.json'), JSON.stringify({ pid: 400, sessionId: 'a', cwd: '/x' }));
  const stateDb = path.join(dir, 'state.vscdb');
  fs.writeFileSync(stateDb, 'not a database');
  const warnings = [];
  const provider = createClaudeCodeProvider({ configDir: dir, stateDb, log: { warn: (m) => warnings.push(m) } });
  for (let i = 0; i < 2; i++) {
    const [session] = await provider.listSessions();
    assert.equal(session.archived, false, 'the session is still listed');
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /archived in Claude Code/);
});

test('archivedIn reads the ids from Claude Code state and ignores anything else', () => {
  assert.deepEqual([...archivedIn(JSON.stringify({ hiddenSessionIds: ['a', 7, null, 'b'] }))], ['a', 'b']);
  assert.deepEqual([...archivedIn(JSON.stringify({ hiddenSessionIds: 'a' }))], []);
  assert.deepEqual([...archivedIn(JSON.stringify({}))], []);
  assert.deepEqual([...archivedIn(undefined)], [], 'Claude Code never ran in this profile');
});

test('usageIn reads every limit /usage lists, from the list Claude Code caches', () => {
  const resetsAt = '2026-10-28T18:59:59.569850+00:00';
  const usage = usageIn({
    cachedUsageUtilization: {
      fetchedAtMs: 1793202219668,
      utilization: {
        five_hour: { utilization: 99, resets_at: resetsAt },
        limits: [
          { kind: 'session', group: 'session', percent: 19, resets_at: resetsAt, scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 22, resets_at: null, scope: null },
          { kind: 'weekly_scoped', percent: 6, resets_at: resetsAt, scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
          { kind: 'weekly_scoped', percent: 3, scope: { model: { display_name: '' } } },
          { kind: 'monthly_new', percent: 50 },
          { kind: 'session', percent: '19' },
          null,
        ],
      },
    },
  });
  assert.deepEqual(usage, {
    fetchedAt: 1793202219668,
    limits: [
      { key: 'session', label: '5-hour limit', used: 19, resetsAt: Date.parse('2026-10-28T18:59:59.569Z') },
      { key: 'weekly', label: 'Weekly limit', used: 22, resetsAt: undefined },
      { key: 'weekly:Fable', label: 'Weekly limit, Fable', used: 6, resetsAt: Date.parse('2026-10-28T18:59:59.569Z') },
    ],
  }, 'the list wins over the fields; unnamed scopes, unknown kinds and odd entries are left out');
});

test('usageIn falls back to one field per limit and ignores anything else', () => {
  const config = (utilization) => ({ cachedUsageUtilization: { fetchedAtMs: 1793202219668, utilization } });
  const limits = (utilization) => usageIn(config(utilization)).limits.map((l) => [l.key, l.used]);
  assert.deepEqual(
    limits({
      five_hour: { utilization: 140 },
      seven_day: { utilization: '22' },
      seven_day_opus: { utilization: 8 },
      seven_day_sonnet: null,
      limits: [{ kind: 'unknown', percent: 1 }],
    }),
    [['session', 100], ['weekly:Opus', 8]],
    'kept within 0-100; a limit that is not a number is skipped',
  );
  assert.equal(usageIn(config({ five_hour: null, seven_day: null, limits: [] })), undefined);
  assert.equal(usageIn({ numStartups: 3 }), undefined, 'signed in with an API key, or no reading yet');
  assert.equal(usageIn(null), undefined);
});

test('the provider reads the usage from Claude Code global config, again only when it changes', async () => {
  const dir = createClaudeDir();
  const provider = createClaudeCodeProvider({ configDir: dir });
  assert.equal(await provider.usage(), undefined, 'no global config yet');

  const resetsAt = Date.now() + 3600000;
  cacheUsage(dir, { fiveHour: { used: 19, resetsAt }, sevenDay: { used: 22, resetsAt } });
  assert.deepEqual((await provider.usage()).limits.map((l) => l.used), [19, 22]);

  const file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, '{"cachedUsageUtilization":{"fetch');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  assert.deepEqual((await provider.usage()).limits.map((l) => l.used), [19, 22], 'caught mid-write: the last reading holds');

  fs.writeFileSync(file, JSON.stringify({ numStartups: 12 }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
  assert.equal(await provider.usage(), undefined, 'signed out: Claude Code drops the reading');
});
