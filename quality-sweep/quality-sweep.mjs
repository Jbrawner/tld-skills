#!/usr/bin/env node
/**
 * quality-sweep — noise control for a recurring multi-agent code sweep.
 *
 * This engine does NOT find defects. A sweep's findings come from agents reading code, because no
 * script detects "this page downloads the whole table to render four numbers". What this engine
 * owns is the part that CAN be deterministic, and that part is the hard part: deciding what is new,
 * what is already tracked, what a human already reviewed and accepted, and refusing to report a
 * clean result from a run that did not finish.
 *
 * Three modes:
 *   manifest   what this lens sweeps, its bar, its benign patterns, and the deadline    (default)
 *   classify   stamp each finding NEW / KNOWN-OPEN / SUPPRESSED and decide the run status
 *   render     emit the review document and the two index rows, so every lens reads alike
 *
 * TIME RULE: nothing in this file may embed a date, a month, a year, or a ticket key. This runs
 * unattended for years. A stale constant does not error, it silently stops matching, which turns
 * the de-dup off and duplicates every open ticket. Dates are read from the clock at run time, and
 * only ever for output. Timestamps from the baseline are compared as deltas, never to a literal.
 *
 * PROJECT RULE: nothing in this file may name a project, a repo, a path inside one, a table, a
 * ticket prefix, a team convention, or a threshold. All of that is the baseline's job.
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, sep, dirname } from "node:path";

const EXIT_COMPLETE = 0;
const EXIT_PARTIAL = 1;
const EXIT_NOT_RUN = 2;

const BASELINE_NAME = "quality-sweep-baseline.json";
const BASELINE_DIRS = [".tld", ".claude", ""];
// Per-run findings live one file per lens per run, beside the baseline. Two runs never write
// the same path, so they cannot conflict and cannot block each other. See RUN_PROTOCOL.md.
const FINDINGS_DIR = "sweep-findings";
const SEP = "::";

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--list-lenses") out.listLenses = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function die(msg) {
  process.stderr.write(`quality-sweep: ${msg}\n`);
  process.exit(EXIT_NOT_RUN);
}

const HELP = `quality-sweep — noise control for a recurring multi-agent code sweep

  node quality-sweep.mjs --root <repo> --lens <slug> [--baseline <path>]
  node quality-sweep.mjs --root <repo> --lens <slug> --classify <findings.json> [--deadline <iso>]
  node quality-sweep.mjs --root <repo> --lens <slug> --render <classified.json> --date <YYYY-MM-DD>
  node quality-sweep.mjs --root <repo> --list-lenses

  --root       repo root to sweep. Required.
  --lens       which sweep to run. Required except with --list-lenses.
  --baseline   explicit baseline path. Omit to search .tld/, .claude/, then the repo root.
  --classify   path to the findings JSON the sweep produced.
  --render     path to the classified JSON, to emit the review document.
  --date       the run date for --render, in YYYY-MM-DD. Read it from the real clock.
  --deadline   ISO timestamp from the manifest. Past it, the run cannot report COMPLETE.
  --json       machine-readable output.

Exit codes: 0 the sweep ran and every check executed, 1 it ran but coverage is incomplete,
2 it could not run at all. There is no state in which a partial result reads as a clean one.
`;

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

const EMPTY_BASELINE = {
  config: {},
  lenses: {},
  benign_patterns: [],
  accepted: [],
  known_open: [],
};

/**
 * Two distinct no-baseline cases, and the distinction is load-bearing.
 *
 * Nothing found by search  -> run anyway with an empty baseline. Everything reports NEW. That is
 *                             the correct first run for a project that has never been swept.
 * A path was NAMED and is missing or malformed -> refuse. A typo must never silently become a
 *                             run that re-files every ticket the project already has.
 */
function loadBaseline(root, named) {
  if (named) {
    if (!existsSync(named)) {
      die(
        `baseline not found: ${named}\n` +
          `  Refusing to continue. A named baseline that is missing is a typo, not an empty ` +
          `project, and reading it as empty would report every tracked finding as new.\n` +
          `  Omit --baseline entirely if this project genuinely has no baseline yet.`,
      );
    }
    const b = parseBaseline(named);
    const f = mergeFindings(b, dirname(resolve(named)));
    return { baseline: b, path: named, degraded: false, findings: f };
  }
  for (const dir of BASELINE_DIRS) {
    const p = dir ? join(root, dir, BASELINE_NAME) : join(root, BASELINE_NAME);
    if (existsSync(p)) {
      const b = parseBaseline(p);
      const f = mergeFindings(b, dirname(resolve(p)));
      return { baseline: b, path: p, degraded: false, findings: f };
    }
  }
  return { baseline: structuredClone(EMPTY_BASELINE), path: null, degraded: true };
}

// ---------------------------------------------------------------------------
// suppression is a live fact, not a stored one
// ---------------------------------------------------------------------------
//
// A `known_open` row means "already ticketed, stay quiet about it". That is only true while the
// ticket is open. Nothing about the row changes when the ticket closes, so a row written a year ago
// keeps suppressing a finding whose ticket is long since Done -- and a defect that comes back is met
// with silence by the one check that exists to notice it.
//
// This is not a housekeeping problem, it is a modelling one. The row stores a STATUS captured at
// write time and the engine consumes it as if it were still true at read time. The tracker owns that
// status and keeps changing it afterwards, so any stored copy rots. Pruning by hand treats the
// symptom; it also cannot work at all for the per-run findings files, which are immutable by design
// and therefore have no one to prune them.
//
// So the row stores only the ticket key, which is permanent, and the status is resolved here on
// every run. Rot stops being something to remember and becomes impossible.
//
// On 2026-08-25 this was measured before the check existed: 982 of 1,248 rows, 78%, were muting
// tickets that had already closed.
//
// A row whose ticket has closed is not simply dropped. It moves to `regression_watch`: if this run
// detects that object again, that is a REGRESSION of closed work, which is the most valuable thing
// a recurring check produces and which routes to human review rather than the ready-for-dev queue.
//
// PROJECT RULE (see the file header): the command and the key pattern are configuration, never
// constants. This engine must not know what a ticket key looks like in any particular tracker.
function verifySuppressions(baseline) {
  const cfg = baseline.config || {};
  const cmdTemplate = cfg.ticket_status_command;
  const keyPattern = cfg.ticket_key_pattern;

  const rows = baseline.known_open || [];

  if (typeof cmdTemplate !== "string" || typeof keyPattern !== "string") {
    return {
      verified: false,
      reason:
        'config.ticket_status_command and config.ticket_key_pattern are not both set, so no row ' +
        'could be checked against the tracker',
      checked: 0,
      closed: 0,
      watch: [],
    };
  }

  let re;
  try {
    re = new RegExp(keyPattern, "g");
  } catch (e) {
    die(
      `config.ticket_key_pattern is not a valid regular expression: ${e.message}\n` +
        `  Refusing to continue. An unusable pattern finds no ticket keys, every suppression then ` +
        `looks unverifiable, and the run reports work as new that is already tracked.`,
    );
  }

  const keysOf = (row) => String(row.ticket || "").match(re) || [];
  const allKeys = [...new Set(rows.flatMap(keysOf))].sort();
  if (!allKeys.length) return { verified: true, reason: null, checked: 0, closed: 0, watch: [] };

  // Batched: a tracker query naming every key at once is the one that silently truncates.
  const CHUNK = 100;
  const closed = new Set();
  for (let i = 0; i < allKeys.length; i += CHUNK) {
    const batch = allKeys.slice(i, i + CHUNK);
    const cmd = cmdTemplate.split("{keys}").join(batch.join(","));
    let out;
    try {
      out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    } catch (e) {
      die(
        `could not read ticket status from the tracker. THIS IS A SKIPPED RUN.\n` +
          `  command: ${cmd}\n` +
          `  error:   ${(e && e.message) || e}\n` +
          `  Refusing to continue. Every suppression in this baseline is an unverified claim that a ` +
          `ticket is still open. Trusting them blind is how a closed ticket's defect gets muted ` +
          `forever; ignoring them blind re-files every tracked finding as new. Neither is a run.`,
      );
    }
    // The command prints the keys that are CLOSED. Anything else on the line is ignored, so a CSV
    // header or a table border costs nothing.
    for (const k of out.match(re) || []) closed.add(k);
  }

  const watch = [];
  const stillOpen = [];
  for (const row of rows) {
    const ks = keysOf(row);
    if (ks.length && ks.every((k) => closed.has(k))) watch.push(row);
    else stillOpen.push(row);
  }
  baseline.known_open = stillOpen;
  baseline.regression_watch = watch;

  return { verified: true, reason: null, checked: allKeys.length, closed: closed.size, watch };
}

// Union every per-run findings file beside the baseline into the in-memory baseline.
//
// Each run writes exactly one new file, <baselineDir>/sweep-findings/<lens>/<YYYY-MM-DD>.json, and
// never edits an existing one. That is the whole reason this function exists: the single shared
// mutable baseline it replaces could be jammed by one bad merge, which silenced every routine for
// two weekends in Aug 2026. Reading is a union of immutable files, so there is nothing to conflict.
//
// A malformed findings file is fatal, exactly like a malformed baseline: skipping it would silently
// report already-ticketed findings as new and duplicate every ticket it holds.
function mergeFindings(baseline, baselineDir) {
  const root = join(baselineDir, FINDINGS_DIR);
  if (!existsSync(root)) return { files: 0, known_open: 0, accepted: 0 };

  const seenOpen = new Set(baseline.known_open.map((r) => r.object));
  const seenAccepted = new Set(baseline.accepted.map((r) => r.object));
  const stat = { files: 0, known_open: 0, accepted: 0 };

  const lensDirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const lensDir of lensDirs) {
    const dir = join(root, lensDir);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      const p = join(dir, f);
      let doc;
      try {
        doc = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        die(
          `findings file is not valid JSON: ${p} (${e.message})\n` +
            `  Refusing to continue. A malformed findings file must never be read as an empty one, ` +
            `or every finding it records re-files as a new ticket.`,
        );
      }
      if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
        die(`findings file must be a JSON object: ${p}`);
      }
      stat.files += 1;

      for (const [key, seen] of [["known_open", seenOpen], ["accepted", seenAccepted]]) {
        const rows = doc[key];
        if (rows === undefined) continue;
        if (!Array.isArray(rows)) die(`findings file key "${key}" must be an array: ${p}`);
        for (const row of rows) {
          if (!row || typeof row.object !== "string") {
            die(`findings row is missing a string "object" identity: ${p}`);
          }
          if (seen.has(row.object)) continue;
          seen.add(row.object);
          baseline[key].push(row);
          stat[key] += 1;
        }
      }

      // A completed run stamps its lens. Latest date wins, so replaying old files is harmless.
      const lens = typeof doc.lens === "string" ? doc.lens : lensDir;
      if (doc.completed === true && typeof doc.date === "string" && baseline.lenses[lens]) {
        const prev = baseline.lenses[lens].last_completed;
        if (!prev || doc.date > prev) baseline.lenses[lens].last_completed = doc.date;
      }
    }
  }
  return stat;
}

function parseBaseline(p) {
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch (e) {
    die(`baseline unreadable: ${p} (${e.message})`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    die(
      `baseline is not valid JSON: ${p} (${e.message})\n` +
        `  Refusing to continue. A malformed baseline must never be read as an empty one.`,
    );
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    die(`baseline must be a JSON object: ${p}`);
  }
  for (const [key, want] of [
    ["lenses", "object"],
    ["config", "object"],
    ["accepted", "array"],
    ["known_open", "array"],
    ["benign_patterns", "array"],
  ]) {
    if (obj[key] === undefined) continue;
    const isArray = Array.isArray(obj[key]);
    const ok = want === "array" ? isArray : typeof obj[key] === "object" && !isArray;
    if (!ok) die(`baseline key "${key}" must be a${want === "array" ? "n array" : " object"}: ${p}`);
  }
  return { ...structuredClone(EMPTY_BASELINE), ...obj };
}

// ---------------------------------------------------------------------------
// object identity
//
// The whole de-dup rests on this. The same defect found again next week will be described in
// different words by a different agent, so identity can never be the title. It is the thing the
// finding is ABOUT: a file, and the symbol inside it.
// ---------------------------------------------------------------------------

function normPath(p, root) {
  if (!p) return "";
  let s = String(p).trim().replace(/\\/g, "/");
  s = s.replace(/:\d+(?::\d+)?$/, ""); // a trailing :line or :line:col is not part of the identity
  const r = String(root || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (r && s.startsWith(r + "/")) s = s.slice(r.length + 1);
  s = s.replace(/^\.\//, "").replace(/^\/+/, "");
  return s;
}

function normSymbol(s) {
  if (!s) return "";
  return String(s).trim().replace(/\(\s*\)$/, "").replace(/\s+/g, " ");
}

function objectKey(lens, finding, root) {
  if (finding.object) return String(finding.object).trim();
  const file = normPath(finding.file ?? finding.path, root);
  const sym = normSymbol(finding.symbol ?? finding.anchor);
  return [lens, file, sym].join(SEP);
}

/**
 * Split an object key into its three parts. The lens part may be "*", meaning the entry applies
 * whatever lens found it. That matters because lenses overlap: a defect the performance sweep
 * ticketed last month is the same defect the bug hunt finds this week, and re-filing it is exactly
 * the noise this engine exists to prevent.
 */
function splitKey(key) {
  const parts = String(key).split(SEP);
  if (parts.length >= 3) {
    return { lens: parts[0], file: parts[1], symbol: parts.slice(2).join(SEP) };
  }
  if (parts.length === 2) return { lens: "*", file: parts[0], symbol: parts[1] };
  return { lens: "*", file: parts[0], symbol: "" };
}

function indexEntries(list, defaultLens, root) {
  const out = [];
  for (const raw of list || []) {
    const key = raw.object ? String(raw.object).trim() : objectKey(defaultLens, raw, root);
    const parts = splitKey(key);
    if (raw.lens) parts.lens = raw.lens;
    if (!parts.file || parts.file === "unanchored") continue;
    out.push({ ...raw, ...parts, key });
  }
  return out;
}

/**
 * An entry whose symbol is empty is FILE-SCOPED: an open ticket names something in that file, but
 * not which thing. It must never suppress a finding outright, because a second, different defect in
 * the same file would then be swallowed in silence, which is the failure this whole skill exists to
 * prevent. It downgrades to a "read that ticket before filing this" verdict instead.
 */
function matchEntry(entries, lensSlug, key) {
  const k = splitKey(key);
  const fileScoped = [];
  for (const e of entries) {
    if (e.lens !== "*" && e.lens !== lensSlug) continue;
    if (e.file !== k.file) continue;
    if (e.symbol && k.symbol) {
      if (e.symbol === k.symbol) return { entry: e, entries: [e], scope: "exact" };
      continue;
    }
    fileScoped.push(e);
  }
  // Several open tickets can name the same file. Reporting only the first would hide the others
  // from whoever has to decide whether this is the same defect, so return all of them.
  return fileScoped.length
    ? { entry: fileScoped[0], entries: fileScoped, scope: "file" }
    : null;
}

// ---------------------------------------------------------------------------
// lens resolution
// ---------------------------------------------------------------------------

function resolveLens(baseline, slug) {
  const lenses = baseline.lenses || {};
  const lens = lenses[slug];
  if (!lens) {
    const known = Object.keys(lenses).sort();
    if (!known.length) {
      return {
        slug,
        enabled: true,
        undeclared: true,
        rank: null,
        focus_areas: [],
        benign_patterns: [],
      };
    }
    die(
      `unknown lens "${slug}". The baseline declares: ${known.join(", ")}\n` +
        `  A lens the baseline does not declare has no focus areas, no evidence bar and no ` +
        `benign patterns, so a sweep of it would be unguided and would re-raise everything ` +
        `already reviewed.`,
    );
  }
  return { slug, undeclared: false, ...lens };
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

function daysBetween(thenISO, nowMs) {
  const t = Date.parse(thenISO);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}

function buildManifest(ctx) {
  const { baseline, lens, root, baselinePath, degraded, findings, suppression } = ctx;
  const nowMs = Date.now();
  const cfg = baseline.config || {};
  const maxMinutes = Number(lens.max_run_minutes ?? cfg.max_run_minutes ?? 0) || null;
  const deadline = maxMinutes ? new Date(nowMs + maxMinutes * 60_000).toISOString() : null;

  const accepted = indexEntries(baseline.accepted, lens.slug, root).filter(
    (a) => a.lens === "*" || a.lens === lens.slug,
  );
  const knownOpen = indexEntries(baseline.known_open, lens.slug, root).filter(
    (k) => k.lens === "*" || k.lens === lens.slug,
  );
  const unanchored = (baseline.known_open || []).filter(
    (k) => splitKey(k.object || "").file === "unanchored",
  );
  const benign = [
    ...(baseline.benign_patterns || []).filter((b) => !b.lens || b.lens === lens.slug || b.lens === "*"),
    ...(lens.benign_patterns || []).map((b) => (typeof b === "string" ? { pattern: b } : b)),
  ];

  const lastCompleted = lens.last_completed || null;
  const staleDays = lastCompleted ? daysBetween(lastCompleted, nowMs) : null;

  return {
    lens: lens.slug,
    rank: lens.rank ?? null,
    enabled: lens.enabled !== false,
    undeclared: !!lens.undeclared,
    root,
    baselinePath,
    findings: findings || { files: 0, known_open: 0, accepted: 0 },
    suppression: suppression || { verified: false, reason: "not checked", checked: 0, closed: 0, watch: [] },
    regressionWatch: indexEntries(baseline.regression_watch || [], lens.slug, root).filter(
      (k) => k.lens === "*" || k.lens === lens.slug,
    ),
    degraded,
    reviewFolder: lens.review_folder || null,
    labels: {
      family: cfg.family_label || null,
      lens: cfg.family_label ? `${cfg.family_label}-${lens.slug}` : null,
      topics: lens.topic_labels || [],
      datedFormat: cfg.dated_label_format || null,
      // Other recurring checks that read the same tree and file into the same tracker.
      // Without these the de-dup is blind to a sibling audit's ticket and duplicates it.
      siblings: cfg.sibling_labels || [],
    },
    focusAreas: lens.focus_areas || [],
    severityScale: lens.severity_scale || null,
    evidenceBar: lens.evidence_bar || null,
    granularity: lens.granularity || null,
    permissions: lens.permissions || [],
    preflight: lens.preflight || [],
    maxRunMinutes: maxMinutes,
    deadline,
    lastCompleted,
    staleDays,
    counts: {
      accepted: accepted.length,
      knownOpen: knownOpen.length,
      knownOpenFileScoped: knownOpen.filter((k) => !k.symbol).length,
      benign: benign.length,
      unanchored: unanchored.length,
    },
    unanchored: unanchored.map((k) => ({ ticket: k.ticket, summary: k.summary || "" })),
    benignPatterns: benign,
    doNotRaise: cfg.do_not_raise || [],
    nonSignals: cfg.non_signals || [],
  };
}

function printManifest(m) {
  const L = [];
  L.push(`LENS: ${m.lens}${m.rank != null ? `  (rank ${m.rank})` : ""}`);
  L.push(`ROOT: ${m.root}`);
  L.push(`BASELINE: ${m.baselinePath ?? "none found"}`);
  L.push(
    `FINDINGS: ${m.findings.files} per-run file(s) merged in ` +
      `(+${m.findings.known_open} known_open, +${m.findings.accepted} accepted)`,
  );
  const sup = m.suppression || {};
  if (sup.verified) {
    L.push(
      `SUPPRESSIONS: ${sup.checked} ticket(s) checked against the tracker, ` +
        `${sup.closed} closed`,
    );
    if ((m.regressionWatch || []).length) {
      L.push(
        `   ${m.regressionWatch.length} object(s) on this lens are REGRESSION WATCH: their ticket ` +
          `closed, so`,
      );
      L.push("   they are no longer suppressed. If you detect one again it is a regression of");
      L.push("   closed work. File it, and land it in human review rather than ready-for-dev.");
    }
  } else {
    L.push("!! SUPPRESSIONS ARE UNVERIFIED.");
    L.push(`   ${sup.reason || "the tracker was not consulted"}.`);
    L.push("   Every 'already ticketed, stay quiet' row below is a claim with no expiry check on");
    L.push("   it. A row whose ticket has since closed will mute that finding forever, which is");
    L.push("   the exact failure this sweep exists to catch. Report this line in the run record.");
  }
  L.push("");

  if (m.degraded) {
    L.push("!! NO BASELINE FOUND. Running degraded.");
    L.push("   Every finding will report NEW, because there is nothing to compare against.");
    L.push("   This is the correct first run for a project that has never been swept. It is NOT");
    L.push("   a list of emergencies, and it is NOT a reason to file a hundred tickets. Treat the");
    L.push("   output as the raw material for a first baseline.");
    L.push("");
  }
  if (m.undeclared) {
    L.push("!! THIS LENS IS NOT DECLARED IN THE BASELINE.");
    L.push("   It has no focus areas, no evidence bar and no benign patterns, so the sweep is");
    L.push("   unguided. Declare it before trusting the result.");
    L.push("");
  }
  if (m.enabled === false) {
    L.push("!! THIS LENS IS DISABLED in the baseline. Stop here and report it as disabled.");
    L.push("");
  }

  if (m.lastCompleted) {
    L.push(`LAST COMPLETED: ${m.lastCompleted}  (${m.staleDays} days ago)`);
    L.push("   Report this number. A lens that keeps losing its slot to a spent budget goes quiet");
    L.push("   rather than red, and this number is the only thing that makes that visible.");
  } else {
    L.push("LAST COMPLETED: never recorded");
  }
  if (m.deadline) {
    L.push(`DEADLINE: ${m.deadline}  (${m.maxRunMinutes} minutes from now)`);
    L.push("   Past it, stop fanning out, file what is already confirmed, and report PARTIAL.");
  } else {
    L.push("DEADLINE: none configured. Set max_run_minutes so a run cannot spill into a working day.");
  }
  L.push("");

  if (m.permissions.length) L.push(`PERMITTED THIS LENS: ${m.permissions.join("; ")}`);
  L.push("EVERYTHING ELSE IS READ-ONLY. No code edits, no migrations, no data writes, no commits,");
  L.push("no pull requests, nothing moved to Done.");
  L.push("");

  if (m.preflight.length) {
    L.push("PREFLIGHT — each of these must pass or the run is SKIPPED, never a clean pass:");
    for (const p of m.preflight) L.push(`  - ${p}`);
    L.push("");
  }

  L.push(`FOCUS AREAS (${m.focusAreas.length}):`);
  for (const f of m.focusAreas) L.push(`  - ${f}`);
  L.push("");

  if (m.severityScale) L.push(`SEVERITY: ${m.severityScale}`);
  if (m.evidenceBar) L.push(`EVIDENCE BAR: ${m.evidenceBar}`);
  if (m.granularity) L.push(`TICKET GRANULARITY: ${m.granularity}`);
  L.push("");

  if (m.labels.family) {
    L.push("LABELS for anything filed:");
    L.push(`  searched  ${m.labels.family}          the de-dup lookup, never dated`);
    L.push(`  searched  ${m.labels.lens}   which sweep found it, never dated`);
    for (const t of m.labels.topics) L.push(`  topic     ${t}`);
    if (m.labels.datedFormat) {
      L.push(`  output    ${m.labels.datedFormat}  built from TODAY's real date, never searched`);
    }
    L.push("");
    if (m.labels.siblings.length) {
      L.push("SEARCH THESE LABELS TOO, before filing anything:");
      for (const s of m.labels.siblings) L.push(`  sibling   ${s}`);
      L.push("  Another recurring check reads the same tree and files into the same tracker. A");
      L.push("  finding it ticketed hours ago carries ITS label, not this one, so a lookup scoped");
      L.push("  to this sweep's own label reports it as new and files a duplicate.");
      L.push("");
    }
  }

  if (m.nonSignals.length) {
    L.push("KNOWN NON-SIGNALS — never cite these as evidence:");
    for (const n of m.nonSignals) L.push(`  - ${n}`);
    L.push("");
  }

  if (m.doNotRaise.length) {
    L.push("DO NOT RAISE — settled by a human, re-raising them wastes the run:");
    for (const d of m.doNotRaise) {
      L.push(`  - ${d.topic ?? d}${d.reason ? `  (${d.reason})` : ""}`);
    }
    L.push("");
  }

  L.push(`BENIGN PATTERNS (${m.benignPatterns.length}) — these trip the sweep on purpose.`);
  L.push("Triage is a lookup here, not a fresh investigation each week:");
  for (const b of m.benignPatterns) {
    L.push(`  - ${b.pattern ?? b.object ?? "(unnamed)"}`);
    if (b.why) L.push(`      ${b.why}`);
  }
  L.push("");
  L.push(
    `ALREADY REVIEWED: ${m.counts.accepted} accepted exceptions, ` +
      `${m.counts.knownOpen} findings already on an open ticket ` +
      `(${m.counts.knownOpenFileScoped} of those name a file but not a symbol, so they downgrade to` +
      ` KNOWN-FILE and need the ticket read before anything is filed).`,
  );

  if (m.counts.unanchored) {
    L.push("");
    L.push(
      `UNANCHORED OPEN TICKETS (${m.counts.unanchored}) — real open work with no file to match on,`,
    );
    L.push("so the de-dup cannot catch these for you. Read them before filing anything similar:");
    for (const u of m.unanchored) L.push(`  ${u.ticket}  ${u.summary}`);
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

function loadFindings(p) {
  if (!existsSync(p)) die(`findings file not found: ${p}`);
  let obj;
  try {
    obj = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    die(`findings file is not valid JSON: ${p} (${e.message})`);
  }
  if (Array.isArray(obj)) obj = { findings: obj };
  if (!obj || typeof obj !== "object") die(`findings file must be an object or an array: ${p}`);
  if (!Array.isArray(obj.findings)) {
    die(`findings file has no "findings" array: ${p}. An empty sweep must send "findings": [].`);
  }
  return obj;
}

function classify(ctx, input, deadlineISO) {
  const { baseline, lens, root } = ctx;

  const accepted = indexEntries(baseline.accepted, lens.slug, root);
  const knownOpen = indexEntries(baseline.known_open, lens.slug, root);

  const rows = [];
  for (const f of input.findings) {
    const key = objectKey(lens.slug, f, root);
    const row = {
      object: key,
      severity: f.severity || "?",
      title: f.title || "",
      confirmed: f.confirmed !== false,
      unconfirmedReason: f.unconfirmedReason || f.unconfirmed_reason || null,
      detail: f.detail || "",
      file: normPath(f.file ?? f.path, root),
      line: f.line ?? null,
    };
    const acc = matchEntry(accepted, lens.slug, key);
    const open = matchEntry(knownOpen, lens.slug, key);
    if (acc) {
      row.status = "SUPPRESSED";
      row.reason =
        acc.entry.reason || "(no reason recorded, which is itself a defect in the baseline)";
      row.scope = acc.scope;
    } else if (open && open.scope === "exact") {
      row.ticket = open.entry.ticket || "(no key recorded)";
      row.tickets = [row.ticket];
      row.status = `KNOWN-OPEN ${row.ticket}`;
    } else if (open) {
      row.tickets = open.entries.map((e) => e.ticket || "(no key recorded)");
      // Carry each candidate's recorded summary so triage can rule a ticket in or out by
      // reading one line, instead of fetching every key a busy file happens to name.
      row.ticketSummaries = open.entries.map((e) => ({
        ticket: e.ticket || "(no key recorded)",
        summary: e.summary || "",
      }));
      row.ticket = row.tickets.join(", ");
      row.status = `KNOWN-FILE ${row.ticket}`;
    } else {
      row.status = "NEW";
    }
    rows.push(row);
  }

  const overdue = deadlineISO && Date.now() > Date.parse(deadlineISO);
  const notReached = [...(input.notReached || input.not_reached || [])];
  if (overdue && !notReached.length) {
    notReached.push(
      "the run passed its deadline, so any area not already swept was not swept at all",
    );
  }
  const claimed = String(input.runStatus || input.run_status || "COMPLETE").toUpperCase();
  const runStatus = overdue || notReached.length || claimed === "PARTIAL" ? "PARTIAL" : "COMPLETE";

  return {
    lens: lens.slug,
    runStatus,
    overdue: !!overdue,
    notReached,
    coverage: input.coverage || {},
    refuted: input.refuted || [],
    rows,
    totals: {
      total: rows.length,
      new: rows.filter((r) => r.status === "NEW").length,
      newConfirmed: rows.filter((r) => r.status === "NEW" && r.confirmed).length,
      newUnconfirmed: rows.filter((r) => r.status === "NEW" && !r.confirmed).length,
      knownOpen: rows.filter((r) => r.status.startsWith("KNOWN-OPEN")).length,
      knownFile: rows.filter((r) => r.status.startsWith("KNOWN-FILE")).length,
      suppressed: rows.filter((r) => r.status === "SUPPRESSED").length,
      refuted: (input.refuted || []).length,
    },
  };
}

function printClassified(c, degraded) {
  const L = [];
  const pad = (s, n) => String(s).padEnd(n);
  L.push(`RUN STATUS: ${c.runStatus}`);
  if (c.runStatus === "PARTIAL") {
    L.push("  Coverage is incomplete. The findings below are valid; the absence of others is not.");
    for (const n of c.notReached) L.push(`  did not reach: ${n}`);
  }
  if (c.overdue) L.push("  The deadline passed. COMPLETE is not available to this run.");
  if (degraded) L.push("  No baseline, so every row below reads NEW whether it is or not.");
  L.push("");

  if (!c.rows.length) {
    L.push("No rows.");
  } else {
    // The lens prefix is the same on every row, so it is dropped from the display only.
    const shortObj = (o) => o.replace(new RegExp("^" + c.lens + SEP), "");
    // A hot file can carry a dozen open tickets, and inlining them all makes the column
    // wider than the terminal and pushes the title off screen. So a long key list moves
    // to a footnote under the table. Nothing is dropped: every key is still printed, and
    // the count stays in the column so the size of the read is visible at a glance.
    const CELL = 24;
    const notes = [];
    const cell = (r) => {
      if (r.status.length <= CELL) return r.status;
      const keys = r.tickets && r.tickets.length ? r.tickets : [r.ticket];
      const n = notes.length + 1;
      const sums = r.ticketSummaries || keys.map((k) => ({ ticket: k, summary: "" }));
      const lines = sums.map(
        (s) => `      ${pad(s.ticket, 10)} ${s.summary ? s.summary.slice(0, 88) : "(no summary recorded)"}`,
      );
      notes.push([`  [${n}] ${shortObj(r.object)}`, ...lines].join("\n"));
      const head = r.status.slice(0, r.status.indexOf(" ")) || r.status;
      return `${head} (${keys.length}) [${n}]`;
    };
    const sorted = [...c.rows].sort((a, b) => {
      const rank = (s) =>
        s === "NEW" ? 0 : s.startsWith("KNOWN-FILE") ? 1 : s === "SUPPRESSED" ? 3 : 2;
      return (
        rank(a.status) - rank(b.status) || String(a.severity).localeCompare(String(b.severity))
      );
    });
    const cells = sorted.map(cell);
    const objW = Math.min(
      74,
      Math.max(18, ...c.rows.map((r) => shortObj(r.object).length)),
    );
    const statusW = Math.max(10, ...cells.map((s) => s.length));
    L.push(`${pad("SEV", 5)} ${pad("STATUS", statusW)} ${pad("OBJECT", objW)} TITLE`);
    sorted.forEach((r, i) => {
      L.push(
        `${pad(r.severity, 5)} ${pad(cells[i], statusW)} ` +
          `${pad(shortObj(r.object).slice(0, objW), objW)} ${r.title}`,
      );
    });
    if (notes.length) {
      L.push("");
      L.push("Every ticket key from the rows above, in full:");
      for (const n of notes) L.push(n);
    }
  }
  L.push("");
  const t = c.totals;
  L.push(
    `TOTALS: ${t.total} rows | NEW ${t.new} (${t.newConfirmed} confirmed, ` +
      `${t.newUnconfirmed} unconfirmed) | KNOWN-OPEN ${t.knownOpen} | ` +
      `KNOWN-FILE ${t.knownFile} | SUPPRESSED ${t.suppressed} | REFUTED ${t.refuted}`,
  );
  L.push("");
  if (t.knownFile) {
    L.push(
      `KNOWN-FILE is ${t.knownFile}. Each one shares a file with an open ticket but not a named`,
    );
    L.push("symbol, so the engine cannot tell whether it is the same defect. Read the ticket. If it");
    L.push("is the same, report KNOWN-OPEN and do not file. If it is a different defect in the same");
    L.push("file, file it. Neither dropping them nor filing them blind is acceptable.");
    L.push("A hot file can name a dozen tickets. Resolve that row by searching those ticket bodies");
    L.push("for the symbol and the line, not by reading each one end to end. If not one of them");
    L.push("names this symbol, it is a different defect in a busy file, and it gets filed.");
    L.push("");
  }
  L.push(
    `SUPPRESSED is ${t.suppressed}. Report that number even when it is boring: a baseline that`,
  );
  L.push("quietly grows is how a check dies, and the number is the only thing that makes it visible.");
  L.push("");
  L.push(`FILE ALL ${t.newConfirmed} confirmed NEW rows. There is no cap, no top-N, and no sampling.`);
  if (t.newUnconfirmed) {
    L.push(
      `The ${t.newUnconfirmed} unconfirmed NEW rows are filed too, marked as unconfirmed, never dropped.`,
    );
  }
  if (c.runStatus === "COMPLETE" && !t.new) {
    L.push("");
    L.push("Zero new findings AND every check executed. That is a genuine clean pass.");
  } else if (c.runStatus === "PARTIAL" && !t.new) {
    L.push("");
    L.push("Zero new findings, but coverage was incomplete. This is NOT a clean pass. Say so.");
  }

  // The object key is the whole de-dup. A key typed by hand from the triage notes reads fine
  // and matches nothing, because next week's finder emits the symbol the way the code spells
  // it, not the way a human tidied it up. That failure is silent and it inverts the feature:
  // the row comes back NEW and the ticket is filed a second time. So the engine hands back its
  // OWN keys, verbatim, and recording anything else is a mistake with no error message.
  const record = c.rows.filter(
    (r) => r.status === "NEW" || r.status.startsWith("KNOWN-FILE"),
  );
  if (record.length) {
    L.push("");
    L.push("-".repeat(78));
    L.push("BASELINE ROWS TO ADD AFTER FILING");
    L.push("-".repeat(78));
    L.push("Copy these object strings EXACTLY. Do not retype them, do not tidy the symbol, and do");
    L.push("not shorten a path. This is the same class of mistake as retyping a SQL function body:");
    L.push("it looks equivalent and it silently stops matching.");
    L.push("");
    L.push("For a NEW row, add it with the key you just filed. For a KNOWN-FILE row that you");
    L.push("resolved BY HAND to an existing open ticket, add it with THAT ticket's key: the engine");
    L.push("could not make that call, so if you do not record your answer the row returns as NEW");
    L.push("next week and duplicates a ticket that was already open.");
    L.push("");
    for (const r of record) {
      const t2 = r.status.startsWith("KNOWN-FILE") ? "LAB-????  <- the key YOU resolved it to" : "LAB-????";
      L.push(
        `  {"object": ${JSON.stringify(r.object)}, "ticket": "${t2}", "summary": ""}`,
      );
    }
    L.push("");
    L.push("A refuted finding does not go here. It goes in `accepted`, with the reason it was");
    L.push("refuted written out, so the same heuristic stops re-raising it every week.");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// render — the review document, so every lens's record reads alike
// ---------------------------------------------------------------------------

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function renderReview(c, lens, date, root, baseline) {
  const t = c.totals;
  const L = [];
  // Step 4d records every filed and hand-resolved row in the baseline before this runs, so the
  // baseline is where the keys come from. Reading them back rather than accepting them as an
  // argument makes the record self-checking: a row that shows "not recorded" here is a row whose
  // de-dup will fail next week, and that has to be visible in the document rather than only in
  // a transcript nobody re-reads.
  const filedIdx = new Map();
  for (const e of (baseline && baseline.known_open) || []) {
    const parts = String(e.object || "").split("::");
    if (parts.length < 3) continue;
    const slug = parts[0];
    if (slug !== "*" && slug !== lens.slug) continue;
    const k = parts.slice(1).join("::");
    if (!filedIdx.has(k)) filedIdx.set(k, []);
    if (e.ticket && !filedIdx.get(k).includes(e.ticket)) filedIdx.get(k).push(e.ticket);
  }
  const acceptedIdx = new Set(
    ((baseline && baseline.accepted) || []).map((e) =>
      String(e.object || "").split("::").slice(1).join("::"),
    ),
  );
  // The verdict on a KNOWN-FILE row is the operator's answer, not the engine's, and defaulting it
  // to "same defect, not re-filed" writes a false record: most of these rows are a DIFFERENT defect
  // in a busy file and they were filed. Recover the real answer from what Step 4d recorded. A row
  // whose baseline ticket is not one of the tickets it was checked against was filed fresh.
  const knownFileVerdict = (row) => {
    if (row.filedTicket) return `different defect, filed ${row.filedTicket}`;
    const k = String(row.object || "").split("::").slice(1).join("::");
    const recorded = filedIdx.get(k) || [];
    if (!recorded.length) {
      return acceptedIdx.has(k)
        ? "reviewed and accepted, not filed"
        : "not recorded in the baseline, so its de-dup will fail next run";
    }
    const checked = new Set(
      (row.tickets && row.tickets.length ? row.tickets : [row.ticket]).filter(Boolean),
    );
    const fresh = recorded.filter((t) => !checked.has(t));
    return fresh.length
      ? `different defect, filed ${fresh.join(", ")}`
      : `same defect as ${recorded.join(", ")}, not re-filed`;
  };
  const filedFor = (row) => {
    const k = String(row.object || "").split("::").slice(1).join("::");
    const hit = filedIdx.get(k);
    if (hit && hit.length) return hit.join(", ");
    // A refuted row is recorded in `accepted`, not `known_open`, and it has no ticket by design.
    // Saying "not recorded" there would read as a bookkeeping failure and send the next reader
    // hunting for a missing key, which is the opposite of what the refutation bought.
    if (acceptedIdx.has(k)) return "refuted, accepted in the baseline";
    return "(not recorded in the baseline, so its de-dup will fail next run)";
  };
  L.push(`# ${lens.title || lens.slug} sweep, ${date}`);
  L.push("");
  L.push(
    `Run status **${c.runStatus}**. ${t.total} rows: ${t.new} new, ${t.knownOpen} already tracked, ` +
      `${t.knownFile} sharing a file with an open ticket and checked by hand, ` +
      `${t.suppressed} reviewed and accepted, ${t.refuted} refuted.`,
  );
  L.push("");
  L.push(
    "This is a recommendation. Nothing was changed. The document stays as written afterwards, as " +
      "the record of what was true on that date.",
  );
  L.push("");

  L.push("## Coverage");
  L.push("");
  L.push("| What | Value |");
  L.push("| --- | --- |");
  L.push(`| Repository root | \`${root}\` |`);
  L.push(`| Run status | ${c.runStatus} |`);
  // A finder reports its coverage as whatever shape it found useful, and a nested object
  // stringifies to "[object Object]", which silently turns the one section that proves how much
  // of the tree was actually read into no evidence at all. So flatten instead of stringifying.
  const flat = (obj, prefix = "") => {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key);
      else L.push(`| ${mdEscape(key)} | ${mdEscape(Array.isArray(v) ? v.join(", ") : v)} |`);
    }
  };
  flat(c.coverage);
  L.push(`| Rows produced | ${t.total} |`);
  L.push("");
  if (c.runStatus === "PARTIAL") {
    L.push("This run did not reach everything it sweeps. Absence of a finding below is not evidence.");
    L.push("");
  }

  const section = (heading, rows, empty, cols, render) => {
    L.push(`## ${heading}`);
    L.push("");
    if (!rows.length) {
      L.push(empty);
      L.push("");
      return;
    }
    L.push(`| ${cols.join(" | ")} |`);
    L.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const r of rows) L.push(`| ${render(r).map(mdEscape).join(" | ")} |`);
    L.push("");
  };

  section(
    "New findings",
    c.rows.filter((r) => r.status === "NEW"),
    "None. Nothing turned up that was not already reviewed or already on a ticket.",
    ["Severity", "Object", "Finding", "Confirmed", "Ticket"],
    (r) => [
      r.severity,
      `\`${r.object}\``,
      r.title,
      r.confirmed ? "yes" : `no: ${r.unconfirmedReason || "not established"}`,
      r.filedTicket || filedFor(r),
    ],
  );

  section(
    "Already tracked",
    c.rows.filter((r) => r.status.startsWith("KNOWN-OPEN")),
    "None.",
    ["Severity", "Object", "Finding", "Ticket"],
    (r) => [r.severity, `\`${r.object}\``, r.title, r.ticket || ""],
  );

  section(
    "Same file as an open ticket, checked by hand",
    c.rows.filter((r) => r.status.startsWith("KNOWN-FILE")),
    "None.",
    ["Severity", "Object", "Finding", "Ticket read", "Verdict"],
    (r) => [
      r.severity,
      `\`${r.object}\``,
      r.title,
      r.ticket || "",
      knownFileVerdict(r),
    ],
  );

  section(
    "Reviewed and accepted",
    c.rows.filter((r) => r.status === "SUPPRESSED"),
    "None suppressed this run.",
    ["Object", "Finding", "Why it is fine"],
    (r) => [`\`${r.object}\``, r.title, r.reason || ""],
  );

  section(
    "Refuted",
    c.refuted,
    "None. Every candidate survived verification.",
    ["Finding", "Why it was refuted"],
    (r) => [r.title || r.finding || "", r.why || r.reason || ""],
  );

  L.push("## Anything left out");
  L.push("");
  if (c.notReached.length) {
    for (const n of c.notReached) L.push(`- ${n}`);
  } else {
    L.push("Nothing. Every area this lens sweeps was reached, and every row above was triaged.");
  }
  L.push("");
  L.push(
    "Nothing was capped. There is no top-N and no sampling: every confirmed finding was filed, and " +
      "findings sharing one root cause were folded into a single ticket rather than dropped.",
  );
  L.push("");
  return L.join("\n");
}

function renderIndexRow(c, lens, date, keys) {
  const t = c.totals;
  const headline =
    t.new === 0
      ? `${c.runStatus === "COMPLETE" ? "0 new findings" : "0 new findings, coverage incomplete"}, ` +
        `${t.knownOpen} already tracked, ${t.suppressed} reviewed and accepted`
      : `${t.new} new (${t.newConfirmed} confirmed), ${t.knownOpen} already tracked, ` +
        `${t.knownFile} checked against an open ticket by hand, ` +
        `${t.suppressed} reviewed and accepted, ${t.refuted} refuted`;
  const scope = (lens.focus_areas || []).length
    ? `${(lens.focus_areas || []).length} focus areas`
    : "";
  return (
    `| ${date} | [${date}.md](${date}.md) | ${mdEscape(scope)} | ${mdEscape(headline)} | ` +
    `${mdEscape(keys || "nothing filed")} |`
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(EXIT_COMPLETE);
  }

  const root = resolve(String(args.root || process.cwd()));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    die(
      `repo root not reachable: ${root}\n` +
        `  That is a skipped run, not a clean pass. Report "could not run".`,
    );
  }

  const namedBaseline = typeof args.baseline === "string" ? args.baseline : null;
  const { baseline, path: baselinePath, degraded, findings } = loadBaseline(root, namedBaseline);
  // Resolve every suppression against the tracker before anything reads one. See
  // verifySuppressions: a stored "still open" is a claim with an expiry date on it.
  const suppression = verifySuppressions(baseline);

  if (args.listLenses) {
    const entries = Object.entries(baseline.lenses || {})
      .map(([slug, l]) => ({ slug, rank: l.rank ?? 9999, enabled: l.enabled !== false, ...l }))
      .sort((a, b) => a.rank - b.rank);
    if (args.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    } else if (!entries.length) {
      process.stdout.write("No lenses declared in the baseline.\n");
    } else {
      for (const e of entries) {
        process.stdout.write(
          `${String(e.rank).padStart(3)}  ${e.slug.padEnd(24)} ` +
            `${e.enabled ? "enabled " : "DISABLED"}  ${e.title || ""}\n`,
        );
      }
    }
    process.exit(EXIT_COMPLETE);
  }

  if (!args.lens || args.lens === true) die("--lens is required. Use --list-lenses to see them.");
  const lens = resolveLens(baseline, String(args.lens));
  const ctx = { baseline, lens, root, baselinePath, degraded, findings, suppression };

  if (args.classify && args.classify !== true) {
    const input = loadFindings(String(args.classify));
    const deadline = typeof args.deadline === "string" ? args.deadline : null;
    const c = classify(ctx, input, deadline);
    process.stdout.write(
      (args.json ? JSON.stringify(c, null, 2) : printClassified(c, degraded)) + "\n",
    );
    process.exit(c.runStatus === "COMPLETE" ? EXIT_COMPLETE : EXIT_PARTIAL);
  }

  if (args.render && args.render !== true) {
    const date = typeof args.date === "string" ? args.date : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      die("--date is required with --render, in YYYY-MM-DD, read from the real clock at run time.");
    }
    let c;
    try {
      c = JSON.parse(readFileSync(String(args.render), "utf8"));
    } catch (e) {
      die(`classified file unreadable or invalid: ${args.render} (${e.message})`);
    }
    const keys = typeof args.keys === "string" ? args.keys : "";
    process.stdout.write(renderReview(c, lens, date, root, baseline));
    process.stdout.write("\n<!-- index row for this review type's README.md Runs table -->\n");
    process.stdout.write(renderIndexRow(c, lens, date, keys) + "\n");
    process.exit(c.runStatus === "COMPLETE" ? EXIT_COMPLETE : EXIT_PARTIAL);
  }

  const m = buildManifest(ctx);
  process.stdout.write((args.json ? JSON.stringify(m, null, 2) : printManifest(m)) + "\n");
  process.exit(EXIT_COMPLETE);
}

main();
