// Run with: node --test docs-drift-audit/
// Drives the Python engine as a black box, so it needs python3 (3.11 or newer) on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "docs-drift-audit.py");

// A repo whose README names four paths that do not exist, so each is one broken-repo-path finding
// with the object "repo/README.md :: path:docs/<name>.md".
function repo({ baseline, findings }) {
  const root = mkdtempSync(join(tmpdir(), "docs-drift-"));
  const dir = join(root, "repo");
  mkdirSync(join(dir, "quality-sweep", "findings", "docs-drift"), { recursive: true });
  writeFileSync(
    join(dir, "README.md"),
    "# Test\n\n`docs/one.md` `docs/two.md` `docs/three.md` `docs/four.md`\n",
  );
  writeFileSync(join(dir, "quality-sweep", "docs-drift-baseline.toml"), baseline);
  for (const [name, body] of Object.entries(findings)) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    writeFileSync(join(dir, "quality-sweep", "findings", "docs-drift", name), text);
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(
    "python3",
    [ENGINE, "--repo", dir, "--baseline", join(dir, "quality-sweep", "docs-drift-baseline.toml"), "--format", "json"],
    { encoding: "utf8" },
  );
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const key = (name) => `repo/README.md :: path:docs/${name}.md`;
const row = (name) => `docs-drift::repo/README.md::path:docs/${name}.md`;

const BASELINE = `
[[known_open]]
objkey = "${key("one")}"
ticket = "BASE-1"

[[accepted]]
check = "broken-repo-path"
objkey = "${key("two")}"
reason = "accepted in the baseline"

[[known_open]]
objkey = "${key("three")}"
ticket = "BASE-3"
`;

test("the newest row for an object wins, and the baseline is the oldest layer", () => {
  const dir = repo({
    baseline: BASELINE,
    findings: {
      "2026-10-01.json": {
        date: "2026-10-01",
        known_open: [
          { object: row("one"), ticket: "MID-1" },
          { object: row("two"), ticket: "MID-2" },
          { object: row("four"), ticket: "MID-4" },
        ],
      },
      "2026-10-08.json": {
        date: "2026-10-08",
        known_open: [{ object: row("one"), ticket: "NEW-1" }],
        accepted: [{ object: row("four"), check: "broken-repo-path", reason: "fixed upstream" }],
      },
    },
  });
  const { code, out, err } = run(dir);
  assert.equal(code, 0, err);
  const report = JSON.parse(out);
  const status = Object.fromEntries(report.findings.map((f) => [f.object, f.status]));

  // Re-pointed twice: the latest ticket stands, not the baseline's or the first file's.
  assert.equal(status[key("one")], "KNOWN-OPEN NEW-1");
  // A file row replaces the baseline's acceptance of the same object.
  assert.equal(status[key("two")], "KNOWN-OPEN MID-2");
  // No file mentions it, so the baseline row stands untouched.
  assert.equal(status[key("three")], "KNOWN-OPEN BASE-3");
  // Ticketed first, accepted later: the acceptance stands and the finding is suppressed.
  assert.equal(status[key("four")], undefined);
  assert.deepEqual(report.accepted_suppressions.map((s) => s.object), [key("four")]);
});

test("the file's date decides, not its name", () => {
  const dir = repo({
    baseline: "",
    findings: {
      "a.json": { date: "2026-10-08", known_open: [{ object: row("one"), ticket: "NEWER" }] },
      "b.json": { date: "2026-10-01", known_open: [{ object: row("one"), ticket: "OLDER" }] },
    },
  });
  const report = JSON.parse(run(dir).out);
  const one = report.findings.find((f) => f.object === key("one"));
  assert.equal(one.status, "KNOWN-OPEN NEWER");
});

test("a malformed findings file stops the run", () => {
  const dir = repo({ baseline: "", findings: { "2026-10-01.json": "{ not json" } });
  const { code, err } = run(dir);
  assert.equal(code, 2);
  assert.match(err, /not valid JSON/);
});
