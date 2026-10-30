#!/usr/bin/env node
// Gather and draw the lane map for `/lane-map`: every local stack on this machine, across every
// product, who holds it, what it is doing, and what runs against it.
//
//   node lane-map.mjs gather [--code-dir <dir>] [--repo <dir>]... [--sessions <file>] > facts.json
//   node lane-map.mjs summary --facts <file>
//   node lane-map.mjs render --facts <file> --notes <file> > page.html
//
// A lane is one local Supabase stack, named by its port range (546xx). gather finds them in each
// product repo under --code-dir (default ~/Code) plus any --repo: a repo with a lane registry
// (.tld/stacks.md) contributes its rows; any other repo contributes the stack its
// supabase/config.toml defines. A Supabase stack running in Docker that no repo defines is a
// lane too. gather also reads Docker, git worktrees, running processes, listening ports and
// portless routes, and with --sessions (the JSON array list_sessions returned) matches each
// claim and process to its session. It changes nothing. A process is described by a fixed
// label ("Vite dev server", "Script run-shards.mjs"), never by its command line, and from a
// process's environment it keeps the local Supabase URL's port and nothing else, so no key
// reaches its output.
//
// render draws one self-contained HTML page from those facts and notes.json, the words Claude
// writes for each run (SKILL.md § Notes). Every note is escaped; [text](https://…) and `code`
// are the only markup it turns into HTML.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

// --- where lanes are defined ------------------------------------------------------

// The first table in .tld/stacks.md: | Stack | Ports | Container | State | Claimed by | Since |
export function parseStacks(md) {
  const rows = [];
  let header = null;
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) {
      if (header) break;
      continue;
    }
    const cells = line.trim().split("|").slice(1, -1).map((c) => c.trim());
    if (!header) {
      if (!cells.some((c) => /^stack$/i.test(c))) continue;
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const get = (name) => cells[header.indexOf(name)] ?? "";
    rows.push({
      stack: Number(get("stack")),
      ports: get("ports"),
      container: get("container"),
      state: get("state").toLowerCase(),
      claimedBy: get("claimed by"),
      since: get("since"),
    });
  }
  return rows;
}

// project_id and the [api] port from a supabase/config.toml
export function parseConfigToml(text) {
  let section = "";
  let projectId = null;
  let apiPort = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) { section = head[1]; continue; }
    const kv = /^(\w+)\s*=\s*"?([^"]*)"?$/.exec(line);
    if (!kv) continue;
    if (section === "" && kv[1] === "project_id") projectId = kv[2];
    if (section === "api" && kv[1] === "port") apiPort = Number(kv[2]);
  }
  return projectId && apiPort ? { projectId, ports: String(apiPort).slice(0, 3) + "xx" } : null;
}

const portPrefix = (ports) => ports.replace(/x+$/i, "");

// supabase_db_lab_inventory_2 -> lab_inventory_2, the suffix every container of that stack ends in
export const projectOf = (dbContainer) => dbContainer.replace(/^supabase_db_/, "");

// The lanes one product defines: its registry rows, or else one lane per config.toml.
export function productLanes(product, { stacksMd, configs }) {
  if (stacksMd) {
    return parseStacks(stacksMd).map((s) => ({
      key: `${product}:${s.stack}`, product, stack: s.stack, label: `Stack ${s.stack}`, ports: s.ports,
      project: projectOf(s.container), state: s.state, claimedBy: s.claimedBy, since: s.since, registry: true,
    }));
  }
  const parsed = configs.map(parseConfigToml).filter(Boolean);
  return parsed.map((c) => ({
    key: `${product}:${parsed.length === 1 ? "local" : c.projectId}`, product, stack: null,
    label: parsed.length === 1 ? "Local stack" : c.projectId, ports: c.ports, project: c.projectId,
    state: "unmanaged", claimedBy: "", since: "", registry: false,
  }));
}

// --- Docker -----------------------------------------------------------------

export function upSeconds(status) {
  const m = /^Up (?:About )?(?:(Less than a)|(an?)|(\d+)) (second|minute|hour|day|week|month)/i.exec(status ?? "");
  if (!m) return null;
  const n = m[1] ? 0 : m[2] ? 1 : Number(m[3]);
  const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 }[m[4].toLowerCase()];
  return n * unit;
}

// "0.0.0.0:54522->5432/tcp, [::]:54522->5432/tcp" -> [{ host: 54522, inner: 5432 }]
export function hostPorts(text) {
  const seen = new Map();
  for (const m of (text ?? "").matchAll(/:(\d+)->(\d+)\//g)) seen.set(Number(m[1]), Number(m[2]));
  return [...seen].map(([host, inner]) => ({ host, inner }));
}

export function parseDockerPs(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const [name, status = "", ports = ""] = line.split("\t");
    return { name, up: upSeconds(status), ports: hostPorts(ports) };
  });
}

export function toMiB(text) {
  const m = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec((text ?? "").trim());
  if (!m) return 0;
  const v = Number(m[1]);
  return { K: v / 1024, M: v, G: v * 1024, T: v * 1048576 }[m[2][0].toUpperCase()] ?? v / 1048576;
}

// "name\t108.1MiB / 10.2GiB" -> Map(name -> MiB)
export function parseDockerStats(text) {
  const out = new Map();
  for (const line of text.split("\n").filter(Boolean)) {
    const [name, usage = ""] = line.split("\t");
    out.set(name, toMiB(usage.split("/")[0]));
  }
  return out;
}

// One group per Supabase project: every known project, plus any other project whose db container
// is up. Containers that fit no project go to `otherMiB`.
export function groupContainers(containers, mem, knownProjects) {
  const projects = [...knownProjects];
  for (const c of containers) {
    if (c.name.startsWith("supabase_db_") && !projects.includes(projectOf(c.name))) projects.push(projectOf(c.name));
  }
  const groups = new Map(projects.map((p) => [p, []]));
  let otherMiB = 0;
  for (const c of containers) {
    const project = projects.find((p) => c.name.startsWith("supabase_") && c.name.endsWith("_" + p));
    if (!project) { otherMiB += mem.get(c.name) ?? 0; continue; }
    groups.get(project).push({ ...c, role: c.name.slice("supabase_".length, -(project.length + 1)), mem: mem.get(c.name) ?? 0 });
  }
  const out = new Map();
  for (const [project, list] of groups) {
    if (!list.length) continue;
    const db = list.find((c) => c.role === "db");
    const ups = list.map((c) => c.up).filter((u) => u !== null);
    out.set(project, {
      running: Boolean(db),
      containers: list.length,
      upSeconds: ups.length ? Math.max(...ups) : null,
      dbUpSeconds: db?.up ?? null,
      memMiB: Math.round(list.reduce((sum, c) => sum + c.mem, 0)),
      ports: list.flatMap((c) => c.ports.map((p) => ({ port: p.host, role: c.role }))),
    });
  }
  return { groups: out, otherMiB: Math.round(otherMiB) };
}

// --- git worktrees ----------------------------------------------------------

export function parseWorktrees(text) {
  return text.split("\n\n").filter((b) => b.trim()).map((block) => {
    const get = (key) => block.split("\n").find((l) => l.startsWith(key + " "))?.slice(key.length + 1) ?? null;
    const branch = get("branch");
    return { path: get("worktree"), folder: basename(get("worktree") ?? ""), head: get("HEAD"), branch: branch ? branch.replace(/^refs\/heads\//, "") : null };
  });
}

// --- processes --------------------------------------------------------------

export function etimeSeconds(etime) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime ?? "");
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export function parsePs(text) {
  return text.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), seconds: etimeSeconds(m[3]), command: m[4] }));
}

// lsof -F output: p<pid> then n<name> lines. With -d cwd the name is a folder; with -iTCP it is
// an address whose port follows the last colon.
export function parseLsof(text) {
  const out = [];
  let pid = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== null) out.push({ pid, name: line.slice(1) });
  }
  return out;
}

const SHELL = /^-?(?:\S*\/)?(?:zsh|bash|sh|fish)(?:\s|$)/;
const APP = /\/Claude\.app\/|\/claude-code\/|Helpers\/disclaimer/;
// Shared by every product, so it is shown on its own: the portless proxy keeps the folder and
// environment of whichever worktree first started it.
const SHARED = /\bportless\b/;
const KNOWN = [
  [/\bplaywright\b.*\btest\b/, "Playwright run"],
  [/\bvitest\b/, "Vitest run"],
  [/\bjest\b/, "Jest run"],
  [/\bnext\b.*\bdev\b/, "Next dev server"],
  [/\bvite\b/, "Vite dev server"],
  [/\bwrangler\b.*\bdev\b/, "Wrangler dev server"],
  [/\bexpo\b.*\bstart\b|\bmetro\b/, "Expo dev server"],
  [/\bstripe\s+listen\b/, "Stripe forwarder"],
  [/\bsupabase\s/, "Supabase CLI"],
  [/\bnode\b.*\s--test\b/, "node --test run"],
];

// A fixed label for a command. Never the command itself: command lines carry keys.
export function labelOf(command) {
  for (const [pattern, label] of KNOWN) if (pattern.test(command)) return { label, known: true };
  const script = /([\w.-]+\.(?:mjs|cjs|js|ts|py|sh))(?:\s|$)/.exec(command);
  return { label: script ? `Script ${script[1]}` : "Process", known: false };
}

// The product and worktree folder a path sits in: a folder under <repo>/.claude/worktrees, or
// the main checkout's own name.
export function placeOf(path, products) {
  if (!path) return null;
  const hit = products.filter((p) => path === p.path || path.startsWith(p.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
  if (!hit) return null;
  const wt = `${hit.path}/.claude/worktrees/`;
  return { product: hit.name, folder: path.startsWith(wt) ? path.slice(wt.length).split("/")[0] : basename(hit.path) };
}

// Processes that belong to a product: their working folder is in its repo, or their command
// names a path in it. Claude's own processes and shells are left out. A child of a kept
// process, or of the app itself (its MCP servers), stays only when it is a known kind (a dev
// server under a walk runner) or listens on a port.
export function productProcesses({ procs, cwds, listeners, products, selfPids = [] }) {
  const cwdOf = new Map(cwds.map((c) => [c.pid, c.name]));
  const portsOf = new Map();
  for (const l of listeners) {
    const port = Number(l.name.slice(l.name.lastIndexOf(":") + 1));
    if (port) portsOf.set(l.pid, [...new Set([...(portsOf.get(l.pid) ?? []), port])]);
  }
  const appPids = new Set(procs.filter((p) => APP.test(p.command)).map((p) => p.pid));
  const commandPath = (command) => {
    for (const p of products) {
      const i = command.indexOf(p.path + "/");
      if (i >= 0) return command.slice(i).split(/\s/)[0];
    }
    return null;
  };
  const candidates = procs
    .filter((p) => !selfPids.includes(p.pid) && !SHELL.test(p.command) && !SHARED.test(p.command) && !appPids.has(p.pid))
    .map((p) => ({ ...p, place: placeOf(cwdOf.get(p.pid), products) ?? placeOf(commandPath(p.command), products) }))
    .filter((p) => p.place);
  const kept = new Set(candidates.map((p) => p.pid));
  return candidates
    .map((p) => ({ ...p, ...labelOf(p.command), ports: portsOf.get(p.pid) ?? [] }))
    .filter((p) => p.known || p.ports.length || !(kept.has(p.ppid) || appPids.has(p.ppid)))
    .map((p) => ({
      pid: p.pid,
      label: p.label,
      seconds: p.seconds,
      ports: p.ports,
      product: p.place.product,
      folder: p.place.folder,
      stackFiles: [...p.command.matchAll(/stack-(\d+)\.env\b/g)].map((m) => Number(m[1])),
    }));
}

// From `ps eww` output keep only the port of a local Supabase or database URL.
export function envPorts(text) {
  const ports = new Set();
  for (const m of (text ?? "").matchAll(/\b(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)?SUPABASE_URL=https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g)) ports.add(Number(m[1]));
  for (const m of (text ?? "").matchAll(/\bDATABASE_URL=postgres(?:ql)?:\/\/[^@\s]*@(?:127\.0\.0\.1|localhost):(\d+)/g)) ports.add(Number(m[1]));
  return [...ports];
}

// The lane a port belongs to. Two products can define the same range (lab-inventory stack 1 and
// mAInCharacter both on 543xx): the process's own product wins, then the one running.
export function laneOfPort(port, lanes, product) {
  const p = String(port);
  const hits = lanes.filter((l) => portPrefix(l.ports) && p.length === 5 && p.startsWith(portPrefix(l.ports)));
  return hits.find((l) => l.product === product) ?? hits.find((l) => l.docker?.running) ?? hits[0] ?? null;
}

// --- sessions ---------------------------------------------------------------

// The session working in a folder of a product: its cwd is that worktree, or the folder is a
// shard worktree named after it (<folder>-walk2). A running session wins, then an exact match,
// then the latest.
export function sessionFor(product, folder, sessions, products) {
  if (!folder) return null;
  const hits = sessions
    .map((s) => ({ s, place: placeOf(s.cwd, products) }))
    .filter(({ s, place }) => !s.isArchived && place?.product === product && (place.folder === folder || folder.startsWith(place.folder + "-")));
  hits.sort((a, b) =>
    Number(Boolean(b.s.isRunning)) - Number(Boolean(a.s.isRunning)) ||
    Number(b.place.folder === folder) - Number(a.place.folder === folder) ||
    String(b.s.lastActivityAt).localeCompare(String(a.s.lastActivityAt)));
  return hits[0]?.s ?? null;
}

const trimSession = (s, products) => s && {
  id: s.sessionId, title: s.title, link: s.link ?? null, running: Boolean(s.isRunning),
  lastActivityAt: s.lastActivityAt ?? null, startedBy: s.startedBy ?? null,
  product: placeOf(s.cwd, products)?.product ?? (s.cwd ? basename(s.cwd.split("/.claude/worktrees/")[0]) : null),
};

const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// --- facts --------------------------------------------------------------------

// Everything gather collected, raw, into the facts render draws from. Pure, so tests feed it
// recorded command output. raw.products: [{ name, path, stacksMd?, configs: [toml text],
// worktrees: porcelain text }].
export function buildFacts(raw) {
  const products = raw.products.map((p) => ({ name: p.name, path: p.path }));
  const sessions = raw.sessions ?? [];
  let lanes = raw.products.flatMap((p) => productLanes(p.name, p));
  const docker = raw.dockerPs === null ? null : groupContainers(parseDockerPs(raw.dockerPs), parseDockerStats(raw.dockerStats ?? ""), lanes.map((l) => l.project));
  for (const [project, group] of docker?.groups ?? []) {
    if (lanes.some((l) => l.project === project) || !group.running) continue;
    const api = group.ports.find((p) => p.role === "kong")?.port ?? group.ports[0]?.port;
    lanes.push({ key: `unknown:${project}`, product: "unknown", stack: null, label: project, ports: api ? String(api).slice(0, 3) + "xx" : "", project, state: "unmanaged", claimedBy: "", since: "", registry: false });
  }
  // A retired product's lanes leave the map while its stack is stopped, and come back flagged
  // the moment any of its containers runs: it takes memory and ports like any other.
  const retired = new Set(raw.retired ?? []);
  const hiddenRetired = [...retired].filter((name) => lanes.some((l) => l.product === name && !docker?.groups.get(l.project)));
  lanes = lanes.filter((l) => !retired.has(l.product) || docker?.groups.get(l.project));
  const worktreesOf = new Map(raw.products.map((p) => [p.name, parseWorktrees(p.worktrees ?? "")]));
  lanes = lanes.map((l) => {
    const group = docker?.groups.get(l.project) ?? null;
    const holder = l.state === "claimed" ? l.claimedBy : null;
    const wt = holder ? worktreesOf.get(l.product)?.find((w) => w.folder === holder) : null;
    return {
      ...l,
      retired: retired.has(l.product),
      docker: group,
      worktree: wt ? { folder: wt.folder, branch: wt.branch, exists: true, git: raw.git?.[`${l.product}/${wt.folder}`] ?? null } : holder ? { folder: holder, exists: false } : null,
      session: holder ? trimSession(sessionFor(l.product, holder, sessions, products), products) : null,
    };
  });
  for (const l of lanes) {
    l.sharesPortsWith = lanes.filter((o) => o !== l && o.product !== l.product && o.ports && o.ports === l.ports).map((o) => o.key);
  }
  lanes.sort((a, b) => a.ports.localeCompare(b.ports) || a.product.localeCompare(b.product) || (a.stack ?? 0) - (b.stack ?? 0));

  const processes = (raw.processes ?? []).map((p) => {
    const keys = new Set(p.stackFiles.map((n) => lanes.find((l) => l.product === p.product && l.stack === n)?.key).filter(Boolean));
    for (const port of raw.envPorts?.[p.pid] ?? []) {
      const lane = laneOfPort(port, lanes, p.product);
      if (lane) keys.add(lane.key);
    }
    return { ...p, lanes: [...keys].sort(), session: sessionFor(p.product, p.folder, sessions, products)?.sessionId ?? null };
  });
  const laneSessions = new Set([...lanes.map((l) => l.session?.id), ...processes.map((p) => p.session)].filter(Boolean));
  return {
    takenAt: raw.takenAt,
    dockerLimitMiB: raw.dockerMemTotal ? Math.round(raw.dockerMemTotal / 1048576) : null,
    dockerRunning: docker !== null,
    otherContainersMiB: docker?.otherMiB ?? 0,
    products: raw.products.map((p) => ({ name: p.name, worktreeCount: worktreesOf.get(p.name).length, registry: Boolean(p.stacksMd), retired: retired.has(p.name) })),
    hiddenRetired,
    lanes,
    processes,
    portless: (raw.portlessRoutes ?? []).map((r) => ({ hostname: r.hostname, port: r.port, live: (raw.listeningPorts ?? []).includes(r.port) })),
    portlessProxy: raw.portlessProxy ?? null,
    sessionsKnown: Boolean(raw.sessions),
    sessions: sessions
      .filter((s) => !s.isArchived && s.lastActivityAt && sameLocalDay(s.lastActivityAt, raw.takenAt))
      .map((s) => ({ ...trimSession(s, products), holdsLane: laneSessions.has(s.sessionId) })),
    allSessions: sessions.filter((s) => !s.isArchived).map((s) => trimSession(s, products)),
  };
}

// --- gather: run the read-only commands ---------------------------------------

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const SKIP = new Set(["node_modules", ".git", ".claude", "dist", "build"]);

function readProduct(path) {
  const registry = join(path, ".tld", "stacks.md");
  const configs = [join(path, "supabase", "config.toml")];
  for (const child of readdirSync(path)) {
    if (!SKIP.has(child) && !child.startsWith(".") && isDir(join(path, child))) configs.push(join(path, child, "supabase", "config.toml"));
  }
  return {
    name: basename(path),
    path,
    stacksMd: existsSync(registry) ? readFileSync(registry, "utf8") : null,
    configs: configs.filter(existsSync).map((f) => readFileSync(f, "utf8")),
    worktrees: run("git", ["-C", path, "worktree", "list", "--porcelain"]) ?? "",
  };
}

function gather({ codeDir, repos, sessionsFile, configFile }) {
  let config = {};
  try { config = JSON.parse(readFileSync(configFile, "utf8")); } catch { /* no config: nothing retired */ }
  const paths = new Set(repos.map((r) => r.replace(/\/+$/, "")));
  if (isDir(codeDir)) {
    for (const child of readdirSync(codeDir)) {
      if (child.startsWith(".")) continue;
      const p = join(codeDir, child);
      if (existsSync(join(p, ".git")) && isDir(p)) paths.add(p);
    }
  }
  const products = [...paths].sort().map(readProduct);

  const dockerPs = run("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"]);
  const dockerStats = dockerPs ? run("docker", ["stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"]) : null;
  const dockerMemTotal = dockerPs ? Number(run("docker", ["info", "--format", "{{.MemTotal}}"])) || null : null;

  const procs = parsePs(run("ps", ["-axo", "pid=,ppid=,etime=,command="]) ?? "");
  const cwds = parseLsof(run("lsof", ["-nP", "-d", "cwd", "-Fpn"]) ?? "");
  const listeners = parseLsof(run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]) ?? "");
  const processes = productProcesses({ procs, cwds, listeners, products, selfPids: [process.pid, process.ppid] });
  const envPortsByPid = {};
  for (const p of processes) envPortsByPid[p.pid] = envPorts(run("ps", ["eww", "-o", "command=", "-p", String(p.pid)]));
  const listeningPorts = [...new Set(listeners.map((l) => Number(l.name.slice(l.name.lastIndexOf(":") + 1))))];

  let portlessRoutes = [];
  try { portlessRoutes = JSON.parse(readFileSync(join(homedir(), ".portless", "routes.json"), "utf8")); } catch { /* no portless here */ }
  const proxy = procs.find((p) => /\bportless\b.*\bproxy\b/.test(p.command));
  const portlessProxy = proxy ? { seconds: proxy.seconds, port: listeners.find((l) => l.pid === proxy.pid)?.name.split(":").pop() ?? null } : null;

  // Today's commits in each claimed worktree that the default branch does not have yet.
  const git = {};
  for (const p of products.filter((p) => p.stacksMd)) {
    const base = (run("git", ["-C", p.path, "rev-parse", "--abbrev-ref", "origin/HEAD"]) ?? "").trim();
    for (const row of parseStacks(p.stacksMd).filter((r) => r.state === "claimed")) {
      const wt = parseWorktrees(p.worktrees).find((w) => w.folder === row.claimedBy);
      if (!wt) continue;
      const today = run("git", ["-C", wt.path, "log", "--since=midnight", "--format=%h", ...(base ? [`${base}..HEAD`] : [])]) ?? "";
      const last = (run("git", ["-C", wt.path, "log", "-1", "--format=%h%x09%cI%x09%s"]) ?? "").trim().split("\t");
      git[`${p.name}/${wt.folder}`] = { commitsToday: today.split("\n").filter(Boolean).length, last: last[0] ? { sha: last[0], at: last[1], subject: last[2] } : null };
    }
  }

  const sessions = sessionsFile ? JSON.parse(readFileSync(sessionsFile, "utf8")) : null;
  return buildFacts({
    takenAt: new Date().toISOString(), products, dockerPs, dockerStats, dockerMemTotal, processes,
    envPorts: envPortsByPid, listeningPorts, portlessRoutes, portlessProxy, git, sessions,
    retired: Array.isArray(config.retired) ? config.retired : [],
  });
}

// --- summary: the facts as short lines, for Claude to read before writing notes --------

export function summary(facts) {
  const lines = [];
  const proc = (p) => `${p.label}${p.ports.length ? ` :${p.ports.join(",:")}` : ""} [${p.product}/${p.folder}${p.session ? ` session ${p.session}` : ""}]`;
  for (const l of facts.lanes) {
    const d = l.docker;
    const holder = l.state === "claimed" ? `claimed by ${l.claimedBy} since ${l.since}` : l.state;
    const s = l.session ? ` | session ${l.session.id} "${l.session.title}"${l.session.running ? " RUNNING" : ""}` : "";
    const up = d?.running ? ` | up ${duration(d.upSeconds)}, ${(d.memMiB / 1024).toFixed(1)} GB${d.upSeconds - d.dbUpSeconds > 600 ? `, db up ${duration(d.dbUpSeconds)}` : ""}` : " | stopped";
    const g = l.worktree?.git;
    const wt = g ? ` | ${l.worktree.branch ? `${l.worktree.branch}, ${g.commitsToday} today` : "detached"}, last ${g.last?.sha} ${g.last?.subject}` : l.worktree && !l.worktree.exists ? " | FOLDER GONE" : "";
    lines.push(`${l.key} ${l.ports} | ${holder}${s}${up}${wt}`);
    for (const p of facts.processes.filter((p) => p.lanes.includes(l.key))) lines.push(`    ${proc(p)}`);
  }
  const loose = facts.processes.filter((p) => !p.lanes.length);
  if (loose.length) lines.push("no lane:", ...loose.map((p) => `    ${proc(p)}`));
  if (facts.sessionsKnown) {
    lines.push("today, no lane:");
    for (const s of facts.sessions.filter((s) => !s.holdsLane)) lines.push(`    ${s.id} "${s.title}" [${s.product}]${s.running ? " RUNNING" : ""}${s.startedBy ? ` startedBy ${s.startedBy}` : ""}`);
  }
  return lines.join("\n") + "\n";
}

// --- render -------------------------------------------------------------------

const esc =(s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Escape, then turn [text](https://…) into a link and `x` into code.
export function rich(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const clock = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, " ");
const day = (t) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const dayOnly = (ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(ymd + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ymd;
export function duration(seconds) {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}
const gb = (mib) => `${(mib / 1024).toFixed(1)} GB`;
const sessionLink = (s) => s ? (s.link ? `<a href="${esc(s.link)}">${esc(s.title)}</a>` : esc(s.title)) : "";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

const ROLE = { kong: "API", db: "database", inbucket: "test inbox", mailpit: "test inbox", studio: "Studio", analytics: "logs" };

// 54521, 54522, 54524 -> "54521 / 22 / 24"
export function portRun(ports) {
  const sorted = [...new Set(ports)].sort((a, b) => a - b);
  return sorted.map((p, i) => (i && String(p).slice(0, 3) === String(sorted[0]).slice(0, 3) ? String(p).slice(3) : String(p))).join(" / ");
}

export function render(facts, notes) {
  const names = notes.productNames ?? {};
  const pname = (p) => names[p] ?? (p === "unknown" ? "Not in any repo" : p);
  const lanesByKey = new Map(facts.lanes.map((l) => [l.key, l]));
  const jobs = (notes.jobs ?? []).map((j, i) => ({ ...j, lanes: (j.lanes ?? []).filter((k) => lanesByKey.has(k)), index: (i % 4) + 1 }));
  const jobOf = (key) => jobs.find((j) => j.lanes.includes(key)) ?? null;
  const byId = new Map(facts.allSessions.map((s) => [s.id, s]));
  const laneNotes = notes.lanes ?? {};
  const short = (l) => portPrefix(l.ports) || l.label;
  const procsFor = (key) => facts.processes.filter((p) => p.lanes.includes(key));
  const laneProcs = new Set(facts.lanes.flatMap((l) => procsFor(l.key)));
  const looseProcs = facts.processes.filter((p) => !laneProcs.has(p) && (p.ports.length || p.label !== "Process"));

  // Products worth a filter button: a lane in use, a process, or a session today.
  const productsShown = [...new Set([
    ...facts.lanes.filter((l) => l.docker || l.state === "claimed").map((l) => l.product),
    ...facts.processes.map((p) => p.product),
    ...facts.sessions.map((s) => s.product).filter(Boolean),
    ...facts.lanes.map((l) => l.product),
  ])].filter((p) => p !== "unknown" || facts.lanes.some((l) => l.product === "unknown"));
  const runningIn = (p) => facts.lanes.filter((l) => l.product === p && l.docker?.running).length;

  const badge = (l) => {
    const j = jobOf(l.key);
    return `<span class="badge${j ? ` job-${j.index}` : ""}" title="${esc(`${pname(l.product)} · ${l.label}`)}">${esc(short(l))}</span>`;
  };

  // Jobs.
  const jobCards = jobs.map((j) => {
    const s = byId.get(j.session);
    const parent = s?.startedBy ? byId.get(s.startedBy) : null;
    const product = lanesByKey.get(j.lanes[0])?.product ?? s?.product ?? "";
    return `<article class="job" data-product="${esc(slug(product))}">
        <div class="job-head"><span class="job-name">${esc(j.name)}</span><span class="job-lanes">${j.lanes.map((k) => badge(lanesByKey.get(k))).join("")}</span></div>
        <p class="eyebrow">${esc(pname(product))}</p>
        <p>${rich(j.summary)}</p>
        ${s ? `<p class="muted">Session: ${sessionLink(s)}${s.running ? " (working now)" : ""}${parent ? `, started from ${sessionLink(parent)}` : ""}</p>` : ""}
      </article>`;
  });
  const idle = facts.lanes.filter((l) => !jobOf(l.key) && !l.docker?.running && l.state !== "claimed");
  if (idle.length) {
    const nextFree = [...new Set(idle.filter((l) => l.registry).map((l) => l.product))].map((p) => {
      const pick = idle.filter((l) => l.product === p && l.state === "free" && l.stack >= 2).sort((a, b) => a.stack - b.stack)[0];
      return pick ? esc(`${pname(p)}'s next claim takes ${pick.ports}.`) : "";
    }).filter(Boolean);
    jobCards.push(`<article class="job free">
        <div class="job-head"><span class="job-name">Free and stopped</span><span class="job-lanes">${idle.map(badge).join("")}</span></div>
        <p>${notes.free ? rich(notes.free) : nextFree.join(" ") || "Nothing runs on these ranges."}</p>
      </article>`);
  }

  // Lane rows.
  const laneRows = facts.lanes.map((l) => {
    const j = jobOf(l.key);
    const n = laneNotes[l.key] ?? {};
    const d = l.docker;
    const pill = d?.running
      ? `<span class="pill"><span class="dot on"></span>Running</span>`
      : d?.containers ? `<span class="pill"><span class="dot part"></span>Partly up</span>` : `<span class="pill"><span class="dot hollow"></span>Stopped</span>`;
    const procs = procsFor(l.key);
    const held = [];
    if (l.state === "claimed") {
      held.push(`<p class="session">${l.session ? sessionLink(l.session) : "No session found"}</p>`);
      held.push(`<p><code>${esc(l.claimedBy)}</code>${l.worktree && !l.worktree.exists ? ` <span class="chip">folder is gone</span>` : ""}</p>`);
    } else if (l.state === "unmanaged") {
      const users = [...new Set(procs.map((p) => p.session).filter(Boolean))].map((id) => byId.get(id)).filter(Boolean);
      held.push(users.length
        ? users.map((s) => `<p class="session">${sessionLink(s)}</p>`).join("")
        : `<p class="session">${d?.running ? "Nobody it can name" : "Nobody"}</p>`);
      held.push(`<p class="muted">No lane registry: ${l.product === "unknown" ? "no repo defines this stack" : "the repo's own stack"}.</p>`);
    } else {
      held.push(`<p class="session">${l.state === "review" ? "You (review)" : "Nobody (free)"}</p>`);
    }
    if (n.held) held.push(`<p>${rich(n.held)}</p>`);
    const meta = [l.state === "claimed" && l.since ? `Claimed ${esc(dayOnly(l.since))}` : "", d?.running ? `up ${duration(d.upSeconds)}` : "", d?.running ? gb(d.memMiB) : ""].filter(Boolean);
    if (meta.length) held.push(`<p class="muted">${meta.join(" · ")}</p>`);
    if (l.worktree?.branch) {
      const g = l.worktree.git;
      held.push(`<p class="muted">Branch <code>${esc(l.worktree.branch)}</code>${g ? ` · ${g.commitsToday} commit${g.commitsToday === 1 ? "" : "s"} today` : ""}</p>`);
    }
    for (const key of l.sharesPortsWith) {
      const o = lanesByKey.get(key);
      held.push(`<p><span class="chip">Shares ${esc(l.ports)} with ${esc(pname(o.product))}</span></p>`);
    }
    if (l.retired) held.push(`<p><span class="chip">Retired product, but its stack is up</span></p>`);

    const doing = [`<p>${n.doing ? rich(n.doing) : l.state === "claimed" ? "No notes for this run." : d?.running ? "Up, with no notes for this run." : "Nothing."}</p>`];
    if (n.chip) doing.push(`<p><span class="chip">${esc(n.chip)}</span></p>`);
    if (d?.running && d.dbUpSeconds !== null && d.upSeconds - d.dbUpSeconds > 600) {
      doing.push(`<p class="muted">Database restarted at ${clock(Date.parse(facts.takenAt) - d.dbUpSeconds * 1000)}, most likely a reset.</p>`);
    }
    if (n.note) doing.push(`<p class="muted">${rich(n.note)}</p>`);

    const folders = [...new Set(procs.map((p) => p.folder).filter(Boolean))];
    const against = procs.length
      ? `<ul>${procs.map((p) => `<li>${esc(p.label)}${p.ports.length ? ` on <code>:${p.ports.join(", :")}</code>` : ""}</li>`).join("")}</ul>` +
        (folders.length ? `<p class="muted">From <code>${folders.map(esc).join("</code>, <code>")}</code></p>` : "")
      : `<p>${d?.running ? "No dev server or test run." : "Nothing."}</p>`;

    return `<div class="lane ${j ? `job-${j.index}` : d?.running ? "loose" : "idle"}" data-product="${esc(slug(l.product))}">
        <div class="lane-id"><span class="lane-num">${esc(portPrefix(l.ports) || "?")}<span class="xx">xx</span></span><span class="lane-name">${esc(pname(l.product))}</span><span class="ports">${esc(l.label)}</span>${pill}</div>
        <div class="col"><span class="col-label">Held by</span>${held.join("")}</div>
        <div class="col"><span class="col-label">Doing</span>${doing.join("")}</div>
        <div class="col"><span class="col-label">Running against it</span>${against}</div>
      </div>`;
  });

  // Docker memory, drawn to the limit's scale, every product counted.
  const running = facts.lanes.filter((l) => l.docker?.running);
  const usedMiB = running.reduce((s, l) => s + l.docker.memMiB, 0) + facts.otherContainersMiB;
  const limit = facts.dockerLimitMiB || Math.max(usedMiB, 1);
  const seg = (mib, cls, label, product, tip) => `<div class="seg ${cls}"${product ? ` data-product="${esc(slug(product))}"` : ""} style="width: ${((mib / limit) * 100).toFixed(1)}%" title="${esc(tip)}">${esc(label)}</div>`;
  const segments = [
    ...running.map((l) => seg(l.docker.memMiB, jobOf(l.key) ? `job-${jobOf(l.key).index}` : "plain", short(l), l.product, `${pname(l.product)} · ${l.label}: ${gb(l.docker.memMiB)}`)),
    ...(facts.otherContainersMiB ? [seg(facts.otherContainersMiB, "plain", "", null, `Other containers: ${gb(facts.otherContainersMiB)}`)] : []),
  ];
  const perProduct = [...new Set(running.map((l) => l.product))].map((p) => `${pname(p)} ${running.filter((l) => l.product === p).length}`);
  const dockerBlock = !facts.dockerRunning
    ? `<div class="budget"><p>Docker is not running, so no lane is up.</p></div>`
    : `<div class="budget">
        <p><strong class="num">${gb(usedMiB)}</strong>${facts.dockerLimitMiB ? ` of the <span class="num">${gb(limit)}</span> limit` : ""} in use by ${running.length} running lane${running.length === 1 ? "" : "s"}${perProduct.length ? ` (${esc(perProduct.join(", "))})` : ""}${facts.otherContainersMiB ? " and other containers" : ""}. Every product counts toward the one limit.</p>
        <div class="bar" role="img" aria-label="${esc(running.map((l) => `${pname(l.product)} ${l.label} ${gb(l.docker.memMiB)}`).join(", "))}${facts.dockerLimitMiB ? `, out of ${gb(limit)}` : ""}">${segments.join("")}</div>
        <div class="scale num"><span>0</span><span>${(limit / 2048).toFixed(1)}</span><span>${gb(limit)}</span></div>
        <div class="legend">${jobs.map((j) => `<span><span class="chip job-${j.index}">${esc(j.name)}</span></span>`).join("")}${running.some((l) => !jobOf(l.key)) ? `<span><span class="chip plain">Grey</span> running, no job named</span>` : ""}</div>
      </div>`;

  // Ports in use.
  const ownerOf = (key) => {
    const l = lanesByKey.get(key);
    return jobOf(key)?.name ?? (l?.state === "claimed" ? l.claimedBy : pname(l?.product));
  };
  const portRows = [];
  for (const p of facts.processes.filter((p) => p.ports.length)) {
    const where = p.lanes.map((k) => short(lanesByKey.get(k)) + "xx");
    portRows.push({ product: p.product, cells: [p.ports.join(", "), `${p.label}${where.length ? `, pointed at ${where.join(" and ")}` : ""}`, p.lanes.length ? ownerOf(p.lanes[0]) : `${pname(p.product)} · ${p.folder}`] });
  }
  for (const l of running) {
    const roles = [...new Set(l.docker.ports.map((p) => ROLE[p.role] ?? p.role))];
    portRows.push({ product: l.product, cells: [portRun(l.docker.ports.map((p) => p.port)), `${pname(l.product)} ${l.label}: ${roles.join(", ")}`, ownerOf(l.key)] });
  }
  if (facts.portlessProxy) portRows.push({ product: null, cells: [facts.portlessProxy.port ?? "1355", `portless proxy, up ${duration(facts.portlessProxy.seconds)}`, "Shared"] });
  const stoppedRanges = [...new Set(facts.lanes.filter((l) => !l.docker?.running && !running.some((r) => r.ports === l.ports)).map((l) => l.ports))];
  const dead = facts.portless.filter((r) => !r.live);
  const portsNote = [
    stoppedRanges.length ? `Free ranges: ${stoppedRanges.map(esc).join(", ")}.` : "",
    notes.portsNote ? rich(notes.portsNote) : "",
    dead.length ? `${dead.length === 1 ? "The portless name" : `The ${dead.length} portless names`} ${dead.map((r) => `<code>${esc(r.hostname)}</code>`).join(" and ")} ${dead.length === 1 ? "has" : "have"} no live server behind ${dead.length === 1 ? "it" : "them"}.` : "",
  ].filter(Boolean).join(" ");
  const row = (r) => `<tr${r.product ? ` data-product="${esc(slug(r.product))}"` : ""}>${r.cells.map((c, i) => `<td${i === 0 ? ` class="mono"` : ""}>${esc(c)}</td>`).join("")}</tr>`;

  // Servers and runs that point at no lane (a dev server on staging, a script).
  const looseBlock = looseProcs.length
    ? `<section aria-labelledby="loose-h"><h2 id="loose-h">Running outside any lane</h2>
      <div class="table-wrap"><table><thead><tr><th>What</th><th>Product</th><th>Where</th><th>For</th></tr></thead><tbody>${looseProcs.map((p) => `<tr data-product="${esc(slug(p.product))}"><td>${esc(p.label)}${p.ports.length ? ` on <code>:${p.ports.join(", :")}</code>` : ""}</td><td>${esc(pname(p.product))}</td><td><code>${esc(p.folder)}</code></td><td>${p.session ? sessionLink(byId.get(p.session)) : `up ${duration(p.seconds)}`}</td></tr>`).join("")}</tbody></table></div></section>`
    : "";

  // Sessions active today that hold no lane.
  const jobBySession = new Map(jobs.filter((j) => j.session).map((j) => [j.session, j.name]));
  const others = facts.sessions.filter((s) => !s.holdsLane).sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  const sessionRows = others.map((s) => {
    const started = facts.allSessions.filter((x) => x.startedBy === s.id && jobBySession.has(x.id)).map((x) => `Started ${jobBySession.get(x.id)}`);
    const sub = [pname(s.product), ...started].filter(Boolean);
    return `<tr${s.product ? ` data-product="${esc(slug(s.product))}"` : ""}><td>${sessionLink(s)}${s.running ? ` <span class="chip">working</span>` : ""}<br><span class="muted">${esc(sub.join(" · "))}</span></td><td class="mono">${clock(s.lastActivityAt)}</td></tr>`;
  });
  const sessionsBlock = !facts.sessionsKnown
    ? `<p class="muted">The session list was not read this run.</p>`
    : sessionRows.length
      ? `<div class="table-wrap"><table><thead><tr><th>Session</th><th>Last active</th></tr></thead><tbody>${sessionRows.join("")}</tbody></table></div>
      <p class="muted">${others.some((s) => s.running) ? "Sessions marked working are mid-turn." : "All idle."} None of them holds a lane.</p>`
      : `<p class="muted">No other session was active today.</p>`;

  // Filter: one button per product, hiding the others' rows and dimming their memory.
  const filterCss = productsShown.map((p) => {
    const s = slug(p);
    return `.wrap[data-filter="${s}"] .job[data-product]:not([data-product="${s}"]), .wrap[data-filter="${s}"] .lane:not([data-product="${s}"]), .wrap[data-filter="${s}"] tr[data-product]:not([data-product="${s}"]) { display: none; }
.wrap[data-filter="${s}"] .seg:not([data-product="${s}"]) { opacity: 0.22; }`;
  }).join("\n");
  const filterBar = productsShown.length > 1
    ? `<div class="filters" role="group" aria-label="Show one product">
      <button type="button" class="filter" id="filter-all" data-pick="all" aria-pressed="true">All products</button>
      ${productsShown.map((p) => `<button type="button" class="filter" id="filter-${esc(slug(p))}" data-pick="${esc(slug(p))}" aria-pressed="false">${esc(pname(p))} <span class="count">${runningIn(p)}</span></button>`).join("")}
    </div>`
    : "";

  const busy = new Set([...facts.lanes.filter((l) => l.state === "claimed").map((l) => `${l.product}/${l.claimedBy}`), ...facts.processes.map((p) => `${p.product}/${p.folder}`)]);
  const worktreeLine = facts.products.filter((p) => p.worktreeCount > 1 && !p.retired).map((p) => `${pname(p.name)} ${p.worktreeCount}`).join(", ");
  const hidden = facts.hiddenRetired ?? [];
  const title = notes.title ?? "Lane Map";

  return `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="lane-map" content="all-products">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}
${filterCss}</style>
<div class="wrap" data-filter="all">
  <header>
    <span class="stamp">This Mac · snapshot ${esc(day(facts.takenAt))}, ${clock(facts.takenAt)}</span>
    <h1>${esc(title)}</h1>
    ${notes.lede ? `<p class="lede">${rich(notes.lede)}</p>` : ""}
    ${filterBar}
  </header>
  <section aria-labelledby="jobs-h"><h2 id="jobs-h">Jobs</h2><div class="jobs">${jobCards.join("") || `<p class="muted">No job holds a lane.</p>`}</div></section>
  <section aria-labelledby="lanes-h"><h2 id="lanes-h">Lanes</h2><div class="board">${laneRows.join("")}</div></section>
  ${looseBlock}
  <section aria-labelledby="docker-h"><h2 id="docker-h">Docker memory</h2>${dockerBlock}</section>
  <div class="two">
    <section aria-labelledby="ports-h"><h2 id="ports-h">Ports in use</h2>
      ${portRows.length ? `<div class="table-wrap"><table><thead><tr><th>Port</th><th>What</th><th>For</th></tr></thead><tbody>${portRows.map(row).join("")}</tbody></table></div>` : `<p class="muted">No lane port is in use.</p>`}
      ${portsNote ? `<p class="muted">${portsNote}</p>` : ""}
    </section>
    <section aria-labelledby="sessions-h"><h2 id="sessions-h">Active today, no lane</h2>${sessionsBlock}</section>
  </div>
  <footer>
    <p>A lane is one local Supabase stack, named by its port range. Read from each repo's <code>.tld/stacks.md</code> or <code>supabase/config.toml</code>, Docker, git worktrees, running processes and the app's session list. A snapshot: run <code>/lane-map</code> for a new one.</p>
    ${worktreeLine ? `<p>Worktrees on disk: ${esc(worktreeLine)}. ${busy.size} ${busy.size === 1 ? "is" : "are"} in a lane or running something right now.</p>` : ""}
    ${hidden.length ? `<p>Left out while stopped: ${esc(hidden.map(pname).join(", "))}, retired in <code>~/.claude/lane-map.json</code>. A retired product's stack shows up here again if it starts.</p>` : ""}
  </footer>
</div>
<script>
(() => {
  const wrap = document.querySelector(".wrap");
  const buttons = [...document.querySelectorAll(".filter")];
  const pick = (value) => {
    if (!buttons.some((b) => b.dataset.pick === value)) value = "all";
    wrap.dataset.filter = value;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.pick === value));
    try { localStorage.setItem("lane-map-filter", value); } catch (e) {}
  };
  for (const b of buttons) b.addEventListener("click", () => pick(b.dataset.pick));
  let saved = "all";
  try { saved = localStorage.getItem("lane-map-filter") || "all"; } catch (e) {}
  pick(saved);
})();
</script>
`;
}

const CSS = `
/* Layout: a lane board. Product filter and jobs first, then one row per local stack in port
   order, separated by dashed lane markings, then the Docker budget, ports, and sessions. */
:root {
  --bg: #F2F4F6; --panel: #FFFFFF; --fg: #17212C; --muted: #5D6A77; --line: #D6DDE4; --off: #96A2AE;
  --job-1: #2459C4; --job-1-soft: #E3EBFA; --job-2: #A9530E; --job-2-soft: #F8E9DC;
  --job-3: #6B4FB8; --job-3-soft: #ECE7F8; --job-4: #0F7C74; --job-4-soft: #DDF1EE;
  --ok: #1D7A4C; --warn: #9A6200; --warn-soft: #FBF0D9;
  --font-display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0E1318; --panel: #161D24; --fg: #E5EAF0; --muted: #94A0AD; --line: #2A333D; --off: #5D6976;
    --job-1: #78A6F2; --job-1-soft: #1A2840; --job-2: #E6A066; --job-2-soft: #33241A;
    --job-3: #A994EE; --job-3-soft: #241E38; --job-4: #4FC7BB; --job-4-soft: #14302D;
    --ok: #4CC08A; --warn: #E2AE45; --warn-soft: #2E2615; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0E1318; --panel: #161D24; --fg: #E5EAF0; --muted: #94A0AD; --line: #2A333D; --off: #5D6976;
  --job-1: #78A6F2; --job-1-soft: #1A2840; --job-2: #E6A066; --job-2-soft: #33241A;
  --job-3: #A994EE; --job-3-soft: #241E38; --job-4: #4FC7BB; --job-4-soft: #14302D;
  --ok: #4CC08A; --warn: #E2AE45; --warn-soft: #2E2615; color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--font-body); }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 32px 56px; display: flex; flex-direction: column; gap: 40px; }
h1, h2 { font-family: var(--font-display); font-weight: 700; text-wrap: balance; margin: 0; }
h1 { font-size: 2.1rem; line-height: 1.1; letter-spacing: -0.01em; }
h2 { font-size: 1.15rem; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
p { margin: 0; }
a { color: inherit; text-decoration-color: var(--line); text-underline-offset: 3px; }
a:hover { text-decoration-color: currentColor; }
a:focus-visible, .filter:focus-visible { outline: 2px solid var(--job-1); outline-offset: 2px; border-radius: 4px; }
code, .mono { font-family: var(--font-mono); font-size: 0.86em; }
.muted { color: var(--muted); }
.num { font-variant-numeric: tabular-nums; }
section { display: flex; flex-direction: column; gap: 14px; }
header { display: flex; flex-direction: column; gap: 10px; }
.stamp { font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); letter-spacing: 0.02em; }
.lede { font-size: 1.08rem; max-width: 62ch; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.filter { font: 500 0.86rem/1 var(--font-body); color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
.filter:hover { border-color: var(--muted); }
.filter[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.filter .count { font-family: var(--font-mono); font-size: 0.78rem; opacity: 0.7; }
.jobs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.job { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.job-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.job-name { font-weight: 600; font-size: 1.02rem; }
.job-lanes { display: flex; gap: 6px; flex-wrap: wrap; }
.job p { font-size: 0.93rem; }
.job .eyebrow { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-top: -4px; }
.job.free { background: transparent; border-style: dashed; }
.badge { font-family: var(--font-mono); font-weight: 500; font-size: 0.74rem; min-width: 26px; height: 24px; padding: 0 6px; border-radius: 6px; display: inline-grid; place-items: center; border: 1.5px solid var(--off); color: var(--muted); }
.badge.job-1 { background: var(--job-1); border-color: var(--job-1); color: var(--panel); }
.badge.job-2 { background: var(--job-2); border-color: var(--job-2); color: var(--panel); }
.badge.job-3 { background: var(--job-3); border-color: var(--job-3); color: var(--panel); }
.badge.job-4 { background: var(--job-4); border-color: var(--job-4); color: var(--panel); }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.76rem; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--off); flex: none; }
.dot.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.dot.part { background: var(--warn); }
.dot.hollow { background: transparent; border: 1.5px solid var(--off); }
.chip { display: inline-block; font-size: 0.78rem; padding: 2px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-weight: 500; }
.chip.job-1 { background: var(--job-1-soft); color: var(--job-1); }
.chip.job-2 { background: var(--job-2-soft); color: var(--job-2); }
.chip.job-3 { background: var(--job-3-soft); color: var(--job-3); }
.chip.job-4 { background: var(--job-4-soft); color: var(--job-4); }
.chip.plain { background: color-mix(in srgb, var(--off) 22%, transparent); color: var(--muted); }
.board { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.lane { display: grid; grid-template-columns: 124px minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; padding: 20px 22px; align-items: start; }
.lane + .lane { border-top: 2px dashed var(--line); }
.lane.idle { color: var(--muted); }
.lane-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.lane-num { font-family: var(--font-display); font-weight: 700; font-size: 2.3rem; line-height: 0.95; }
.lane-num .xx { font-size: 0.55em; color: var(--off); margin-left: 1px; }
.lane.job-1 .lane-num { color: var(--job-1); }
.lane.job-2 .lane-num { color: var(--job-2); }
.lane.job-3 .lane-num { color: var(--job-3); }
.lane.job-4 .lane-num { color: var(--job-4); }
.lane.idle .lane-num { color: var(--off); }
.lane-name { font-weight: 600; font-size: 0.88rem; overflow-wrap: anywhere; }
.lane.idle .lane-name { font-weight: 500; }
.ports { font-size: 0.82rem; color: var(--muted); }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.col-label { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.col p, .col li { font-size: 0.92rem; overflow-wrap: anywhere; }
.col ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.session { font-weight: 600; }
.lane.idle .session { font-weight: 500; }
.budget { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px 22px; display: flex; flex-direction: column; gap: 12px; }
.bar { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: color-mix(in srgb, var(--off) 18%, transparent); }
.seg { height: 100%; display: grid; place-items: center; font-family: var(--font-mono); font-weight: 500; font-size: 0.72rem; color: var(--panel); overflow: hidden; transition: opacity 0.2s; }
.seg.job-1 { background: var(--job-1); } .seg.job-2 { background: var(--job-2); } .seg.job-3 { background: var(--job-3); } .seg.job-4 { background: var(--job-4); }
.seg.plain { background: var(--off); }
.seg + .seg { border-left: 2px solid var(--panel); }
.scale { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.76rem; color: var(--muted); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.88rem; }
.table-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th { text-align: left; font-weight: 500; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding: 12px 16px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 10px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
td.mono { white-space: nowrap; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 40px 28px; }
.two > section { min-width: 0; }
footer { font-size: 0.86rem; color: var(--muted); display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 18px; }
@media (max-width: 820px) {
  .lane { grid-template-columns: 104px minmax(0, 1fr); gap: 14px 16px; }
  .lane > .col { grid-column: 2; }
  .lane-num { font-size: 1.9rem; }
  h1 { font-size: 1.7rem; }
}
@media (max-width: 420px) {
  .lane { grid-template-columns: 1fr; padding: 18px 16px; }
  .lane > .col { grid-column: 1; }
  .lane-id { flex-direction: row; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .two { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: no-preference) {
  .dot.on { animation: pulse 2.4s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--ok) 8%, transparent); } }
}
`;

// --- command line ---------------------------------------------------------------

function main(argv) {
  const [command, ...rest] = argv;
  const args = { repos: [], codeDir: join(homedir(), "Code"), config: join(homedir(), ".claude", "lane-map.json") };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (flag === "--repo") args.repos.push(value);
    else if (flag === "--code-dir") args.codeDir = value;
    else if (flag === "--config") args.config = value;
    else if (flag === "--sessions") args.sessions = value;
    else if (flag === "--facts") args.facts = value;
    else if (flag === "--notes") args.notes = value;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (command === "gather") {
    process.stdout.write(JSON.stringify(gather({ codeDir: args.codeDir, repos: args.repos, sessionsFile: args.sessions, configFile: args.config }), null, 1) + "\n");
  } else if (command === "summary") {
    if (!args.facts) throw new Error("summary needs --facts <file>");
    process.stdout.write(summary(JSON.parse(readFileSync(args.facts, "utf8"))));
  } else if (command === "render") {
    if (!args.facts || !args.notes) throw new Error("render needs --facts <file> --notes <file>");
    process.stdout.write(render(JSON.parse(readFileSync(args.facts, "utf8")), JSON.parse(readFileSync(args.notes, "utf8"))));
  } else {
    throw new Error("usage: lane-map.mjs gather [--code-dir <dir>] [--repo <dir>]... [--sessions <file>] | summary --facts <file> | render --facts <file> --notes <file>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`lane-map: ${e.message}\n`);
    process.exit(1);
  }
}
