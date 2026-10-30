// Run with: node --test lane-map/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStacks, parseConfigToml, productLanes, upSeconds, toMiB, hostPorts, parseDockerPs, groupContainers,
  parseDockerStats, parseWorktrees, etimeSeconds, parsePs, parseLsof, labelOf, placeOf, productProcesses,
  envPorts, laneOfPort, sessionFor, buildFacts, summary, render, rich, portRun, duration,
} from "./lane-map.mjs";

// --- recorded inputs, shaped like the real files and command output -------------------

const LAB = "/Users/me/Code/lab-inventory";
const MAIN = "/Users/me/Code/mAInCharacter";
const FM = "/Users/me/Code/footballtactics-ai";
const WT = (folder) => `${LAB}/.claude/worktrees/${folder}`;

const STACKS_MD = `# Local stacks

One owner per stack.

| Stack | Ports | Container | State | Claimed by | Since |
|---|---|---|---|---|---|
| 1 | 543xx | supabase_db_pooeyppuyzvwgcbqctzm | free |  |  |
| 2 | 546xx | supabase_db_lab_inventory_2 | claimed | walk-35fb9a-walk2 | 2026-10-30 |
| 3 | 547xx | supabase_db_lab_inventory_3 | free |  |  |
| 4 | 545xx | supabase_db_lab_inventory_4 | claimed | epic-a630c7 | 2026-10-29 |

## Rules

| Rule | How |
|---|---|
| A build lane claims the lowest free stack | lane-claim.sh |
`;

const MAIN_TOML = `# A string used to distinguish different Supabase projects on the same host.
project_id = "backend"

[api]
enabled = true
port = 54321

[db]
port = 54322
`;

const FM_TOML = `project_id = "tyvqtjqhwkobfmkzyope"

[api]
port = 54421

[db]
port = 54422

[studio]
port = 54423
`;

const DOCKER_PS = [
  "supabase_db_lab_inventory_4\tUp 5 minutes (healthy)\t0.0.0.0:54522->5432/tcp, [::]:54522->5432/tcp",
  "supabase_kong_lab_inventory_4\tUp 26 hours (healthy)\t0.0.0.0:54521->8000/tcp, [::]:54521->8000/tcp",
  "supabase_pg_meta_lab_inventory_4\tUp 26 hours (healthy)\t8080/tcp",
  "supabase_db_lab_inventory_2\tUp 22 minutes (healthy)\t0.0.0.0:54622->5432/tcp",
  "supabase_kong_lab_inventory_2\tUp 22 minutes (healthy)\t0.0.0.0:54621->8000/tcp",
  "supabase_inbucket_lab_inventory_2\tUp 22 minutes (healthy)\t0.0.0.0:54624->8025/tcp",
  "supabase_db_tyvqtjqhwkobfmkzyope\tUp About an hour (healthy)\t0.0.0.0:54422->5432/tcp",
  "supabase_kong_tyvqtjqhwkobfmkzyope\tUp About an hour (healthy)\t0.0.0.0:54421->8000/tcp",
  "supabase_db_mystery\tUp 3 days\t0.0.0.0:54922->5432/tcp",
  "redis\tUp 2 weeks\t0.0.0.0:6379->6379/tcp",
].join("\n");

const DOCKER_STATS = [
  "supabase_db_lab_inventory_4\t108.1MiB / 10.2GiB",
  "supabase_kong_lab_inventory_4\t204.2MiB / 10.2GiB",
  "supabase_pg_meta_lab_inventory_4\t96.12MiB / 10.2GiB",
  "supabase_db_lab_inventory_2\t333.8MiB / 10.2GiB",
  "supabase_kong_lab_inventory_2\t135.5MiB / 10.2GiB",
  "supabase_inbucket_lab_inventory_2\t34.69MiB / 10.2GiB",
  "supabase_db_tyvqtjqhwkobfmkzyope\t1.1GiB / 10.2GiB",
  "supabase_kong_tyvqtjqhwkobfmkzyope\t512KiB / 10.2GiB",
  "supabase_db_mystery\t200MiB / 10.2GiB",
  "redis\t20MiB / 10.2GiB",
].join("\n");

const LAB_WORKTREES = `worktree ${LAB}
HEAD bb41766a
branch refs/heads/main

worktree ${WT("epic-a630c7")}
HEAD 2c10c253
branch refs/heads/feature/LAB-5160_imports

worktree ${WT("walk-35fb9a")}
HEAD d9788c5f
detached

worktree ${WT("walk-35fb9a-walk2")}
HEAD d9788c5f
detached
`;

// ps -axo pid=,ppid=,etime=,command= ; the Stripe key is fake and must never reach the output.
const PS = `
    1     0 08-05:37:20 /sbin/launchd
  500     1 02-04:22:54 /Applications/Claude.app/Contents/Helpers/disclaimer --pgroup -- claude
  501   500 02-04:22:54 /Users/me/Library/Application Support/Claude/claude-code/2.1.309/x/claude.app/Contents/MacOS/claude
  502   501    01:10:00 node /Users/me/.npm/_npx/abc/node_modules/some-mcp/dist/index.js
  600     1    31:07 /bin/zsh -c source snapshot.sh && eval 'node e2e/run-shards.mjs'
  601   600    31:07 node e2e/staging-walk/run-shards.mjs --run-id 20261030 --stack-env ${LAB}/.tld/stack-2.env --stack-env ${LAB}/.tld/stack-5.env
  602   601    31:07 node ${WT("walk-35fb9a")}/frontend/node_modules/.bin/vite --port 8182 --strictPort
  603   601    31:05 node ${WT("walk-35fb9a")}/frontend/node_modules/.bin/playwright test -c playwright.walk.config.ts
  604   603    26:09 /Users/me/.nvm/versions/node/v20/bin/node ${WT("walk-35fb9a")}/frontend/node_modules/playwright/lib/common/process.js
  605   604    26:06 /Users/me/Library/Caches/ms-playwright/chrome-headless-shell --disable-field-trial-config
  606   601    31:03 stripe listen --api-key sk_test_FAKEKEY123 --forward-to localhost:54821
  700     1    01:00 -zsh
  800     1 08-05:37:20 /Users/me/.nvm/versions/node/v20/bin/node /Users/me/.nvm/versions/node/v22/bin/portless proxy start --foreground
  900     1    12:00 node ${FM}/node_modules/.bin/next dev --port 3000
`;

const CWDS = [500, 501, 502, 600, 601, 602, 603, 604, 605, 606, 700, 800, 900].map((pid) => {
  const dir = { 500: WT("epic-a630c7"), 501: WT("epic-a630c7"), 502: WT("epic-a630c7"), 700: WT("epic-a630c7"), 800: WT("old-9d6b50"), 900: FM, 1: "/" }[pid] ?? `${WT("walk-35fb9a")}/frontend`;
  return `p${pid}\nfcwd\nn${dir}`;
}).join("\n");

const LISTEN = `p602\nf20\nn*:8182\np800\nf22\nn*:1355\np900\nf21\nn*:3000\n`;

const PRODUCTS = [
  { name: "footballtactics-ai", path: FM },
  { name: "lab-inventory", path: LAB },
  { name: "mAInCharacter", path: MAIN },
];

const SESSIONS = [
  { sessionId: "local_epic", title: "Import Epic build", cwd: WT("epic-a630c7"), isRunning: true, isArchived: false, lastActivityAt: "2026-10-30T23:16:41Z", link: "claude://x/local_epic", startedBy: "local_bug" },
  { sessionId: "local_bug", title: "Import box collision bug", cwd: WT("bug-2bd9d5"), isRunning: false, isArchived: false, lastActivityAt: "2026-10-30T23:15:22Z" },
  { sessionId: "local_walk", title: "Local release walk", cwd: WT("walk-35fb9a"), isRunning: false, isArchived: false, lastActivityAt: "2026-10-30T23:03:37Z", startedBy: "local_notes" },
  { sessionId: "local_notes", title: "Release notes <Feature>", cwd: WT("old-9d6b50"), isRunning: false, isArchived: false, lastActivityAt: "2026-10-30T23:00:04Z" },
  { sessionId: "local_fm", title: "FM27 research", cwd: `${FM}/.claude/worktrees/obj-9f4265`, isRunning: false, isArchived: false, lastActivityAt: "2026-10-30T21:00:40Z" },
  { sessionId: "local_old", title: "Old sweep", cwd: WT("walk-35fb9a"), isRunning: false, isArchived: false, lastActivityAt: "2026-10-18T05:12:59Z" },
];

function rawFixture(overrides = {}) {
  const processes = productProcesses({ procs: parsePs(PS), cwds: parseLsof(CWDS), listeners: parseLsof(LISTEN), products: PRODUCTS });
  return {
    takenAt: "2026-10-30T23:18:00Z",
    products: [
      { name: "footballtactics-ai", path: FM, stacksMd: null, configs: [FM_TOML], worktrees: `worktree ${FM}\nHEAD a\nbranch refs/heads/main\n` },
      { name: "lab-inventory", path: LAB, stacksMd: STACKS_MD, configs: [MAIN_TOML], worktrees: LAB_WORKTREES },
      { name: "mAInCharacter", path: MAIN, stacksMd: null, configs: [MAIN_TOML], worktrees: `worktree ${MAIN}\nHEAD b\nbranch refs/heads/main\n` },
    ],
    dockerPs: DOCKER_PS,
    dockerStats: DOCKER_STATS,
    dockerMemTotal: 10.2 * 1024 * 1048576,
    processes,
    envPorts: { 602: [54621], 603: [54621], 606: [], 900: [54421] },
    listeningPorts: [8182, 1355, 3000],
    portlessRoutes: [{ hostname: "lab-2492.localhost", port: 60423 }, { hostname: "live.localhost", port: 8182 }],
    portlessProxy: { seconds: 712484, port: "1355" },
    git: { "lab-inventory/epic-a630c7": { commitsToday: 30, last: { sha: "2c10c253", at: "2026-10-30T22:30:00Z", subject: "story gate" } } },
    sessions: SESSIONS,
    ...overrides,
  };
}

// --- where lanes are defined ------------------------------------------------------

test("the registry is the first table only, one row per stack", () => {
  const rows = parseStacks(STACKS_MD);
  assert.deepEqual(rows.map((r) => r.stack), [1, 2, 3, 4]);
  assert.deepEqual(rows[1], { stack: 2, ports: "546xx", container: "supabase_db_lab_inventory_2", state: "claimed", claimedBy: "walk-35fb9a-walk2", since: "2026-10-30" });
});

test("a config.toml gives its project id and the [api] port's range, not another section's port", () => {
  assert.deepEqual(parseConfigToml(FM_TOML), { projectId: "tyvqtjqhwkobfmkzyope", ports: "544xx" });
  assert.deepEqual(parseConfigToml(MAIN_TOML), { projectId: "backend", ports: "543xx" });
  assert.equal(parseConfigToml("[db]\nport = 1\n"), null);
});

test("a repo with a registry is read from the registry; its config.toml adds nothing", () => {
  const lab = productLanes("lab-inventory", { stacksMd: STACKS_MD, configs: [MAIN_TOML] });
  assert.deepEqual(lab.map((l) => l.key), ["lab-inventory:1", "lab-inventory:2", "lab-inventory:3", "lab-inventory:4"]);
  assert.equal(lab[0].project, "pooeyppuyzvwgcbqctzm");
  const fm = productLanes("footballtactics-ai", { stacksMd: null, configs: [FM_TOML] });
  assert.deepEqual(fm.map((l) => [l.key, l.label, l.state, l.ports]), [["footballtactics-ai:local", "Local stack", "unmanaged", "544xx"]]);
});

// --- Docker -----------------------------------------------------------------

test("Docker uptimes and memory units read as numbers", () => {
  assert.equal(upSeconds("Up 5 minutes (healthy)"), 300);
  assert.equal(upSeconds("Up 26 hours"), 93600);
  assert.equal(upSeconds("Up About an hour (healthy)"), 3600);
  assert.equal(upSeconds("Up Less than a second"), 0);
  assert.equal(upSeconds("Exited (0) 3 hours ago"), null);
  assert.equal(toMiB("333.8MiB"), 333.8);
  assert.equal(toMiB("1.5GiB"), 1536);
  assert.equal(toMiB("512KiB"), 0.5);
  assert.deepEqual(hostPorts("0.0.0.0:54522->5432/tcp, [::]:54522->5432/tcp, 8080/tcp"), [{ host: 54522, inner: 5432 }]);
});

test("containers group by project; an unknown db starts its own group; the rest is other memory", () => {
  const { groups, otherMiB } = groupContainers(parseDockerPs(DOCKER_PS), parseDockerStats(DOCKER_STATS), ["lab_inventory_4", "lab_inventory_2", "tyvqtjqhwkobfmkzyope"]);
  const lab4 = groups.get("lab_inventory_4");
  assert.equal(lab4.running, true);
  assert.equal(lab4.containers, 3);
  assert.equal(lab4.upSeconds, 93600);
  assert.equal(lab4.dbUpSeconds, 300);
  assert.equal(lab4.memMiB, 408);
  assert.deepEqual(lab4.ports, [{ port: 54522, role: "db" }, { port: 54521, role: "kong" }]);
  assert.equal(groups.get("tyvqtjqhwkobfmkzyope").memMiB, 1127);
  assert.equal(groups.get("mystery").running, true);
  assert.equal(otherMiB, 20);
});

// --- git and processes ----------------------------------------------------------------

test("worktrees, elapsed times, ps rows and lsof fields parse", () => {
  const wts = parseWorktrees(LAB_WORKTREES);
  assert.deepEqual(wts.map((w) => [w.folder, w.branch]), [["lab-inventory", "main"], ["epic-a630c7", "feature/LAB-5160_imports"], ["walk-35fb9a", null], ["walk-35fb9a-walk2", null]]);
  assert.equal(etimeSeconds("31:07"), 1867);
  assert.equal(etimeSeconds("01:10:00"), 4200);
  assert.equal(etimeSeconds("08-05:37:20"), 711440);
  assert.equal(parsePs(PS).find((p) => p.pid === 602).ppid, 601);
  assert.deepEqual(parseLsof(LISTEN)[0], { pid: 602, name: "*:8182" });
});

test("a process gets a fixed label, never its command line", () => {
  assert.deepEqual(labelOf("node x/node_modules/.bin/vite --port 8182"), { label: "Vite dev server", known: true });
  assert.deepEqual(labelOf("node x/node_modules/.bin/vitest run"), { label: "Vitest run", known: true });
  assert.deepEqual(labelOf("stripe listen --api-key sk_test_FAKEKEY123"), { label: "Stripe forwarder", known: true });
  assert.deepEqual(labelOf("node e2e/staging-walk/run-shards.mjs --run-id 1"), { label: "Script run-shards.mjs", known: false });
  assert.deepEqual(labelOf("/opt/bin/thing --token abc"), { label: "Process", known: false });
});

test("a path places in its product and worktree folder; the main checkout is the repo's name", () => {
  assert.deepEqual(placeOf(`${WT("walk-35fb9a")}/frontend`, PRODUCTS), { product: "lab-inventory", folder: "walk-35fb9a" });
  assert.deepEqual(placeOf(`${LAB}/backend`, PRODUCTS), { product: "lab-inventory", folder: "lab-inventory" });
  assert.equal(placeOf("/Users/me/elsewhere", PRODUCTS), null);
});

test("product processes leave out Claude, its MCP servers, shells, the portless proxy and helper children", () => {
  const procs = productProcesses({ procs: parsePs(PS), cwds: parseLsof(CWDS), listeners: parseLsof(LISTEN), products: PRODUCTS });
  assert.deepEqual(procs.map((p) => [p.pid, p.label, p.product, p.folder]), [
    [601, "Script run-shards.mjs", "lab-inventory", "walk-35fb9a"],
    [602, "Vite dev server", "lab-inventory", "walk-35fb9a"],
    [603, "Playwright run", "lab-inventory", "walk-35fb9a"],
    [606, "Stripe forwarder", "lab-inventory", "walk-35fb9a"],
    [900, "Next dev server", "footballtactics-ai", "footballtactics-ai"],
  ]);
  assert.deepEqual(procs[0].stackFiles, [2, 5]);
  assert.deepEqual(procs[1].ports, [8182]);
});

test("from a process environment only the local Supabase and database ports are kept", () => {
  const env = "node vite VITE_SUPABASE_URL=http://127.0.0.1:54821 SUPABASE_SERVICE_ROLE_KEY=eyJsecret DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54822/postgres NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co";
  assert.deepEqual(envPorts(env), [54821, 54822]);
});

// --- sessions ---------------------------------------------------------------

test("a claim finds its session by worktree, a shard worktree by its parent's name, the running one first", () => {
  assert.equal(sessionFor("lab-inventory", "epic-a630c7", SESSIONS, PRODUCTS).sessionId, "local_epic");
  assert.equal(sessionFor("lab-inventory", "walk-35fb9a-walk2", SESSIONS, PRODUCTS).sessionId, "local_walk");
  assert.equal(sessionFor("lab-inventory", "nobody-here", SESSIONS, PRODUCTS), null);
  assert.equal(sessionFor("footballtactics-ai", "walk-35fb9a", SESSIONS, PRODUCTS), null);
});

// --- facts --------------------------------------------------------------------

test("facts: every product's stacks are lanes in port order, an unknown running stack too", () => {
  const f = buildFacts(rawFixture());
  assert.deepEqual(f.lanes.map((l) => l.key), [
    "lab-inventory:1", "mAInCharacter:local", "footballtactics-ai:local", "lab-inventory:4", "lab-inventory:2", "lab-inventory:3", "unknown:mystery",
  ]);
  const lane = (key) => f.lanes.find((l) => l.key === key);
  assert.deepEqual(lane("lab-inventory:1").sharesPortsWith, ["mAInCharacter:local"]);
  assert.equal(lane("footballtactics-ai:local").docker.running, true);
  assert.equal(lane("unknown:mystery").ports, "549xx");
  assert.equal(lane("lab-inventory:4").session.id, "local_epic");
  assert.equal(lane("lab-inventory:4").worktree.git.commitsToday, 30);
  assert.equal(lane("lab-inventory:2").session.id, "local_walk");
  assert.equal(f.dockerLimitMiB, 10445);
  assert.equal(f.otherContainersMiB, 20);
});

test("facts: a process points at lanes by its stack files and its environment, in its own product first", () => {
  const f = buildFacts(rawFixture());
  const proc = (pid) => f.processes.find((p) => p.pid === pid);
  assert.deepEqual(proc(601).lanes, ["lab-inventory:2"]);
  assert.deepEqual(proc(602).lanes, ["lab-inventory:2"]);
  assert.deepEqual(proc(606).lanes, []);
  assert.deepEqual(proc(900).lanes, ["footballtactics-ai:local"]);
  assert.equal(proc(602).session, "local_walk");
  const shared = laneOfPort(54321, f.lanes, "mAInCharacter");
  assert.equal(shared.key, "mAInCharacter:local");
});

test("facts: today's sessions only, each marked when it holds a lane", () => {
  const f = buildFacts(rawFixture());
  assert.deepEqual(f.sessions.map((s) => [s.id, s.holdsLane, s.product]), [
    ["local_epic", true, "lab-inventory"], ["local_bug", false, "lab-inventory"], ["local_walk", true, "lab-inventory"],
    ["local_notes", false, "lab-inventory"], ["local_fm", false, "footballtactics-ai"],
  ]);
});

test("a retired product's stopped lane leaves the map, and the range it shared is no longer flagged", () => {
  const f = buildFacts(rawFixture({ retired: ["mAInCharacter"] }));
  assert.ok(!f.lanes.some((l) => l.product === "mAInCharacter"));
  assert.deepEqual(f.lanes.find((l) => l.key === "lab-inventory:1").sharesPortsWith, []);
  assert.deepEqual(f.hiddenRetired, ["mAInCharacter"]);
  const html = render(f, NOTES);
  assert.ok(!html.includes('id="filter-maincharacter"'));
  assert.ok(!html.includes("Shares 543xx"));
  assert.ok(html.includes("Left out while stopped: mAInCharacter, retired in <code>~/.claude/lane-map.json</code>."));
});

test("a retired product whose stack is up stays on the map, flagged", () => {
  const f = buildFacts(rawFixture({ retired: ["footballtactics-ai"] }));
  const fm = f.lanes.find((l) => l.key === "footballtactics-ai:local");
  assert.equal(fm.retired, true);
  assert.deepEqual(f.hiddenRetired, []);
  assert.ok(render(f, NOTES).includes("Retired product, but its stack is up"));
});

test("facts never carry a key from a command line or an environment", () => {
  const json = JSON.stringify(buildFacts(rawFixture()));
  assert.ok(!json.includes("sk_test_FAKEKEY123"));
  assert.ok(!json.includes("--api-key"));
  assert.ok(!json.includes("eyJ"));
});

// --- render -------------------------------------------------------------------

const NOTES = {
  lede: "Two jobs hold three lanes.",
  productNames: { "footballtactics-ai": "Assman.AI" },
  jobs: [
    { name: "Local release walk", lanes: ["lab-inventory:2"], session: "local_walk", summary: "Shard 1 on `546xx`." },
    { name: "Import Epic build", lanes: ["lab-inventory:4"], session: "local_epic", summary: "[LAB-5160](https://example.atlassian.net/browse/LAB-5160) imports." },
  ],
  lanes: { "lab-inventory:4": { doing: "Building <b>tickets</b>.", chip: "Working now" } },
};

test("render: notes are escaped, with links and code the only markup", () => {
  assert.equal(rich("a <script>x</script> `b` [c](https://d.e/f)"), 'a &lt;script&gt;x&lt;/script&gt; <code>b</code> <a href="https://d.e/f">c</a>');
  assert.equal(rich("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  const html = render(buildFacts(rawFixture()), NOTES);
  assert.ok(html.includes("Building &lt;b&gt;tickets&lt;/b&gt;."));
  assert.ok(html.includes("Release notes &lt;Feature&gt;"));
  assert.ok(!html.includes("<b>tickets</b>"));
});

test("render: the page is titled Lane Map, with one filter button per product in use", () => {
  const html = render(buildFacts(rawFixture()), NOTES);
  assert.match(html, /^<title>Lane Map<\/title>/);
  for (const id of ["filter-all", "filter-lab-inventory", "filter-footballtactics-ai", "filter-mainCharacter".toLowerCase(), "filter-unknown"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.includes(">Assman.AI <span class=\"count\">1</span>"));
  assert.ok(html.includes('.wrap[data-filter="footballtactics-ai"] .lane:not([data-product="footballtactics-ai"])'));
});

test("render: lanes carry their job's colour, shared ranges are flagged, a reset is noticed", () => {
  const html = render(buildFacts(rawFixture()), NOTES);
  assert.match(html, /<div class="lane job-1" data-product="lab-inventory">\s*<div class="lane-id"><span class="lane-num">546/);
  assert.match(html, /<div class="lane job-2" data-product="lab-inventory">\s*<div class="lane-id"><span class="lane-num">545/);
  assert.match(html, /<div class="lane loose" data-product="footballtactics-ai">/);
  assert.ok(html.includes("Shares 543xx with mAInCharacter"));
  assert.ok(html.includes("Database restarted at"));
  assert.ok(html.includes("lab-inventory&#39;s next claim takes 547xx."));
});

test("render: the memory bar is drawn to the Docker limit's scale and counts every product", () => {
  const html = render(buildFacts(rawFixture()), NOTES);
  const lab4 = /<div class="seg job-2" data-product="lab-inventory" style="width: ([\d.]+)%"/.exec(html);
  assert.equal(Number(lab4[1]), Number(((408 / 10445) * 100).toFixed(1)));
  assert.match(html, /<div class="seg plain" data-product="footballtactics-ai"/);
  assert.match(html, /in use by 4 running lanes \(Assman\.AI 1, lab-inventory 2, Not in any repo 1\)/);
});

test("render: sessions that hold no lane are listed with what they started", () => {
  const html = render(buildFacts(rawFixture()), NOTES);
  assert.ok(html.includes("lab-inventory · Started Local release walk"));
  assert.ok(html.includes("lab-inventory · Started Import Epic build"));
  assert.ok(html.includes("Assman.AI"));
});

test("summary: one line per lane, its processes under it, then the rest", () => {
  const text = summary(buildFacts(rawFixture()));
  assert.match(text, /^lab-inventory:1 543xx \| free \| stopped$/m);
  assert.match(text, /^lab-inventory:4 545xx \| claimed by epic-a630c7 since 2026-10-29 \| session local_epic "Import Epic build" RUNNING \| up 26 h, 0\.4 GB, db up 5 min \| feature\/LAB-5160_imports, 30 today, last 2c10c253 story gate$/m);
  assert.match(text, /^ {4}Vite dev server :8182 \[lab-inventory\/walk-35fb9a session local_walk\]$/m);
  assert.match(text, /^no lane:\n {4}Stripe forwarder \[lab-inventory\/walk-35fb9a session local_walk\]$/m);
  assert.match(text, /^ {4}local_bug "Import box collision bug" \[lab-inventory\]$/m);
  assert.ok(!text.includes("sk_test"));
});

test("small formatters", () => {
  assert.equal(portRun([54524, 54521, 54522]), "54521 / 22 / 24");
  assert.equal(duration(1320), "22 min");
  assert.equal(duration(93600), "26 h");
  assert.equal(duration(712484), "8 days");
});
