// Run with: node --test quality-sweep/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "sweep-weekend.mjs");
const dir = mkdtempSync(join(tmpdir(), "sweep-weekend-"));

function calendar(name, body) {
  const path = join(dir, name);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  return path;
}

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const everyOther = calendar("every-other.json", {
  Labsistant: { every_weeks: 2, first_weekend: "2026-10-31" },
});

const verdict = (date) => run("Labsistant", "--calendar", everyOther, "--date", date).out.split(" ")[0];

test("no calendar file: every weekend is ON", () => {
  const r = run("Labsistant", "--calendar", join(dir, "missing.json"), "--date", "2026-10-17");
  assert.equal(r.code, 0);
  assert.match(r.out, /^ON {2}Labsistant sweeps every weekend: there is no /);
});

test("a project the calendar does not name: every weekend is ON", () => {
  const r = run("Assman", "--calendar", everyOther, "--date", "2026-10-17");
  assert.equal(r.code, 0);
  assert.match(r.out, /^ON {2}Assman sweeps every weekend: .* has no entry for it\.$/);
});

test("weekends before the first sweep weekend are OFF and name it", () => {
  for (const date of ["2026-10-14", "2026-10-17", "2026-10-19", "2026-10-24", "2026-10-30"]) {
    const r = run("Labsistant", "--calendar", everyOther, "--date", date);
    assert.equal(r.code, 0);
    assert.match(r.out, /^OFF .*Next sweep weekend: Saturday 2026-10-31\.$/, date);
  }
});

test("the first sweep weekend is ON from Saturday through the Wednesday review", () => {
  for (const date of ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06"]) {
    assert.equal(verdict(date), "ON", date);
  }
});

test("then every other weekend, across the clock change and the new year", () => {
  assert.equal(verdict("2026-11-07"), "OFF");
  assert.equal(verdict("2026-11-14"), "ON");
  assert.equal(verdict("2026-11-16"), "ON");
  assert.equal(verdict("2026-11-21"), "OFF");
  assert.equal(verdict("2026-12-26"), "ON");
  assert.equal(verdict("2027-01-02"), "OFF");
  assert.equal(verdict("2027-01-09"), "ON");
});

test("--next lists the coming sweep weekends", () => {
  const r = run("Labsistant", "--calendar", everyOther, "--date", "2026-10-14", "--next", "3");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.split("\n"), [
    "Labsistant sweep weekends (every 2 weeks, starting Saturday 2026-10-31):",
    "  Saturday 2026-10-31",
    "  Saturday 2026-11-14",
    "  Saturday 2026-11-28",
  ]);
});

test("a broken calendar exits 2 and says what is wrong", () => {
  const cases = [
    [calendar("bad-json.json", "{ not json"), /is not valid JSON/],
    [calendar("not-saturday.json", { Labsistant: { every_weeks: 2, first_weekend: "2026-11-01" } }), /not a Saturday/],
    [calendar("zero.json", { Labsistant: { every_weeks: 0, first_weekend: "2026-10-31" } }), /whole number, 1 or more/],
    [calendar("no-date.json", { Labsistant: { every_weeks: 2 } }), /must be a date written YYYY-MM-DD/],
  ];
  for (const [path, message] of cases) {
    const r = run("Labsistant", "--calendar", path, "--date", "2026-10-31");
    assert.equal(r.code, 2, path);
    assert.equal(r.out, "", path);
    assert.match(r.err, message, path);
  }
});
