#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

export const REVIEW_MODES = new Set(['static', 'gemini', 'codex']);
export const VERDICTS = new Set(['pass', 'needs_changes', 'blocked']);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: process.env.LOCAL_PR_REVIEW_MODE || 'static', outputDir: 'data/reviews', postComment: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--post-comment') args.postComment = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!args.prNumber) args.prNumber = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function normalizeVerdict(raw = '') {
  const verdict = raw.trim().toLowerCase().replace(/[ -]/g, '_');
  return VERDICTS.has(verdict) ? verdict : 'blocked';
}

export function staticReview({ pr, diff, issueBody, checkOutput }) {
  const findings = [];
  const changedFiles = parseChangedFiles(diff);
  const secretLines = possibleSecretLines(diff);

  if (!diff.trim()) {
    findings.push({ severity: 'high', message: 'PR diff is empty; nothing can be reviewed.' });
  }
  if (!issueBody?.trim()) {
    findings.push({ severity: 'medium', message: 'Linked issue body or acceptance criteria were not found.' });
  }
  if (secretLines.length) {
    findings.push({ severity: 'high', message: `Diff contains possible secret/credential material in added lines; inspect before merge (${secretLines.length} line(s)).` });
  }
  if (/publish|rss|r2|production/i.test(diff) && !/approval|gate|approved/i.test(diff)) {
    findings.push({ severity: 'medium', message: 'Production/publishing-related changes should explicitly preserve approval gates.' });
  }
  if (/the synthetic lens|tsl/i.test(diff) && !/example|seed|legacy/i.test(diff)) {
    findings.push({ severity: 'medium', message: 'Diff may include show-specific assumptions outside example/seed/legacy code.' });
  }
  if (!/passes|success|ok|37\/37|npm run check/i.test(checkOutput || '')) {
    findings.push({ severity: 'medium', message: 'No passing verification output was supplied to the local reviewer.' });
  }

  const hasHigh = findings.some((f) => f.severity === 'high');
  const verdict = hasHigh ? 'blocked' : findings.length ? 'needs_changes' : 'pass';
  return {
    verdict,
    summary: `Static local review inspected PR #${pr.number}, ${changedFiles.length} changed file(s), and available issue/check context.`,
    findings,
    changedFiles,
  };
}

export function possibleSecretLines(diff = '') {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => {
      const added = line.slice(1).trim();
      if (/BEGIN [A-Z ]*PRIVATE KEY/.test(added)) return true;
      if (!/(api[_-]?key|token|password|secret|private[_-]?key)/i.test(added)) return false;
      // Keywords in docs/tests are not secrets unless paired with a plausible literal value.
      return /[:=]\s*['\"]?[A-Za-z0-9_\-./+=]{20,}['\"]?/.test(added);
    });
}

export function parseChangedFiles(diff = '') {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('diff --git '))
    .map((line) => line.replace(/^diff --git a\//, '').replace(/ b\/.+$/, ''));
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, ...options }).trim();
}

function tryRun(cmd, args, fallback = '') {
  try { return run(cmd, args); } catch { return fallback; }
}


export function linkedIssueNumber(body = '') {
  const match = body.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  return match ? match[1] : null;
}

function readIssue(issueNumber) {
  try {
    return JSON.parse(run('gh', ['issue', 'view', String(issueNumber), '--json', 'number,title,url,body,state']));
  } catch {
    return null;
  }
}

function collectContext(prNumber) {
  const prJson = JSON.parse(run('gh', ['pr', 'view', prNumber, '--json', 'number,title,url,body,headRefName,baseRefName,state,isDraft,mergeStateStatus,reviewDecision']));
  const diff = run('gh', ['pr', 'diff', prNumber, '--patch']);
  const issueNumber = linkedIssueNumber(prJson.body);
  const issue = issueNumber ? readIssue(issueNumber) : null;
  const issueBody = issue?.body || '';
  const remoteCheckOutput = tryRun('gh', ['pr', 'checks', prNumber, '--watch=false'], 'No remote check output available.');
  const localCheckOutput = tryRun('npm', ['run', 'check'], 'No local check output available.');
  const checkOutput = `${remoteCheckOutput}\n\n--- local npm run check ---\n${localCheckOutput}`;
  const handoff = existsSync(join(repoRoot, 'HANDOFF.md')) ? readFileSync(join(repoRoot, 'HANDOFF.md'), 'utf8') : '';
  const agents = existsSync(join(repoRoot, 'AGENTS.md')) ? readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8') : '';
  const lessons = existsSync(join(repoRoot, 'LESSONS.md')) ? readFileSync(join(repoRoot, 'LESSONS.md'), 'utf8') : '';
  return { pr: prJson, issue, issueBody, diff, checkOutput, handoff, agents, lessons };
}

function reviewPrompt(context) {
  return `You are an independent local PR reviewer for Podcast Forge. Review only; do not modify files.\n\n` +
    `North star: source provenance, uncertainty, approval gates, configurable podcast production.\n\n` +
    `Return markdown with exactly these sections:\n` +
    `# Local PR Review\nVerdict: pass | needs_changes | blocked\n## Findings\n- severity: message\n## Acceptance Criteria\n- [x]/[ ] item\n## Notes\n\n` +
    `PR:\n${JSON.stringify(context.pr, null, 2)}\n\n` +
    `Issue body:\n${context.issueBody || '(none)'}\n\n` +
    `Check output:\n${context.checkOutput}\n\n` +
    `AGENTS/HANDOFF/LESSONS excerpts:\n${[context.agents, context.handoff, context.lessons].join('\n\n---\n\n').slice(0, 20000)}\n\n` +
    `Diff:\n${context.diff.slice(0, 60000)}\n`;
}

function runModelReview(mode, prompt) {
  if (mode === 'gemini') {
    const result = spawnSync('gemini', ['-m', 'gemini-3-pro-preview', '-p', prompt], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Gemini review failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
  if (mode === 'codex') {
    const result = spawnSync('codex', ['exec', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort="high"', prompt], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Codex review failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
  throw new Error(`Unsupported model review mode: ${mode}`);
}

function renderStaticMarkdown(context, result) {
  return `# Local PR Review\n\n` +
    `Verdict: ${result.verdict}\n\n` +
    `PR: [#${context.pr.number} — ${context.pr.title}](${context.pr.url})\n\n` +
    `Mode: static\n\n` +
    `## Summary\n\n${result.summary}\n\n` +
    `## Findings\n\n${result.findings.length ? result.findings.map((f) => `- ${f.severity}: ${f.message}`).join('\n') : '- none'}\n\n` +
    `## Acceptance Criteria\n\n` +
    `- [${context.issueBody ? 'x' : ' '}] Issue body / acceptance criteria available\n` +
    `- [${context.diff.trim() ? 'x' : ' '}] PR diff available\n` +
    `- [${/pass|success|ok/i.test(context.checkOutput || '') ? 'x' : ' '}] Check output available and appears passing\n` +
    `- [x] HANDOFF.md / AGENTS.md / LESSONS.md loaded if present\n\n` +
    `## Changed files\n\n${result.changedFiles.length ? result.changedFiles.map((f) => `- ${f}`).join('\n') : '- none'}\n\n` +
    `## Notes\n\nStatic review is a deterministic safety net. Prefer Gemini/Codex review mode when available for deeper semantic review.\n`;
}

function verdictFromMarkdown(markdown) {
  const match = markdown.match(/^Verdict:\s*(.+)$/im);
  return normalizeVerdict(match?.[1] || 'blocked');
}

function writeArtifact(outputDir, prNumber, markdown) {
  const dir = join(repoRoot, outputDir);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `pr-${prNumber}-${stamp}.md`);
  writeFileSync(file, markdown);
  return file;
}

function postComment(prNumber, artifactFile, markdown) {
  const excerpt = markdown.length > 6000 ? `${markdown.slice(0, 6000)}\n\n…truncated. Full artifact: ${artifactFile}` : markdown;
  run('gh', ['pr', 'comment', prNumber, '--body', `## Local automated review fallback\n\n${excerpt}`]);
}

function printHelp() {
  console.log(`Usage: node scripts/local-pr-review.mjs <pr-number> [--mode static|gemini|codex] [--output-dir data/reviews] [--post-comment]\n\nCreates a read-only local PR review artifact. Use when Copilot review is unavailable or insufficient.`);
}

async function main() {
  const args = parseArgs();
  if (args.help) return printHelp();
  if (!args.prNumber) throw new Error('PR number is required.');
  if (!REVIEW_MODES.has(args.mode)) throw new Error(`Unsupported mode: ${args.mode}`);

  const context = collectContext(String(args.prNumber));
  let markdown;
  let verdict;
  if (args.mode === 'static') {
    const result = staticReview(context);
    markdown = renderStaticMarkdown(context, result);
    verdict = result.verdict;
  } else {
    markdown = runModelReview(args.mode, reviewPrompt(context));
    verdict = verdictFromMarkdown(markdown);
  }

  const artifact = writeArtifact(args.outputDir, context.pr.number, markdown);
  if (args.postComment) postComment(String(context.pr.number), artifact, markdown);
  console.log(JSON.stringify({ ok: true, pr: context.pr.number, mode: args.mode, verdict, artifact }, null, 2));
  process.exitCode = verdict === 'pass' ? 0 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
