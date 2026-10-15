// Run with: node --test rls-audit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "rls-findings.mjs");

// One fresh findings folder per test, filled with { "<name>.json": <doc or raw text> }.
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), "rls-findings-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, "--findings-dir", dir], { encoding: "utf8" });
  return { code: r.status, sql: r.stdout, err: r.stderr };
}

const inserts = (sql, table) => {
  const m = sql.match(new RegExp(`INSERT INTO ${table} \\([^)]*\\) VALUES\\n([\\s\\S]*?);\\n`));
  return m ? m[1].split(",\n").map((l) => l.trim()) : [];
};

test("no findings folder: creates the tables and loads nothing", () => {
  const { code, sql } = run(join(tmpdir(), "rls-findings-does-not-exist"));
  assert.equal(code, 0);
  assert.match(sql, /CREATE TEMP TABLE IF NOT EXISTS rls_audit_accepted/);
  assert.match(sql, /CREATE TEMP TABLE IF NOT EXISTS rls_audit_known_open/);
  assert.doesNotMatch(sql, /DELETE|INSERT/);
});

test("object names: lens, schema and argument list are dropped; a policy keeps its ' :: '", () => {
  const dir = folder({
    "2026-10-01.json": {
      date: "2026-10-01",
      known_open: [
        { object: "rls-audit::public::get_lab_ids(_user_id uuid)", ticket: "ABC-1" },
        { object: "rls-audit::public::try_convert(_value numeric, _from_unit text, _to_u", ticket: "ABC-2" },
        { object: "rls-audit::public::docs :: docs_select", ticket: "ABC-3" },
        { object: "rls-audit::notes :: notes_select", ticket: "ABC-4" },
        { object: "rls-audit::is_member", ticket: "ABC-5" },
      ],
    },
  });
  const { code, sql } = run(dir);
  assert.equal(code, 0);
  assert.deepEqual(inserts(sql, "rls_audit_known_open"), [
    "('docs :: docs_select', 'ABC-3')",
    "('get_lab_ids', 'ABC-1')",
    "('is_member', 'ABC-5')",
    "('notes :: notes_select', 'ABC-4')",
    "('try_convert', 'ABC-2')",
  ]);
});

test("the newest row wins: a later known_open row replaces an earlier accepted one", () => {
  const dir = folder({
    "2026-10-01.json": {
      date: "2026-10-01",
      accepted: [{ object: "rls-audit::public::fn_a", check: "definer-anon-exec-unguarded", reason: "delegates" }],
    },
    "2026-10-08.json": {
      date: "2026-10-08",
      known_open: [{ object: "rls-audit::public::fn_a", ticket: "ABC-9" }],
    },
  });
  const { sql } = run(dir);
  assert.deepEqual(inserts(sql, "rls_audit_accepted"), []);
  assert.deepEqual(inserts(sql, "rls_audit_known_open"), ["('fn_a', 'ABC-9')"]);
  // The baseline's own rows for the object are cleared from both lists first.
  assert.match(sql, /DELETE FROM rls_audit_accepted WHERE objkey IN \('fn_a'\);/);
  assert.match(sql, /DELETE FROM rls_audit_known_open WHERE objkey IN \('fn_a'\);/);
});

test("the newest row wins: a re-pointed ticket replaces the old key", () => {
  const dir = folder({
    "2026-10-01.json": { date: "2026-10-01", known_open: [{ object: "rls-audit::public::fn_b", ticket: "ABC-1" }] },
    "2026-10-08.json": { date: "2026-10-08", known_open: [{ object: "rls-audit::public::fn_b", ticket: "ABC-2" }] },
  });
  assert.deepEqual(inserts(run(dir).sql, "rls_audit_known_open"), ["('fn_b', 'ABC-2')"]);
});

test("the file's date decides, not its name", () => {
  const dir = folder({
    "a.json": { date: "2026-10-08", known_open: [{ object: "rls-audit::public::fn_c", ticket: "ABC-NEW" }] },
    "b.json": { date: "2026-10-01", known_open: [{ object: "rls-audit::public::fn_c", ticket: "ABC-OLD" }] },
  });
  assert.deepEqual(inserts(run(dir).sql, "rls_audit_known_open"), ["('fn_c', 'ABC-NEW')"]);
});

test("a same-date tie leaves the object KNOWN-OPEN rather than accepted", () => {
  const dir = folder({
    "2026-10-01.json": {
      date: "2026-10-01",
      known_open: [{ object: "rls-audit::public::fn_d", ticket: "ABC-3" }],
      accepted: [{ object: "rls-audit::public::fn_d", check: "*", reason: "x" }],
    },
  });
  const { sql } = run(dir);
  assert.deepEqual(inserts(sql, "rls_audit_accepted"), []);
  assert.deepEqual(inserts(sql, "rls_audit_known_open"), ["('fn_d', 'ABC-3')"]);
});

test("an accepted row with no check is skipped and reported, never widened to '*'", () => {
  const dir = folder({
    "2026-10-01.json": {
      date: "2026-10-01",
      accepted: [
        { object: "rls-audit::public::fn_e", reason: "no check named" },
        { object: "rls-audit::public::fn_f", check: "definer-anon-exec-no-authuid", reason: "it's a wrapper" },
      ],
    },
  });
  const { code, sql, err } = run(dir);
  assert.equal(code, 0);
  assert.deepEqual(inserts(sql, "rls_audit_accepted"), [
    "('definer-anon-exec-no-authuid', 'fn_f', 'it''s a wrapper')",
  ]);
  assert.doesNotMatch(sql, /fn_e/);
  assert.match(err, /1 skipped/);
  assert.match(err, /fn_e.*names no check/);
});

test("a known_open row with no ticket is skipped and reported", () => {
  const dir = folder({
    "2026-10-01.json": { date: "2026-10-01", known_open: [{ object: "rls-audit::public::fn_g" }] },
  });
  const { sql, err } = run(dir);
  assert.doesNotMatch(sql, /INSERT/);
  assert.match(err, /fn_g.*names no ticket/);
});

test("a malformed findings file stops the run and prints no SQL", () => {
  const dir = folder({ "2026-10-01.json": "{ not json" });
  const { code, sql, err } = run(dir);
  assert.equal(code, 2);
  assert.equal(sql, "");
  assert.match(err, /not valid JSON/);
});

test("a row with no object stops the run", () => {
  const dir = folder({ "2026-10-01.json": { date: "2026-10-01", known_open: [{ ticket: "ABC-1" }] } });
  const { code, sql } = run(dir);
  assert.equal(code, 2);
  assert.equal(sql, "");
});
