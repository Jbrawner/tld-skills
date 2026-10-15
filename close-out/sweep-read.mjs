#!/usr/bin/env node
// Read what can be read about other sessions from outside them, for `/close-out all`.
//
//   node sweep-read.mjs --sessions <file> [--hub-cwd <dir>] [--projects <dir>] [--tail-bytes <n>]
//
// --sessions    the JSON array list_sessions returned (sessionId, title, cwd per entry)
// --hub-cwd     the folder the sweeping session works in; sessions in the same folder are flagged
// --projects    where transcripts live (default ~/.claude/projects)
// --tail-bytes  how much of each transcript's end to read (default 1 MB; transcripts pass 25 MB)
//
// Prints a JSON array, one session per line, in the order given. Reads only: it runs git
// commands that change nothing and opens transcripts for reading.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { projects: join(homedir(), ".claude", "projects"), tailBytes: 1_000_000, hubCwd: null };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    if (argv[i] === "--sessions") args.sessions = next();
    else if (argv[i] === "--hub-cwd") args.hubCwd = next();
    else if (argv[i] === "--projects") args.projects = next();
    else if (argv[i] === "--tail-bytes") args.tailBytes = Number(next());
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.sessions) throw new Error("--sessions <file> is required");
  return args;
}

// --- transcript -------------------------------------------------------------

// The app names a session's transcript folder after its cwd, with every character other
// than a letter, digit or dash turned into a dash: /a/.claude/b c -> -a--claude-b-c
const transcriptFolder = (projects, cwd) => join(projects, cwd.replace(/[^A-Za-z0-9-]/g, "-"));

function readTail(path, bytes) {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift(); // the first line was cut part-way
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a line still being written, or not JSON: skip it
    }
  }
  return entries;
}

const lastTitle = (entries) => entries.findLast((e) => e.type === "custom-title")?.customTitle ?? null;

// Most sessions repeat their title line every turn; a scheduled run may write it once, at the
// start. When the tail holds no title line, look for it in the whole file.
function lastTitleInFile(path) {
  const titleLines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.includes('"custom-title"'));
  for (const line of titleLines.reverse()) {
    try {
      return JSON.parse(line).customTitle ?? null;
    } catch {
      // not a whole line: try the one before
    }
  }
  return null;
}

// A recycled worktree folder holds transcripts of earlier sessions too, so the newest file
// is not always this session's. Match on the title line the app writes into each transcript.
function findTranscript(projects, cwd, title, tailBytes) {
  const folder = transcriptFolder(projects, cwd);
  const files = existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(folder, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (files.length === 0) return { path: null, match: "no transcripts", entries: [] };
  for (const path of files) {
    const entries = readTail(path, tailBytes);
    const found = lastTitle(entries) ?? lastTitleInFile(path);
    if (found === title) return { path, match: "by title", entries };
  }
  if (files.length === 1) return { path: files[0], match: "only file", entries: readTail(files[0], tailBytes) };
  return { path: null, match: "not found", entries: [] };
}

const blocks = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);
const isToolResult = (e) => blocks(e).some((b) => b.type === "tool_result");

// Only a message the user typed answers a question. Subagent hand-backs, skill bodies,
// side-session and CI events arrive as user lines too, without origin kind "human".
function isUserTyped(e, transcriptHasOrigins) {
  if (e.type !== "user" || e.isMeta || isToolResult(e)) return false;
  return transcriptHasOrigins ? e.origin?.kind === "human" : true;
}

const NUMBERED_LINE = /^\s*(\*\*)?\d+[.)]\s/;

function readTranscript(entries) {
  const hasOrigins = entries.some((e) => e.origin?.kind);
  let lastUserIndex = -1;
  entries.forEach((e, i) => {
    if (isUserTyped(e, hasOrigins)) lastUserIndex = i;
  });

  let steps = [];
  let recap = null;
  let boxAsk = null;
  let lastText = null;
  const openQuestions = new Map();

  entries.forEach((e, i) => {
    const afterUser = i > lastUserIndex;
    for (const b of blocks(e)) {
      if (b.type === "tool_result" && afterUser) openQuestions.delete(b.tool_use_id);
      if (e.type !== "assistant") continue;
      if (b.type === "text" && b.text.trim()) lastText = afterUser ? b.text : null;
      if (b.type !== "tool_use") continue;
      const name = b.name ?? "";
      const input = b.input ?? {};
      if (name.endsWith("__update_plan")) steps = applyPlan(steps, input);
      if (name.endsWith("__wrap_up")) {
        steps = steps.map((s) => ({ ...s, status: "completed" })); // wrap_up checks off the list
        recap = input.recap ?? recap;
        if (afterUser && input.ask) boxAsk = input.ask;
      }
      if (name === "AskUserQuestion" && afterUser) {
        openQuestions.set(b.id, (input.questions ?? []).map((q) => q.question).join(" / "));
      }
    }
  });

  return {
    waiting: waitingQuestion(openQuestions, boxAsk, lastText),
    openSteps: steps.filter((s) => s.status !== "completed").map((s) => s.content),
    recap,
    lastText: lastText ? lastText.trim().slice(-300) : null,
  };
}

function applyPlan(steps, input) {
  if (Array.isArray(input.items)) steps = input.items.map((s) => ({ content: s.content, status: s.status }));
  steps = steps.map((s) => ({ ...s }));
  if (input.advance) {
    const current = steps.findIndex((s) => s.status === "in_progress");
    if (current >= 0) steps[current].status = "completed";
    const next = steps.findIndex((s) => s.status === "pending");
    if (next >= 0) steps[next].status = "in_progress";
  }
  for (const n of input.done ?? []) if (steps[n - 1]) steps[n - 1].status = "completed";
  if (input.start && steps[input.start - 1]) steps[input.start - 1].status = "in_progress";
  return steps;
}

function waitingQuestion(openQuestions, boxAsk, lastText) {
  if (openQuestions.size) return { kind: "question tool", text: [...openQuestions.values()].at(-1) };
  if (boxAsk) return { kind: "next-step box", text: boxAsk };
  if (!lastText) return null;
  const tail = lastText.trim().split("\n").filter((l) => l.trim()).slice(-12);
  const numbered = tail.filter((l) => NUMBERED_LINE.test(l));
  if (numbered.length >= 2) return { kind: "numbered options", text: numbered.join("\n").slice(0, 400) };
  if (lastText.trim().endsWith("?")) {
    const sentences = lastText.trim().split(/(?<=[.!?])\s+/);
    return { kind: "question", text: sentences.at(-1).slice(0, 400) };
  }
  return null;
}

// --- git ----------------------------------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
  return r.stdout.trim();
}
const lines = (text) => (text ? text.split("\n") : []);

function readGit(cwd) {
  if (spawnSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).status !== 0) {
    return { git: null, gitError: null };
  }
  try {
    const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    const remoteUrl = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout.trim();
    const stashes = lines(git(cwd, "stash", "list", "--format=%gs"));
    const changed = lines(git(cwd, "status", "--porcelain"));
    return {
      git: {
        branch,
        head: git(cwd, "rev-parse", "HEAD"),
        uncommitted: changed.length,
        uncommittedSample: changed.slice(0, 3).map((l) => l.slice(3)),
        // Commits that exist only on this machine: on no remote branch at all.
        localOnlyCommits: lines(git(cwd, "log", "--oneline", "HEAD", "--not", "--remotes")).length,
        stashesOnBranch: stashes.filter((s) => s.startsWith(`On ${branch}:`) || s.startsWith(`WIP on ${branch}:`))
          .length,
        repo: remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)?.[1] ?? null,
      },
      gitError: null,
    };
  } catch (err) {
    return { git: null, gitError: err.message };
  }
}

// --- main ---------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const sessions = JSON.parse(readFileSync(args.sessions, "utf8"));

const out = sessions.map((s) => {
  const present = Boolean(s.cwd) && existsSync(s.cwd);
  const { git: gitState, gitError } = present ? readGit(s.cwd) : { git: null, gitError: null };
  const found = s.cwd ? findTranscript(args.projects, s.cwd, s.title, args.tailBytes) : { path: null, match: "no transcripts", entries: [] };
  return {
    sessionId: s.sessionId,
    title: s.title,
    cwd: s.cwd,
    folder: present ? "present" : "missing",
    git: gitState,
    gitError,
    sharesFolderWith: sessions.filter((o) => o !== s && o.cwd === s.cwd).map((o) => o.sessionId),
    sharesHubFolder: Boolean(args.hubCwd) && s.cwd === args.hubCwd,
    transcript: found.path,
    transcriptMatch: found.match,
    ...readTranscript(found.entries),
  };
});

// One session per line, so a long sweep can be read in chunks of lines.
process.stdout.write("[\n" + out.map((o) => JSON.stringify(o)).join(",\n") + "\n]\n");
