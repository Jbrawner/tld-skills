// Run with: node --test close-out/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "sweep-read.mjs");
const root = mkdtempSync(join(tmpdir(), "sweep-read-"));
const projects = join(root, "projects");

// --- transcript lines, shaped like the desktop app's .jsonl -------------

const title = (customTitle) => ({ type: "custom-title", customTitle });
const human = (text) => ({ type: "user", origin: { kind: "human" }, message: { role: "user", content: text } });
const handBack = (text) => ({ type: "user", origin: { kind: "peer" }, message: { role: "user", content: text } });
const skillBody = (text) => ({ type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text }] } });
const say = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const call = (name, input, id = "t1") => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const result = (id, content = "ok") => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
});
const wrapUp = (input) => call("mcp__ccd_turn__wrap_up", input, "w1");
const plan = (input) => call("mcp__ccd_turn__update_plan", input, "p1");

const folderFor = (cwd) => join(projects, cwd.replace(/[^A-Za-z0-9-]/g, "-"));

let n = 0;
function transcript(cwd, lines, { ageSeconds = 0, firstLine } = {}) {
  const folder = folderFor(cwd);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `t${++n}.jsonl`);
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(path, (firstLine ?? "") + body);
  const when = Date.now() / 1000 - ageSeconds;
  utimesSync(path, when, when);
  return path;
}

function cwdFor(name) {
  return join(root, "Code", ".claude", "worktrees", name);
}

function run(sessions, ...extra) {
  const file = join(root, `sessions-${++n}.json`);
  writeFileSync(file, JSON.stringify(sessions));
  const r = spawnSync(process.execPath, [SCRIPT, "--sessions", file, "--projects", projects, ...extra], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const one = (session, ...extra) => run([session], ...extra)[0];
const session = (name, sessionTitle) => ({ sessionId: `local_${name}`, title: sessionTitle, cwd: cwdFor(name) });

// --- finding the transcript ----------------------------------------------

test("finds the transcript in the folder named after the cwd, every dot and space a dash", () => {
  const s = session("dotted folder.v2", "Dotted");
  const path = transcript(s.cwd, [title("Dotted"), human("hi"), say("Done.")]);
  const out = one(s);
  assert.equal(out.transcript, path);
  assert.equal(out.transcriptMatch, "by title");
});

test("picks the transcript whose title matches, not the newest one in a reused folder", () => {
  const s = session("reused", "Mine");
  const mine = transcript(s.cwd, [title("Mine"), human("hi"), say("Done.")], { ageSeconds: 3600 });
  transcript(s.cwd, [title("Someone else"), human("hi"), say("Done.")]);
  const out = one(s);
  assert.equal(out.transcript, mine);
  assert.equal(out.transcriptMatch, "by title");
});

test("finds the title line even when it was written only once, before the tail", () => {
  const s = session("title-early", "Scheduled sweep");
  const filler = JSON.stringify({ type: "user", message: { content: "x".repeat(200000) } });
  const folder = folderFor(s.cwd);
  mkdirSync(folder, { recursive: true });
  const mine = join(folder, "early.jsonl");
  writeFileSync(
    mine,
    [title("Scheduled sweep"), JSON.parse(filler), human("go"), say("Done.")].map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  utimesSync(mine, Date.now() / 1000 - 600, Date.now() / 1000 - 600);
  transcript(s.cwd, [title("Another sweep"), human("go"), say("Done.")]);
  const out = one(s, "--tail-bytes", "5000");
  assert.equal(out.transcript, mine);
  assert.equal(out.transcriptMatch, "by title");
});

test("several transcripts and none with the title: not found", () => {
  const s = session("no-match", "Mine");
  transcript(s.cwd, [title("A"), human("hi")], { ageSeconds: 60 });
  transcript(s.cwd, [title("B"), human("hi")]);
  const out = one(s);
  assert.equal(out.transcript, null);
  assert.equal(out.transcriptMatch, "not found");
});

test("a single transcript under another title is used, marked as the only file", () => {
  const s = session("only-file", "Renamed");
  const path = transcript(s.cwd, [title("Old name"), human("hi"), say("Done.")]);
  const out = one(s);
  assert.equal(out.transcript, path);
  assert.equal(out.transcriptMatch, "only file");
});

test("no folder for the cwd: no transcripts", () => {
  const out = one(session("never-ran", "Ghost"));
  assert.equal(out.transcript, null);
  assert.equal(out.transcriptMatch, "no transcripts");
});

// --- questions waiting on the user ------------------------------------------

test("a question in the next-step box with no reply is waiting", () => {
  const s = session("box-open", "Box");
  transcript(s.cwd, [title("Box"), human("do it"), say("Done."), wrapUp({ recap: "Built it.", ask: "Open the PR?" })]);
  assert.deepEqual(one(s).waiting, { kind: "next-step box", text: "Open the PR?" });
});

test("a reply typed after the box clears it", () => {
  const s = session("box-answered", "Box2");
  transcript(s.cwd, [
    title("Box2"),
    human("do it"),
    wrapUp({ recap: "Built it.", ask: "Open the PR?" }),
    human("1"),
    say("PR opened."),
  ]);
  assert.equal(one(s).waiting, null);
});

test("a subagent hand-back or a skill body is not a reply", () => {
  const s = session("box-handback", "Box3");
  transcript(s.cwd, [
    title("Box3"),
    human("do it"),
    wrapUp({ recap: "Built it.", ask: "Open the PR?" }),
    handBack("[Subagent hand-back] all done"),
    skillBody("Base directory for this skill: /x"),
  ]);
  assert.equal(one(s).waiting?.kind, "next-step box");
});

test("an AskUserQuestion is waiting until its answer comes back", () => {
  const s = session("ask-open", "Ask");
  transcript(s.cwd, [
    title("Ask"),
    human("go"),
    call("AskUserQuestion", { questions: [{ question: "Which lane?" }] }, "q1"),
  ]);
  assert.deepEqual(one(s).waiting, { kind: "question tool", text: "Which lane?" });

  const t = session("ask-answered", "Ask2");
  transcript(t.cwd, [
    title("Ask2"),
    human("go"),
    call("AskUserQuestion", { questions: [{ question: "Which lane?" }] }, "q1"),
    result("q1", "Lane 2"),
    say("Using lane 2. Done."),
  ]);
  assert.equal(one(t).waiting, null);
});

test("numbered options at the end of the last message are waiting", () => {
  const s = session("options", "Opts");
  transcript(s.cwd, [
    title("Opts"),
    human("what now?"),
    say("| a | b |\n|---|---|\n| 1 | 2 |\n\n1. Ship it (Recommended)\n2. Hold it"),
  ]);
  const out = one(s);
  assert.equal(out.waiting?.kind, "numbered options");
  assert.match(out.waiting.text, /Ship it/);
});

test("a last message that ends on a question is waiting", () => {
  const s = session("question", "Q");
  transcript(s.cwd, [title("Q"), human("go"), say("I found two configs. Which one should win?")]);
  assert.equal(one(s).waiting?.kind, "question");
});

test("a plain final report is not waiting", () => {
  const s = session("report", "R");
  transcript(s.cwd, [title("R"), human("go"), say("Merged as PR 12. Nothing left.")]);
  const out = one(s);
  assert.equal(out.waiting, null);
  assert.match(out.lastText, /Nothing left/);
});

// --- task list and recap ----------------------------------------------------

test("task-list steps not done stay open unless a wrap-up followed", () => {
  const items = [
    { content: "Read", status: "in_progress" },
    { content: "Edit", status: "pending" },
    { content: "Test", status: "pending" },
  ];
  const s = session("steps-open", "Steps");
  transcript(s.cwd, [title("Steps"), human("go"), plan({ items }), plan({ advance: true })]);
  assert.deepEqual(one(s).openSteps, ["Edit", "Test"]);

  const t = session("steps-done", "Steps2");
  transcript(t.cwd, [title("Steps2"), human("go"), plan({ items }), plan({ done: [1, 2], start: 3 })]);
  assert.deepEqual(one(t).openSteps, ["Test"]);

  const u = session("steps-wrapped", "Steps3");
  transcript(u.cwd, [title("Steps3"), human("go"), plan({ items }), wrapUp({ recap: "All done." })]);
  const out = one(u);
  assert.deepEqual(out.openSteps, []);
  assert.equal(out.recap, "All done.");
});

test("reads only the tail of a long transcript", () => {
  const s = session("long", "Long");
  const filler = JSON.stringify({ type: "user", message: { content: "x".repeat(200000) } }) + "\n";
  transcript(s.cwd, [title("Long"), human("go"), wrapUp({ recap: "r", ask: "Merge it?" })], { firstLine: filler });
  const out = one(s, "--tail-bytes", "5000");
  assert.equal(out.transcriptMatch, "by title");
  assert.equal(out.waiting?.text, "Merge it?");
});

// --- git state seen from outside ---------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("git: counts uncommitted files, commits on no remote, and stashes made on its branch", () => {
  const origin = join(root, "origin.git");
  mkdirSync(origin);
  git(origin, "init", "--bare", "-q");
  const s = session("repo", "Repo");
  mkdirSync(s.cwd, { recursive: true });
  git(s.cwd, "init", "-q", "-b", "feature/x");
  git(s.cwd, "remote", "add", "origin", origin);
  writeFileSync(join(s.cwd, "a.txt"), "1");
  git(s.cwd, "add", "a.txt");
  git(s.cwd, "commit", "-q", "-m", "pushed");
  git(s.cwd, "push", "-q", "origin", "feature/x");
  git(s.cwd, "remote", "set-url", "origin", "git@github.com:Acme/widgets.git");
  writeFileSync(join(s.cwd, "a.txt"), "2");
  git(s.cwd, "commit", "-q", "-am", "local only");
  writeFileSync(join(s.cwd, "a.txt"), "3");
  git(s.cwd, "stash", "push", "-q", "-m", "parked");
  writeFileSync(join(s.cwd, "b.txt"), "new");

  const out = one(s);
  assert.equal(out.folder, "present");
  assert.equal(out.git.branch, "feature/x");
  assert.equal(out.git.uncommitted, 1);
  assert.equal(out.git.localOnlyCommits, 1);
  assert.equal(out.git.stashesOnBranch, 1);
  assert.equal(out.git.repo, "Acme/widgets");
  assert.match(out.git.head, /^[0-9a-f]{40}$/);
});

test("a folder that is not a git repo reports no git", () => {
  const s = session("plain-folder", "Plain");
  mkdirSync(s.cwd, { recursive: true });
  const out = one(s);
  assert.equal(out.folder, "present");
  assert.equal(out.git, null);
});

test("a folder that is gone reports missing", () => {
  const out = one(session("cleaned-up", "Gone"));
  assert.equal(out.folder, "missing");
  assert.equal(out.git, null);
});

// --- shared folders -----------------------------------------------------------

test("sessions in the same folder name each other, and the hub's folder is flagged", () => {
  const a = session("shared", "A");
  const b = { ...session("shared", "B"), sessionId: "local_shared_b" };
  const c = session("alone", "C");
  const out = run([a, b, c], "--hub-cwd", a.cwd);
  assert.deepEqual(out[0].sharesFolderWith, ["local_shared_b"]);
  assert.deepEqual(out[1].sharesFolderWith, ["local_shared"]);
  assert.equal(out[0].sharesHubFolder, true);
  assert.equal(out[2].sharesHubFolder, false);
  assert.deepEqual(out[2].sharesFolderWith, []);
});
