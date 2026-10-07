// Turns the "## Unreleased" section of CHANGELOG.md into the section of a release and prints its
// notes, which become the body of the GitHub release. Used by .github/workflows/release.yml.
// Usage: node scripts/stamp-changelog.js <version> <date>
// Fails if CHANGELOG.md has no "## Unreleased" section or the section is empty, so a release always
// says what changed.
'use strict';

const fs = require('fs');
const path = require('path');

const [version, date] = process.argv.slice(2);
if (!version || !date) {
  console.error('Usage: node scripts/stamp-changelog.js <version> <date>');
  process.exit(2);
}

const file = path.join(__dirname, '..', 'CHANGELOG.md');
const lines = fs.readFileSync(file, 'utf8').split('\n');

const start = lines.findIndex((line) => /^## \[?unreleased\]?\s*$/i.test(line));
if (start < 0) {
  console.error('CHANGELOG.md has no "## Unreleased" section. Add one with the changes of this release.');
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
if (end < 0) end = lines.length;

const notes = lines.slice(start + 1, end).join('\n').trim();
if (!notes) {
  console.error('The "## Unreleased" section of CHANGELOG.md is empty. List the changes of this release.');
  process.exit(1);
}

lines[start] = `## ${version} (${date})`;
fs.writeFileSync(file, lines.join('\n'));
process.stdout.write(notes + '\n');
