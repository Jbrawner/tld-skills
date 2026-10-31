// Draws the Lane Map's body from facts and notes. It runs in two places: lane-map.mjs imports it
// to render the page, and the page carries this file's source so its Refresh button can redraw
// from fresh facts. So it stays plain browser JavaScript: no imports, nothing from Node, and no
// closing script tag anywhere in it.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Escape, then turn [text](https://…) into a link and `x` into code.
export function rich(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export const portPrefix = (ports) => String(ports ?? "").replace(/x+$/i, "");
export const clock = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, " ");
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

// What a lane's notes were written against. A refresh keeps a lane's notes only while this is
// unchanged: a lane that changed hands, started or stopped since then gets no stale sentence.
export const laneBasis = (l) => `${l.state}|${l.claimedBy}|${l.docker?.running ? "up" : "down"}`;
export const notesBasis = (facts) => Object.fromEntries(facts.lanes.map((l) => [l.key, laneBasis(l)]));

// Products worth a filter button: a lane in use, a process, or a session today.
export function productsShown(facts) {
  return [...new Set([
    ...facts.lanes.filter((l) => l.docker || l.state === "claimed").map((l) => l.product),
    ...facts.processes.map((p) => p.product),
    ...facts.sessions.map((s) => s.product).filter(Boolean),
    ...facts.lanes.map((l) => l.product),
  ])].filter((p) => p !== "unknown" || facts.lanes.some((l) => l.product === "unknown"));
}

// One rule set per product: picking it hides the other products' rows and dims their memory.
export function filterCss(facts) {
  return productsShown(facts).map((p) => {
    const s = slug(p);
    return `.wrap[data-filter="${s}"] .job[data-product]:not([data-product="${s}"]), .wrap[data-filter="${s}"] .lane:not([data-product="${s}"]), .wrap[data-filter="${s}"] tr[data-product]:not([data-product="${s}"]) { display: none; }
.wrap[data-filter="${s}"] .seg:not([data-product="${s}"]) { opacity: 0.22; }`;
  }).join("\n");
}

// ctx.notesAt is when Claude wrote the notes; ctx.basis each lane's laneBasis then.
export function renderBody(facts, notes, ctx = {}) {
  const names = notes.productNames ?? {};
  const pname = (p) => names[p] ?? (p === "unknown" ? "Not in any repo" : p);
  const basis = ctx.basis ?? null;
  const fresh = (l) => !basis || basis[l.key] === laneBasis(l);
  const changed = basis ? facts.lanes.filter((l) => !fresh(l) && (l.key in basis || l.docker?.running || l.state === "claimed")) : [];
  const lanesByKey = new Map(facts.lanes.map((l) => [l.key, l]));
  const jobs = (notes.jobs ?? [])
    .map((j) => ({ ...j, lanes: (j.lanes ?? []).filter((k) => lanesByKey.has(k) && fresh(lanesByKey.get(k))) }))
    .filter((j) => j.lanes.length)
    .map((j, i) => ({ ...j, index: (i % 4) + 1 }));
  const jobOf = (key) => jobs.find((j) => j.lanes.includes(key)) ?? null;
  const byId = new Map(facts.allSessions.map((s) => [s.id, s]));
  const laneNotes = notes.lanes ?? {};
  const short = (l) => portPrefix(l.ports) || l.label;
  const procsFor = (key) => facts.processes.filter((p) => p.lanes.includes(key));
  const laneProcs = new Set(facts.lanes.flatMap((l) => procsFor(l.key)));
  const looseProcs = facts.processes.filter((p) => !laneProcs.has(p) && (p.ports.length || p.label !== "Process"));
  const shown = productsShown(facts);
  const runningIn = (p) => facts.lanes.filter((l) => l.product === p && l.docker?.running).length;
  const notesAt = ctx.notesAt ?? facts.takenAt;
  const later = Date.parse(facts.takenAt) - Date.parse(notesAt) > 60000;

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
        <p>${notes.free && !changed.length ? rich(notes.free) : nextFree.join(" ") || "Nothing runs on these ranges."}</p>
      </article>`);
  }

  // Lane rows.
  const laneRows = facts.lanes.map((l) => {
    const j = jobOf(l.key);
    const n = fresh(l) ? laneNotes[l.key] ?? {} : {};
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

    const fallback = !fresh(l) ? `Changed since Claude's notes at ${clock(notesAt)}.` : l.state === "claimed" ? "No notes for this run." : d?.running ? "Up, with no notes for this run." : "Nothing.";
    const doing = [`<p>${n.doing ? rich(n.doing) : fallback}</p>`];
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
  const sessionsAge = facts.sessionsAt && Date.parse(facts.takenAt) - Date.parse(facts.sessionsAt) > 120000 ? ` Session states are as of ${clock(facts.sessionsAt)}, the last <code>/lane-map</code> run.` : "";
  const sessionsBlock = !facts.sessionsKnown
    ? `<p class="muted">The session list was not read this run.</p>`
    : sessionRows.length
      ? `<div class="table-wrap"><table><thead><tr><th>Session</th><th>Last active</th></tr></thead><tbody>${sessionRows.join("")}</tbody></table></div>
      <p class="muted">${others.some((s) => s.running) ? "Sessions marked working are mid-turn." : "All idle."} None of them holds a lane.${sessionsAge}</p>`
      : `<p class="muted">No other session was active today.${sessionsAge}</p>`;

  const filterBar = shown.length > 1
    ? `<div class="filters" role="group" aria-label="Show one product">
      <button type="button" class="filter" id="filter-all" data-pick="all" aria-pressed="true">All products</button>
      ${shown.map((p) => `<button type="button" class="filter" id="filter-${esc(slug(p))}" data-pick="${esc(slug(p))}" aria-pressed="false">${esc(pname(p))} <span class="count">${runningIn(p)}</span></button>`).join("")}
    </div>`
    : "";

  const lede = changed.length
    ? `Since Claude's notes at ${clock(notesAt)}, ${changed.map((l) => `${short(l)}xx`).join(", ")} changed, so ${changed.length === 1 ? "its notes are" : "their notes are"} left out. Run <code>/lane-map</code> for new notes.`
    : notes.lede ? rich(notes.lede) : "";
  const busy = new Set([...facts.lanes.filter((l) => l.state === "claimed").map((l) => `${l.product}/${l.claimedBy}`), ...facts.processes.map((p) => `${p.product}/${p.folder}`)]);
  const worktreeLine = facts.products.filter((p) => p.worktreeCount > 1 && !p.retired).map((p) => `${pname(p.name)} ${p.worktreeCount}`).join(", ");
  const hidden = facts.hiddenRetired ?? [];
  const title = notes.title ?? "Lane Map";

  return `
  <header>
    <span class="stamp">This Mac · snapshot ${esc(day(facts.takenAt))}, ${clock(facts.takenAt)}${later ? ` · notes from ${clock(notesAt)}` : ""}</span>
    <h1>${esc(title)}</h1>
    ${lede ? `<p class="lede">${lede}</p>` : ""}
    <div class="toolbar">
      ${filterBar}
      <div class="refresh-bar"><button type="button" class="refresh" id="lane-refresh">Refresh</button><span class="refresh-status" id="lane-refresh-status" role="status" aria-live="polite"></span></div>
    </div>
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
    <p>A lane is one local Supabase stack, named by its port range. Read from each repo's <code>.tld/stacks.md</code> or <code>supabase/config.toml</code>, Docker, git worktrees, running processes and the app's session list. Refresh reads this Mac again through the lane-map server when the page is open in the Claude desktop app; the Doing lines come from Claude's last <code>/lane-map</code> run.</p>
    ${worktreeLine ? `<p>Worktrees on disk: ${esc(worktreeLine)}. ${busy.size} ${busy.size === 1 ? "is" : "are"} in a lane or running something right now.</p>` : ""}
    ${hidden.length ? `<p>Left out while stopped: ${esc(hidden.map(pname).join(", "))}, retired in <code>~/.claude/lane-map/config.json</code>. A retired product's stack shows up here again if it starts.</p>` : ""}
  </footer>
`;
}
