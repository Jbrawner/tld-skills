#!/usr/bin/env node
// test-audit engine — project-neutral. Nothing about any specific repo belongs in this file.
//
// Finds tests that cannot fail and tests that never run, and prints one row per deviation:
//   SEVERITY | check | object | status | detail
//
// status is NEW, KNOWN-OPEN <TICKET>, or ACCEPTED (accepted rows are counted, not printed).
//
// Usage:
//   node test-audit.mjs --root <repo-root> [--baseline <path>] [--json]
//
// Exit codes: 0 = ran (with or without findings), 2 = could not run.
// A check that cannot execute reports SKIPPED-CHECK and never a clean pass.
//
// TIME RULE: nothing in this file may embed a date, a month, a year, or a ticket key.
// This runs unattended for years. A stale constant does not error, it silently stops
// matching, which turns the de-dup off and duplicates every open ticket. Dated values
// are derived by the caller at run time, and only ever for output labels.

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- defaults

const DEFAULTS = {
  // Which files are tests. Repo-relative POSIX paths are tested against this.
  // The infix form only: a bare `tests/setup.ts` is a support file, not a test,
  // and counting it inflates the file total and invents collection findings.
  test_file_regex: '\\.(test|spec)\\.[cm]?[jt]sx?$',
  ignore_dirs: ['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'vendor', '__snapshots__'],

  // How a test case is declared. Group 1 must be the quote, group 2 the title.
  test_decl_regex: '\\b(?:it|test)\\s*(?:\\.\\s*(?:only|concurrent|sequential|each\\s*\\([^)]*\\)|failing)\\s*)*\\(\\s*([\'"`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1',
  // Declarations that mean "this never executes".
  skip_decl_regex: '\\b(?:x(?:it|test|describe)|(?:it|test|describe)\\s*\\.\\s*(?:skip|todo|skipIf)|(?:it|test)\\s*\\.\\s*failing)\\s*\\(',

  // What counts as an assertion.
  assertion_regex: '\\bexpect\\s*[.(]|\\bassert\\b|\\.\\s*should\\b|\\bshould\\s*\\.|\\btoHaveBeenCalled',
  // Calls that assert indirectly, by name. A test whose only assertion is
  // `expectStatValue(...)` still asserts. Helpers DEFINED in the same file are
  // detected automatically; this catches imported ones by naming convention.
  assertion_helper_regex: '\\b(?:expect|assert|verify|ensure|check|should)[A-Z_]\\w*\\s*\\(',
  // Assertions that say nothing about behaviour on their own. Deliberately narrow:
  // toBeNull/toBeTruthy DO assert a value and belong on plenty of correct tests.
  weak_assertion_regex: '\\.\\s*toBeDefined\\s*\\(\\s*\\)|\\btypeof\\s',

  // A write whose refusal is silent: the client returns no error and simply
  // changes zero rows, so asserting "no error" proves nothing either way.
  // Gated on the test NAME describing a refusal, because the identical assertion
  // is correct on a positive-path test that expects the write to succeed.
  silent_refusal_regex: '\\.\\s*(?:update|delete|insert|upsert)\\s*\\(',
  negative_path_name_regex: '\\b(?:prevent|prevents|reject|rejects|deny|denies|denied|block|blocks|blocked|refuse|refuses|forbid|forbids|forbidden|disallow|disallows|cannot|can\'t|must not|does not allow|not allowed|no access|unauthori[sz]ed|another (?:lab|org|tenant|team|user)|other (?:lab|org|tenant|team|user)|cross-(?:lab|org|tenant|team)|someone else)',
  refusal_evidence_regex: '\\bcount\\b|\\.length|rowCount|affected|toHaveLength|serviceClient|service_role|adminClient|supabaseAdmin|re-?read|toBe\\s*\\(\\s*0\\s*\\)|toEqual\\s*\\(\\s*\\[\\s*\\]\\s*\\)',

  // Asserting on a file's text instead of its behaviour.
  source_read_regex: '\\breadFileSync\\b|\\breadFile\\s*\\(|\\bfs\\s*\\.\\s*read',

  // Runners: which configs collect which files. Without this the collection
  // check cannot run, and reports SKIPPED-CHECK rather than a clean pass.
  runners: [],

  // Where CI workflows live, for the disabled-job check.
  ci_workflow_dir: '',
  ci_test_job_regex: 'test|spec|e2e|check|lint|build',

  // Tracker wiring, used only when the repo has no campaign file.
  tracker: '', tracker_cloud_id: '', tracker_project: '', ticket_labels: [],
};

const SEV = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const a = { root: process.cwd(), baseline: '', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') a.root = argv[++i];
    else if (argv[i] === '--baseline') a.baseline = argv[++i];
    else if (argv[i] === '--json') a.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true;
    else die(`unknown argument: ${argv[i]}`);
  }
  return a;
}

function die(msg) {
  process.stderr.write(`test-audit: could not run: ${msg}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------- masking
//
// Replace the interior of strings, template literals, regex literals and
// comments with spaces, preserving length and newlines. Offsets in the masked
// text map 1:1 onto the original, so brace matching and pattern searches can
// run on the mask while titles are sliced from the original.

function mask(src) {
  // split(''), NOT Array.from(): split() yields UTF-16 code units, which is what
  // src[i] and src.slice() index by. Array.from() yields code points, so a single
  // emoji or surrogate pair desynchronises every offset after it and the mask
  // silently corrupts the rest of the file. Real test files contain emoji.
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // Track whether a '/' starts a regex literal or is division.
  let prevMeaningful = '';
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i + 2; while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; prevMeaningful = 'x'; continue;
    }
    if (c === '`') {
      // Template literal: blank the text but keep ${ } expressions readable.
      let j = i + 1;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1, k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            k++;
          }
          j = k; continue;
        }
        out[j] = out[j] === '\n' ? '\n' : ' ';
        j++;
      }
      i = j + 1; prevMeaningful = 'x'; continue;
    }
    if (c === '/' && !/[\w)\]]/.test(prevMeaningful)) {
      // Regex literal.
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        else if (d === '\n') break;
        j++;
      }
      if (closed) { blank(i + 1, j); i = j + 1; prevMeaningful = 'x'; continue; }
    }
    if (!/\s/.test(c)) prevMeaningful = c;
    i++;
  }
  return out.join('');
}

// Find the body of the callback passed to a test declaration.
//
// Naive "first { after the title" is wrong: `async ({ page }) => {` opens a
// destructuring brace first, and taking that as the body makes every such test
// look assertion-free. Walk to the arrow (or `function`) at the call's own depth,
// then take the block after it.
function callbackBody(m, from) {
  let depth = 1; // we are inside the `it(` call
  for (let i = from; i < m.length; i++) {
    const c = m[i];
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return null; // call closed without a block body
      continue;
    }
    if (depth === 1 && c === '=' && m[i + 1] === '>') {
      let j = i + 2;
      while (j < m.length && /\s/.test(m[j])) j++;
      if (m[j] === '{') return blockAt(m, j, j + 1);
      return null; // concise-expression arrow body: no block to inspect
    }
    if (depth === 1 && m.startsWith('function', i) && !/[\w$]/.test(m[i - 1] || '')) {
      return blockAt(m, i + 8, m.length);
    }
  }
  return null;
}

// Match the block that starts at the first '{' at or after `from`.
// Returns [openIndex, closeIndex] on the masked text, or null.
function blockAt(m, from, limit) {
  let i = from;
  while (i < m.length && i < limit && m[i] !== '{') i++;
  if (i >= m.length || i >= limit) return null;
  let depth = 0;
  for (let j = i; j < m.length; j++) {
    if (m[j] === '{') depth++;
    else if (m[j] === '}') { depth--; if (depth === 0) return [i, j]; }
  }
  return null;
}

// ---------------------------------------------------------------- walking

function walk(root, ignoreDirs, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (ignoreDirs.includes(e.name)) continue;
      // A subdirectory carrying its own .git is a separate checkout: a linked
      // worktree, a submodule, or a nested clone. Its files are some other
      // branch's copy of the same tree, so walking in counts every test two or
      // more times and reports each copy as its own finding. That is not merely
      // noisy: the duplicates are indistinguishable from real ones at triage,
      // they carry a path no reviewer can act on, and the object identity moves
      // the moment the worktree is deleted, so the baseline can never settle.
      // The check is presence, not name, because worktrees get arbitrary names
      // and only some projects park them under a predictable parent.
      if (fs.existsSync(path.join(p, '.git'))) continue;
      walk(p, ignoreDirs, out);
    } else if (e.isFile()) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- checks

function analyzeFile(rel, src, cfg, add) {
  const m = mask(src);
  const RX = (k) => new RegExp(cfg[k], 'g');
  const rx1 = (k, flags = '') => new RegExp(cfg[k], flags);
  let declCount = 0;

  // Assertion helpers defined in THIS file: any function whose own body asserts.
  // Without this, a test whose only assertion is a wrapper call reads as
  // assertion-free, and that false positive would swamp the real ones.
  const localHelpers = new Set();
  {
    const fnRe = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
    let f;
    while ((f = fnRe.exec(m)) !== null) {
      const name = f[1] || f[2];
      if (!name) continue;
      const blk = blockAt(m, f.index + f[0].length, f.index + f[0].length + 200);
      if (!blk) continue;
      const body = m.slice(blk[0] + 1, blk[1]);
      if (rx1('assertion_regex').test(body)) localHelpers.add(name);
    }
  }
  const helperRe = localHelpers.size
    ? new RegExp(`\\b(?:${[...localHelpers].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`)
    : null;
  const asserts = (body) =>
    rx1('assertion_regex').test(body)
    || rx1('assertion_helper_regex').test(body)
    || (helperRe ? helperRe.test(body) : false);

  // --- skipped declarations
  //
  // Two different things wear the same `.skip` spelling and only one of them is a
  // disabled test:
  //
  //   it.skip('title', fn)              first argument is a string  -> never runs
  //   test.skip(cond, 'reason')         first argument is an expression -> runs
  //                                     everywhere the condition is false
  //
  // The second form is how a runner scopes a case to one project or browser, and
  // calling it a disabled test is wrong on both counts: the case does execute, and
  // there is no title to name it by. Discriminating on the first argument is the
  // whole difference, so read it rather than scanning ahead for the nearest quote —
  // that finds any nested call's string argument and invents a title from it.
  {
    const re = RX('skip_decl_regex');
    const conditional = [];
    let mm;
    while ((mm = re.exec(m)) !== null) {
      const after = mm.index + mm[0].length;
      const titleRe = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;
      const t = titleRe.exec(src.slice(after, after + 400));
      if (t) {
        add('MEDIUM', 'skipped-test', `${rel}::${t[2]}`,
          `Declared with a skip/todo marker, so it never executes. Either it is dead and should go, or it is masking a real failure.`);
        continue;
      }
      // Conditional skip. Keep the stated reason, which is the only durable thing
      // about it; a line number moves the moment anyone edits above it, and an
      // object identity that moves re-files its own ticket every run.
      const reason = /^[^)]*?,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(src.slice(after, after + 600));
      conditional.push(reason ? reason[2] : '(no reason given)');
    }
    if (conditional.length) {
      const reasons = [...new Set(conditional)];
      add('LOW', 'conditional-skip', rel,
        `${conditional.length} runtime skip${conditional.length === 1 ? '' : 's'} guarded by a condition rather than a title, so ${conditional.length === 1 ? 'this case is' : 'these cases are'} scoped rather than disabled. Worth a look only because a condition that is never false silently retires a test while it keeps reporting as present. Stated reason or suite title: ${reasons.map((s) => `"${s}"`).join('; ')}.`);
    }
  }

  // --- per-test-case checks
  const decl = RX('test_decl_regex');
  let d;
  while ((d = decl.exec(m)) !== null) {
    declCount++;
    // Title comes from the ORIGINAL text at the same offsets (the mask blanked it).
    const q = d[1];
    const titleStart = d.index + d[0].lastIndexOf(q, d[0].length - 2) + 1;
    const titleEnd = d.index + d[0].length - 1;
    const title = src.slice(titleStart, titleEnd).trim() || `line ${src.slice(0, d.index).split('\n').length}`;

    const blk = callbackBody(m, d.index + d[0].length);
    if (!blk) continue;
    const [o, c] = blk;
    const bodyMask = m.slice(o + 1, c);
    const bodySrc = src.slice(o + 1, c);
    const obj = `${rel}::${title}`;

    const hasAssertion = asserts(bodyMask);

    // 1. no assertion at all
    if (!hasAssertion) {
      if (bodyMask.trim().length === 0) {
        add('HIGH', 'no-assertion', obj, 'Body is empty. It passes unconditionally.');
      } else {
        add('HIGH', 'no-assertion', obj,
          'Body performs work and then ends without a single assertion. It passes whatever the product does, including when the behaviour it is named for is removed outright.');
      }
      continue;
    }

    // 2. every assertion sits inside a conditional
    if (allAssertionsConditional(bodyMask, cfg)) {
      add('HIGH', 'assertion-only-in-conditional', obj,
        'Every assertion sits inside an if/optional guard. When the guard is false the test asserts nothing and still reports green, which is exactly what happens when the element it looks for stops rendering.');
    }

    // 3. empty waitFor / act callback
    if (/\b(?:waitFor|act|waitForNextUpdate)\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(bodyMask)) {
      add('HIGH', 'empty-waitfor', obj,
        'A wait callback has an empty body, so it resolves on the first tick and asserts nothing. It reads as synchronisation and provides none.');
    }

    // 4. tautology — both sides of the comparison are the same expression
    for (const t of tautologies(bodyMask)) {
      add('HIGH', 'tautology', obj, `Compares an expression with itself (${t}). It cannot fail.`);
    }

    // 5. a silently-refused write asserted only as "no error".
    // Requires the test to NAME a refusal. On a positive-path test the same
    // assertion is correct, and flagging those buries the real ones.
    if (rx1('negative_path_name_regex', 'i').test(title)
      && rx1('silent_refusal_regex').test(bodyMask)
      && /\bexpect\s*\(\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*\s*\)\s*\.\s*(?:toBeNull|toBeUndefined|not\s*\.\s*toBeTruthy)\s*\(/.test(bodyMask)
      && !rx1('refusal_evidence_regex').test(bodyMask)) {
      add('HIGH', 'refusal-asserted-as-no-error', obj,
        'Asserts only that no error came back from a write. A write refused by the database or by a permission rule returns no error and simply changes zero rows, so this assertion holds whether the rule is enforced or absent. Assert the row count, or re-read the row with an unrestricted client.');
    }

    // 6. shape-only assertions
    if (onlyWeakAssertions(bodyMask, cfg)) {
      add('MEDIUM', 'shape-only-assertion', obj,
        'Every assertion checks a type or mere presence rather than a value. It survives any change that keeps the shape, which is most regressions.');
    }

    // 7. asserting on source text rather than behaviour
    if (rx1('source_read_regex').test(bodyMask)) {
      add('MEDIUM', 'source-text-assertion', obj,
        'Reads a source file and asserts on its text. It pins how the code is written rather than what it does, so it breaks on a harmless rename and passes through a real behavioural break.');
    }
  }

  // A file named like a test that declares no test case is either dead weight or
  // a file whose declaration style test_decl_regex does not recognise. Both need
  // a human: the second one means every check above silently inspected nothing.
  if (declCount === 0) {
    add('LOW', 'test-file-no-cases', rel,
      'Named like a test file but declares no recognised test case. Either it is dead, or its declaration style is not matched by test_decl_regex, in which case every other check skipped this file without saying so.');
  }
}

function allAssertionsConditional(body, cfg) {
  const assertRe = new RegExp(cfg.assertion_regex, 'g');
  const hits = [];
  let a;
  while ((a = assertRe.exec(body)) !== null) hits.push(a.index);
  if (hits.length === 0) return false;
  // Find every `if (...) {` block and mark its span.
  const spans = [];
  const ifRe = /\bif\s*\(/g;
  let f;
  while ((f = ifRe.exec(body)) !== null) {
    let depth = 0, k = f.index + f[0].length - 1;
    for (; k < body.length; k++) {
      if (body[k] === '(') depth++;
      else if (body[k] === ')') { depth--; if (depth === 0) break; }
    }
    const blk = blockAt(body, k + 1, k + 40);
    if (blk) spans.push(blk);
  }
  if (spans.length === 0) return false;
  return hits.every((h) => spans.some(([o, c]) => h > o && h < c));
}

function onlyWeakAssertions(body, cfg) {
  const all = body.match(new RegExp(cfg.assertion_regex, 'g')) || [];
  if (all.length === 0) return false;
  // Count assertions whose matcher carries a real expected value.
  const strong = body.match(/\.\s*(?:toBe|toEqual|toStrictEqual|toContain|toMatch|toHaveLength|toHaveTextContent|toHaveValue|toHaveBeenCalledWith|toHaveBeenCalledTimes|toThrow|toBeGreaterThan|toBeLessThan|toBeCloseTo|toHaveProperty|toMatchObject)\s*\(\s*\S/g) || [];
  if (strong.length > 0) return false;
  return new RegExp(cfg.weak_assertion_regex).test(body);
}

function tautologies(body) {
  const found = [];
  const re = /\bexpect\s*\(\s*([^)]{1,80}?)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*([^)]{1,80}?)\s*\)/g;
  let mm;
  while ((mm = re.exec(body)) !== null) {
    const a = mm[1].replace(/\s+/g, '');
    const b = mm[2].replace(/\s+/g, '');
    if (a && a === b && !/^(true|false|null|undefined|0|1|''|""|``)$/.test(a)) found.push(`${mm[1].trim()}`);
  }
  return found;
}

// ---------------------------------------------------------------- collection + CI

function checkCollection(testFiles, cfg, add, skip) {
  if (!Array.isArray(cfg.runners) || cfg.runners.length === 0) {
    skip('suite-not-collected',
      'No runners declared in the baseline, so the engine cannot tell which test files any runner actually collects. This is NOT a clean pass. Add a runners list to the baseline: one entry per runner config with the regex of the paths it includes.');
    return;
  }
  const compiled = cfg.runners.map((r) => ({
    name: r.name || r.config || 'runner',
    config: r.config || '',
    re: new RegExp(r.include_regex),
  }));
  for (const rel of testFiles) {
    const owners = compiled.filter((r) => r.re.test(rel));
    if (owners.length === 0) {
      add('HIGH', 'suite-not-collected', rel,
        `No declared runner collects this file, so nothing executes it. Declared runners: ${compiled.map((r) => r.name).join(', ')}. A test that never runs is not coverage, and a green build that omits it is reporting a result it did not measure.`);
    }
  }
}

function checkCiJobs(root, cfg, add, skip) {
  const dir = cfg.ci_workflow_dir ? path.join(root, cfg.ci_workflow_dir) : '';
  if (!dir || !fs.existsSync(dir)) {
    skip('runner-job-disabled',
      'No CI workflow directory declared or found, so the engine cannot tell whether a test job is switched off. This is NOT a clean pass. Set ci_workflow_dir in the baseline.');
    return;
  }
  const files = walk(dir, cfg.ignore_dirs).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) {
    skip('runner-job-disabled', `CI workflow directory ${cfg.ci_workflow_dir} contains no YAML files.`);
    return;
  }
  const jobRe = new RegExp(cfg.ci_test_job_regex, 'i');
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let job = null, jobIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const jm = /^(\s{2,})([A-Za-z0-9_-]+):\s*$/.exec(L);
      if (jm && jm[1].length <= 4) { job = jm[2]; jobIndent = jm[1].length; continue; }
      if (!job) continue;
      const ind = L.match(/^\s*/)[0].length;
      if (L.trim() && ind <= jobIndent && !/^\s*(if|name|needs|runs-on|uses|with|env|steps|strategy|outputs|permissions|concurrency|timeout-minutes|continue-on-error|defaults|services|container|secrets):/.test(L)) { job = null; continue; }
      const ifm = /^\s*if:\s*(.+?)\s*$/.exec(L);
      if (ifm && jobRe.test(job)) {
        const cond = ifm[1].replace(/\$\{\{|\}\}/g, '').trim();
        // A bare false, and also `false && anything`. The short-circuit form is how
        // a job usually gets switched off without deleting the real condition, and
        // it is exactly as constant-false as the bare one.
        if (/^(false|'false'|"false"|0)$/i.test(cond) || /^false\s*&&/i.test(cond)) {
          add('HIGH', 'runner-job-disabled', `${rel}::${job}`,
            `CI job "${job}" is switched off with a constant-false condition, so every test it owns is skipped on every run while the check still reports as satisfied. Anyone can change that surface, open a pull request, and see the build pass without one of those tests having executed.`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- main

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write('usage: node test-audit.mjs --root <repo-root> [--baseline <path>] [--json]\n');
    return 0;
  }
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) die(`root does not exist: ${root}`);

  let baseline = null, baselineUsed = '';
  if (args.baseline) {
    if (!fs.existsSync(args.baseline)) die(`baseline not found: ${args.baseline}. Refusing to continue: a missing baseline silently reports every known finding as new.`);
    try { baseline = JSON.parse(fs.readFileSync(args.baseline, 'utf8')); }
    catch (e) { die(`baseline is not valid JSON (${e.message}). A malformed baseline must never be read as an empty one.`); }
    baselineUsed = args.baseline;
  }

  const cfg = { ...DEFAULTS, ...((baseline && baseline.config) || {}) };
  const accepted = (baseline && baseline.accepted) || [];
  const knownOpen = (baseline && baseline.known_open) || [];

  // Composite map keys join on a byte that can never occur in a check name or a
  // path. Written as an escape rather than a literal so the file stays plain text
  // and grep does not decide it is binary and stop printing matches.
  const SEP = '\u0000';
  const acceptKey = new Map();
  for (const a of accepted) acceptKey.set(`${a.check || '*'}${SEP}${a.object}`, a.reason || '');
  const openKey = new Map();
  for (const k of knownOpen) openKey.set(k.object, k.ticket);

  let testRe;
  try { testRe = new RegExp(cfg.test_file_regex); }
  catch (e) { die(`test_file_regex is not a valid regex: ${e.message}`); }

  const all = walk(root, cfg.ignore_dirs);
  const testFiles = all
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((rel) => testRe.test(rel))
    .sort();

  if (testFiles.length === 0) {
    die(`no test files matched under ${root}. Either the repo has no tests or test_file_regex does not fit this project. Not reporting a clean pass from a sweep that inspected nothing.`);
  }

  const rows = [];
  const skipped = [];
  const acceptedHits = [];
  // Two cases in one file may carry the same title, and then `file::title` names
  // both. That is not cosmetic: one baseline row would suppress two findings, and
  // one ticket would claim to cover a test nobody looked at. Later collisions get
  // an ordinal so every finding keeps its own identity.
  const objSeen = new Map();
  const add = (severity, check, object, detail) => {
    const n = (objSeen.get(`${check}${SEP}${object}`) || 0) + 1;
    objSeen.set(`${check}${SEP}${object}`, n);
    if (n > 1) object = `${object}#${n}`;
    const acc = acceptKey.get(`${check}${SEP}${object}`) ?? acceptKey.get(`*${SEP}${object}`);
    if (acc !== undefined) { acceptedHits.push({ check, object, reason: acc }); return; }
    const ticket = openKey.get(object) ?? openKey.get(`${check}${SEP}${object}`);
    rows.push({ severity, check, object, status: ticket ? `KNOWN-OPEN ${ticket}` : 'NEW', detail });
  };
  const skip = (check, why) => skipped.push({ check, why });

  let unreadable = 0;
  for (const rel of testFiles) {
    let src;
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch { unreadable++; continue; }
    try { analyzeFile(rel, src, cfg, add); }
    catch (e) { skip(`file:${rel}`, `parse failed (${e.message}); this file was NOT inspected`); }
  }

  checkCollection(testFiles, cfg, add, skip);
  checkCiJobs(root, cfg, add, skip);

  rows.sort((a, b) =>
    (SEV[a.severity] - SEV[b.severity]) || a.check.localeCompare(b.check) || a.object.localeCompare(b.object));

  const summary = {
    root,
    baseline: baselineUsed || null,
    test_files: testFiles.length,
    unreadable_files: unreadable,
    rows: rows.length,
    new: rows.filter((r) => r.status === 'NEW').length,
    known_open: rows.filter((r) => r.status.startsWith('KNOWN-OPEN')).length,
    accepted_suppressed: acceptedHits.length,
    skipped_checks: skipped,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify({ summary, rows, accepted: acceptedHits }, null, 2) + '\n');
    return 0;
  }

  const out = [];
  if (!baselineUsed) {
    out.push('NO BASELINE. Every finding below reports as NEW because there is nothing to compare against.');
    out.push('Treat this run as establishing a baseline, not as a list of emergencies.');
    out.push('');
  }
  out.push(`root            ${summary.root}`);
  out.push(`baseline        ${summary.baseline || '(none)'}`);
  out.push(`test files      ${summary.test_files}`);
  if (unreadable) out.push(`unreadable      ${unreadable}  <- NOT inspected`);
  out.push(`rows            ${summary.rows}   (NEW ${summary.new}, KNOWN-OPEN ${summary.known_open}, suppressed by baseline ${summary.accepted_suppressed})`);
  out.push('');
  if (skipped.length) {
    out.push('SKIPPED CHECKS — these did not execute. This is not a pass for them:');
    for (const s of skipped) out.push(`  ${s.check}: ${s.why}`);
    out.push('');
  }
  for (const r of rows) out.push(`${r.severity} | ${r.check} | ${r.object} | ${r.status} | ${r.detail}`);
  if (rows.length === 0) out.push('No deviations.');
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

process.exit(main());
