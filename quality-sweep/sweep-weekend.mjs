#!/usr/bin/env node
/**
 * sweep-weekend — is this a sweep weekend for this project?
 *
 * The scheduler can only repeat weekly: a cron line has no "every other week". So every routine in
 * a sweep family keeps its weekly slot and asks this script first. It prints one line that starts
 * with ON or OFF, and the routine stops on OFF.
 *
 * The calendar is ~/.claude/sweep-weekends.json, one entry per project, written by /sweep-init:
 *
 *   { "Labsistant": { "every_weeks": 2, "first_weekend": "2026-10-31" } }
 *
 * `first_weekend` is the Saturday of the first sweep weekend. It and every `every_weeks`-th weekend
 * after it are ON; every other weekend is OFF, including all of them before it. A project with no
 * entry sweeps every weekend, so a family that never opted in behaves exactly as before.
 *
 * A weekend is counted from its Saturday. Every routine maps its own day back to the most recent
 * Saturday, so the Monday collector, the Wednesday review and a run that started a day late all
 * agree with the Saturday lenses about which weekend they belong to.
 *
 *   node sweep-weekend.mjs <Project>                     today
 *   node sweep-weekend.mjs <Project> --date 2026-11-02   that day instead, to check the rule
 *   node sweep-weekend.mjs <Project> --next 6            the next six sweep weekends
 *   --calendar <path>                                    another calendar file (tests, cloud)
 *
 * Exit 0 for ON and OFF alike, and 2 only when the calendar itself is broken. A routine treats a
 * broken calendar as ON: an extra sweep costs one run, a sweep that quietly stops costs every
 * weekend after it.
 *
 * TIME RULE: nothing in this file may embed a date. The only date is the calendar's, and today is
 * read from the clock.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CALENDAR = join(homedir(), ".claude", "sweep-weekends.json");
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SATURDAY = 6;

function die(msg) {
  process.stderr.write(`sweep-weekend: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" || a === "--next" || a === "--calendar") {
      if (argv[i + 1] === undefined) die(`${a} needs a value`);
      out[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) die(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// days
// ---------------------------------------------------------------------------

// A day is held as UTC midnight of that calendar date, so adding weeks never crosses a
// daylight-saving change and a difference of two Saturdays is always a whole number of weeks.

function parseDay(text, what) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === "string" ? text : "");
  if (!m) die(`${what} must be a date written YYYY-MM-DD, got ${JSON.stringify(text)}`);
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (day.getUTCMonth() !== +m[2] - 1) die(`${what} ${text} is not a real date`);
  return day;
}

function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const show = (day) => day.toISOString().slice(0, 10);
const addWeeks = (day, n) => new Date(day.getTime() + n * WEEK_MS);
const saturdayOf = (day) =>
  new Date(day.getTime() - ((day.getUTCDay() - SATURDAY + 7) % 7) * DAY_MS);

// ---------------------------------------------------------------------------
// the rule
// ---------------------------------------------------------------------------

function loadRule(calendarPath, project) {
  if (!existsSync(calendarPath)) return null;
  let calendar;
  try {
    calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
  } catch (e) {
    die(`${calendarPath} is not valid JSON: ${e.message}`);
  }
  const entry = calendar[project];
  if (entry === undefined) return null;
  if (!Number.isInteger(entry.every_weeks) || entry.every_weeks < 1) {
    die(`${project}.every_weeks in ${calendarPath} must be a whole number, 1 or more`);
  }
  const first = parseDay(entry.first_weekend, `${project}.first_weekend in ${calendarPath}`);
  if (first.getUTCDay() !== SATURDAY) {
    die(`${project}.first_weekend in ${calendarPath} is ${entry.first_weekend}, which is not a Saturday`);
  }
  return { every: entry.every_weeks, first };
}

// The first sweep Saturday on or after this one.
function nextSweep(rule, saturday) {
  if (saturday < rule.first) return rule.first;
  const weeks = Math.round((saturday - rule.first) / WEEK_MS);
  const late = weeks % rule.every;
  return late === 0 ? saturday : addWeeks(saturday, rule.every - late);
}

function describe(rule) {
  const every = rule.every === 1 ? "every weekend" : `every ${rule.every} weeks`;
  return `${every}, starting Saturday ${show(rule.first)}`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const project = args._[0];
if (!project || args._.length > 1) {
  die("usage: sweep-weekend.mjs <Project> [--date YYYY-MM-DD] [--next N] [--calendar <path>]");
}
const calendarPath = args.calendar ?? DEFAULT_CALENDAR;
const shownPath = args.calendar ?? "~/.claude/sweep-weekends.json";
const rule = loadRule(calendarPath, project);
const saturday = saturdayOf(args.date ? parseDay(args.date, "--date") : today());

if (args.next !== undefined) {
  const count = Number(args.next);
  if (!Number.isInteger(count) || count < 1) die(`--next must be a whole number, 1 or more`);
  const effective = rule ?? { every: 1, first: saturday };
  console.log(`${project} sweep weekends (${rule ? describe(rule) : "every weekend, no calendar entry"}):`);
  let day = nextSweep(effective, saturday);
  for (let i = 0; i < count; i++, day = addWeeks(day, effective.every)) {
    console.log(`  Saturday ${show(day)}`);
  }
} else if (!rule) {
  const why = existsSync(calendarPath) ? `${shownPath} has no entry for it` : `there is no ${shownPath}`;
  console.log(`ON  ${project} sweeps every weekend: ${why}.`);
} else if (nextSweep(rule, saturday).getTime() === saturday.getTime()) {
  console.log(`ON  ${project} sweeps the weekend of Saturday ${show(saturday)} (${describe(rule)}).`);
} else {
  console.log(
    `OFF ${project} does not sweep the weekend of Saturday ${show(saturday)} (${describe(rule)}). ` +
      `Next sweep weekend: Saturday ${show(nextSweep(rule, saturday))}.`,
  );
}
