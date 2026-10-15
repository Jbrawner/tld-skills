#!/usr/bin/env node
// rls-findings — turns a repo's rls-audit findings files into SQL the engine can read.
//
// rls-audit.sql is plain psql and cannot read JSON. Every /rls-audit run writes one immutable
// file at <root>/quality-sweep/findings/rls-audit/<date>.json listing what it accepted and what
// it ticketed. Those sign-offs only count on the next run if they reach rls_audit_accepted and
// rls_audit_known_open, so this prints the SQL that puts them there. It runs between the baseline
// and the engine, in the same psql session:
//
//   node rls-findings.mjs --root <repo-root> > "$FINDINGS_SQL" &&
//   psql "$CONN" -f <baseline> -f "$FINDINGS_SQL" -f rls-audit.sql
//
// Write the SQL to a file and chain with &&. Never pipe it into psql or pass it as <(...): a
// loader that died would hand psql an empty file, and the engine would run as if no run had ever
// recorded anything.
//
// Usage:
//   node rls-findings.mjs [--root <repo-root>] [--findings-dir <dir>]
//
// Exit codes: 0 = SQL printed (possibly with no rows), 2 = could not run (nothing printed).
// What was loaded and every row that was skipped, with why, goes to stderr.
//
// TIME RULE: nothing in this file may embed a date, a month, a year, or a ticket key.

import fs from 'node:fs';
import path from 'node:path';

function die(msg) {
  process.stderr.write(`rls-findings: could not run: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const a = { root: process.cwd(), findingsDir: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') a.root = argv[++i];
    else if (argv[i] === '--findings-dir') a.findingsDir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true;
    else die(`unknown argument: ${argv[i]}`);
  }
  return a;
}

// ---------------------------------------------------------------- object names
//
// A findings row names its object "rls-audit::<schema>::<name>", where <name> is what the engine
// matches on: the function name, or "table :: policy". The engine's key has no schema and no
// argument list, so both are dropped: "rls-audit::public::try_convert_quantity(numeric,text,text)"
// becomes "try_convert_quantity". A row written as "rls-audit::<name>" works too. This is the
// only place that translation lives.
const FINDINGS_PREFIX = 'rls-audit::';

function objkeyOf(object) {
  let key = object.startsWith(FINDINGS_PREFIX) ? object.slice(FINDINGS_PREFIX.length) : object;
  // The schema is one word straight before "::". A policy's " :: " has spaces, so it never matches.
  key = key.replace(/^[^\s:]+::/, '');
  // The OBJECT column prints a function as name(args); the engine matches the name alone.
  // Everything from the first "(" goes, closed or not: rows recorded while the engine still cut
  // that column at 63 bytes hold a long signature with no closing parenthesis.
  key = key.replace(/^([A-Za-z_][A-Za-z0-9_$]*)\(.*$/s, '$1');
  return key.trim();
}

// ---------------------------------------------------------------- findings files
//
// THE NEWEST ROW FOR AN OBJECT WINS, whichever list it is in, the same rule quality-sweep.mjs and
// test-audit.mjs apply. A row is a decision made on a date, and the latest one stands: a later run
// can re-point an object at the open ticket that took the work over, or file one it had accepted.
// The baseline is the oldest layer. It is SQL this script cannot read, so the printed SQL deletes
// the baseline's rows for every object a file decides and inserts the standing row in their place.
// Objects no file mentions keep exactly the rows the baseline gave them.
//
// Two rows for one object on the same date: the one read later wins, and known_open is read after
// accepted, so a tie leaves the finding visible as KNOWN-OPEN rather than suppressed.
//
// An accepted row must name its check, as every baseline row does. Without one it would have to
// mean '*', which also silences the HIGH invariants such as definer-no-search-path for that object,
// and a missing field must never widen a security sign-off. Such a row is skipped and reported, so
// the object comes back NEW and is recorded again with its check.
//
// A malformed findings file is fatal: it must never be read as an empty one, or every object it
// records comes back NEW and is triaged and filed again.
function mergeFindings(dir) {
  const stat = { files: 0, accepted: 0, known_open: 0, skipped: [] };
  const standing = new Map();
  if (!fs.existsSync(dir)) return { stat, standing };

  const consider = (list, row, date) => {
    const prev = standing.get(row.objkey);
    if (prev && date < prev.date) return;
    standing.set(row.objkey, { list, row, date });
  };

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const p = path.join(dir, f);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { die(`findings file is not valid JSON: ${p} (${e.message}). A malformed findings file must never be read as an empty one.`); }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) die(`findings file must be a JSON object: ${p}`);
    stat.files += 1;
    const date = typeof doc.date === 'string' ? doc.date : f.slice(0, -'.json'.length);

    for (const key of ['accepted', 'known_open']) {
      const rows = doc[key];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) die(`findings file key "${key}" must be an array: ${p}`);
      for (const row of rows) {
        if (!row || typeof row.object !== 'string') die(`findings row is missing a string "object" identity: ${p}`);
        const objkey = objkeyOf(row.object);
        const skip = (why) => stat.skipped.push(`${f} ${key} "${row.object}": ${why}`);
        if (!objkey) { skip('the object names nothing once the lens and schema are dropped'); continue; }
        if (key === 'accepted') {
          if (typeof row.check !== 'string' || !row.check.trim()) {
            skip('names no check; record the check_name it came up under, or "*" on purpose');
            continue;
          }
          consider(key, { objkey, check: row.check.trim(), reason: row.reason || '(no reason recorded)' }, date);
        } else {
          if (typeof row.ticket !== 'string' || !row.ticket.trim()) { skip('names no ticket'); continue; }
          consider(key, { objkey, ticket: row.ticket.trim() }, date);
        }
      }
    }
  }
  for (const { list } of standing.values()) stat[list] += 1;
  return { stat, standing };
}

// ---------------------------------------------------------------- sql

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function renderSql(dir, stat, standing) {
  const objkeys = [...standing.keys()].sort();
  const accepted = objkeys.filter((k) => standing.get(k).list === 'accepted').map((k) => standing.get(k).row);
  const knownOpen = objkeys.filter((k) => standing.get(k).list === 'known_open').map((k) => standing.get(k).row);

  const out = [
    `-- Generated by rls-findings.mjs from ${stat.files} findings file(s) in ${dir}.`,
    '-- Each row below is the newest decision recorded for its object and replaces the baseline\'s rows for it.',
    // The engine's own config literals rely on this, and so does the quoting below.
    'SET standard_conforming_strings = on;',
    // The baseline has usually created both tables already; skip the "already exists" notices.
    'SET client_min_messages TO warning;',
    'CREATE TEMP TABLE IF NOT EXISTS rls_audit_accepted (check_name text, objkey text, reason text);',
    'CREATE TEMP TABLE IF NOT EXISTS rls_audit_known_open (objkey text, ticket text);',
  ];
  if (objkeys.length) {
    const list = objkeys.map(lit).join(', ');
    out.push(`DELETE FROM rls_audit_accepted WHERE objkey IN (${list});`);
    out.push(`DELETE FROM rls_audit_known_open WHERE objkey IN (${list});`);
  }
  if (accepted.length) {
    out.push('INSERT INTO rls_audit_accepted (check_name, objkey, reason) VALUES');
    out.push(accepted.map((r) => `  (${lit(r.check)}, ${lit(r.objkey)}, ${lit(r.reason)})`).join(',\n') + ';');
  }
  if (knownOpen.length) {
    out.push('INSERT INTO rls_audit_known_open (objkey, ticket) VALUES');
    out.push(knownOpen.map((r) => `  (${lit(r.objkey)}, ${lit(r.ticket)})`).join(',\n') + ';');
  }
  return out.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write('usage: node rls-findings.mjs [--root <repo-root>] [--findings-dir <dir>]\n');
    return;
  }
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) die(`root does not exist: ${root}`);
  const dir = args.findingsDir
    ? path.resolve(args.findingsDir)
    : path.join(root, 'quality-sweep', 'findings', 'rls-audit');

  const { stat, standing } = mergeFindings(dir);
  process.stdout.write(renderSql(dir, stat, standing));

  const lines = [
    `rls-findings: ${stat.files} findings file(s) in ${dir}; loaded ${stat.accepted} accepted and ${stat.known_open} known_open row(s), ${stat.skipped.length} skipped.`,
    ...stat.skipped.map((s) => `  skipped: ${s}`),
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

main();
