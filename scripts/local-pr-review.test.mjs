import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedIssueNumber, normalizeVerdict, parseChangedFiles, possibleSecretLines, staticReview } from './local-pr-review.mjs';

test('normalizes local review verdicts', () => {
  assert.equal(normalizeVerdict('needs changes'), 'needs_changes');
  assert.equal(normalizeVerdict('PASS'), 'pass');
  assert.equal(normalizeVerdict('surprise'), 'blocked');
});

test('parses changed files from git patches', () => {
  const files = parseChangedFiles('diff --git a/scripts/a.mjs b/scripts/a.mjs\nfoo\ndiff --git a/HANDOFF.md b/HANDOFF.md\n');
  assert.deepEqual(files, ['scripts/a.mjs', 'HANDOFF.md']);
});

test('possible secret detection ignores bare keywords but flags assigned literals', () => {
  assert.deepEqual(possibleSecretLines('diff --git a/x b/x\n+Do not paste API keys here'), []);
  assert.equal(possibleSecretLines('diff --git a/x b/x\n+API_KEY=abcdefghijklmnopqrstuvwxyz123456').length, 1);
});

test('static review blocks empty diffs and possible secrets', () => {
  const result = staticReview({
    pr: { number: 1 },
    diff: 'diff --git a/x b/x\n+API_KEY=abcdefghijklmnopqrstuvwxyz123456',
    issueBody: 'Acceptance criteria',
    checkOutput: 'npm run check success',
  });
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.findings.some((f) => f.message.includes('secret')));
});


test('extracts linked issue numbers from PR bodies', () => {
  assert.equal(linkedIssueNumber('Closes #28'), '28');
  assert.equal(linkedIssueNumber('Fixes #123'), '123');
  assert.equal(linkedIssueNumber('No linked issue'), null);
});
