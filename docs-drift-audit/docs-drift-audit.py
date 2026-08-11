#!/usr/bin/env python3
"""docs-drift-audit.py — project-agnostic documentation-vs-code drift sweep.

READ-ONLY. Reads documentation files and the repository, runs the read-only
verification commands the project's baseline declares, and prints findings.
It never writes, moves, or deletes anything.

Usage (baseline optional):
    python3 docs-drift-audit.py --repo <repo-root> --baseline <baseline.toml>
    python3 docs-drift-audit.py --repo <repo-root>       # no baseline: defaults only

Emits one table. Each row is: SEVERITY | CHECK | OBJECT | STATUS | DETAIL
    STATUS = NEW              -> on no list. Triage it; treat as real until proven otherwise.
    STATUS = KNOWN-OPEN <KEY> -> already tracked by that ticket. Not new; do not re-file.
    STATUS = SKIPPED          -> the check could not run. NOT a pass.

Exit codes describe whether the sweep RAN, never whether it found anything:
    0  COMPLETE  every configured check executed
    1  PARTIAL   at least one check could not execute
    2  NOT-RUN   fatal: no documentation root could be resolved

Nothing in this file is time-bound. No month, year, or date literal appears in
any lookup. Timestamps are only ever compared to each other as deltas, computed
at run time. Do not add a dated constant here.
"""

from __future__ import annotations

import argparse
import fnmatch
import glob
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11
    sys.exit(
        "FATAL: this engine needs Python 3.11 or newer for tomllib "
        "(the baseline is TOML so it can carry written reasons as comments)."
    )

# --------------------------------------------------------------------------------------
# Defaults. Every one of these is overridable from the baseline's [config] table.
# --------------------------------------------------------------------------------------

DEFAULT_CONFIG: dict[str, object] = {
    # Documentation to sweep. Overridden by [[doc_roots]] entries in the baseline.
    "doc_globs": ["**/*.md", "**/*.mdx", "**/*.txt"],
    # Docs that exist but cannot be text-scanned. Always reported as not machine-checked.
    "binary_globs": ["**/*.docx", "**/*.pdf", "**/*.pptx", "**/*.xlsx", "**/*.key", "**/*.pages"],
    "exclude_globs": [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.venv/**",
        "**/vendor/**",
        "**/~$*",
        "**/.DS_Store",
    ],
    # File extensions that make a token look like a path to a real file rather than prose.
    "path_extensions": [
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte",
        "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "cs", "php",
        "sql", "sh", "bash", "zsh", "ps1",
        "json", "toml", "yml", "yaml", "ini", "cfg", "env",
        "md", "mdx", "txt", "rst",
        "css", "scss", "less", "html", "xml", "tf", "gradle", "proto", "graphql",
    ],
    # Extra prefixes to try when resolving a path reference, for projects whose docs write paths
    # as a subtree sees them (e.g. "src/foo.ts" when the file is at "app/src/foo.ts"). Each entry
    # widens what counts as resolvable, so add one only when the project genuinely writes paths
    # that way. A path is always tried doc-relative and repo-relative first, without config.
    "path_search_roots": [],
    # Turn individual checks off if a project genuinely does not want them.
    "path_check": True,
    "stale_check": True,
    # Only flag a doc as stale when the code it describes moved on by more than this many
    # days. A relative window, computed at run time. Never a calendar date.
    "stale_days": 30,
    # Owner/Name of the repository, so links of the form
    # https://github.com/Owner/Name/blob/<ref>/<path> are resolved to <path> and checked.
    "github_repo": "",
    "command_timeout": 60,
    # Where this audit files findings, for repos with no tracker config of their own.
    "tracker": "",
    "tracker_cloud_id": "",
    "tracker_project": "",
    "ticket_labels": "",
}

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "INFO": 3}

# Backstop only, not a sandbox. Baseline commands are committed, reviewed project config;
# this list catches an obvious mistake, it does not make a hostile baseline safe.
DESTRUCTIVE_TOKENS = [
    "rm ", "rmdir", "mv ", "dd ", "mkfs", "truncate", "shred",
    "chmod", "chown", "sudo", "curl", "wget", "nc ", "ssh ",
    "git push", "git commit", "git reset", "git checkout", "git clean", "git rm",
    "npm publish", "pip install", "npm install", "yarn add",
    "drop table", "delete from", "insert into", "update ",
]

REDIRECT_SAFE = ["2>/dev/null", ">/dev/null", "2>&1"]

MD_LINK = re.compile(r"\[[^\]\n]*\]\(\s*([^)\s]+)")
CODE_SPAN = re.compile(r"`([^`\n]{1,300})`")
GLOBBY = re.compile(r"[*?\[\]{}<>|\"']")


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------


def matches_any(path_str: str, patterns: list[str]) -> bool:
    """Glob-match a relative path, reading `**/` the way people write it.

    `fnmatch` wants a literal slash for the `**/` prefix, so `**/*.md` silently misses `README.md`
    at the root of a doc tree. Sweeping fewer documents than the config asked for, without saying
    so, is exactly the inert-check failure this audit exists to catch, so the prefix is also tried
    stripped. `*` already spans separators under fnmatch, so nothing else needs special handling.
    """
    for pat in patterns:
        if fnmatch.fnmatch(path_str, pat):
            return True
        if pat.startswith("**/") and fnmatch.fnmatch(path_str, pat[3:]):
            return True
    return False


def run_cmd(cmd: str, cwd: Path, timeout: int) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except subprocess.TimeoutExpired:
        return 124, "", f"timed out after {timeout}s"
    except Exception as exc:  # noqa: BLE001 - report, never crash the sweep
        return 1, "", str(exc)


def command_is_refused(cmd: str) -> str | None:
    """Return the offending token when a baseline command looks like it writes."""
    probe = cmd.lower()
    for safe in REDIRECT_SAFE:
        probe = probe.replace(safe, " ")
    for token in DESTRUCTIVE_TOKENS:
        if token in probe:
            return token.strip()
    if ">" in probe:
        return "> (output redirection)"
    return None


def git_timestamp(repo: Path, pathspecs: list[str], timeout: int) -> int | None:
    """Newest commit time touching any of these pathspecs, or None if git cannot say."""
    if not pathspecs:
        return None
    args = ["git", "-C", str(repo), "log", "-1", "--format=%ct", "--"] + pathspecs
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except Exception:  # noqa: BLE001
        return None
    out = proc.stdout.strip()
    if proc.returncode != 0 or not out:
        return None
    try:
        return int(out.splitlines()[0])
    except ValueError:
        return None


def file_timestamp(path: Path) -> int | None:
    try:
        return int(path.stat().st_mtime)
    except OSError:
        return None


# --------------------------------------------------------------------------------------
# Baseline
# --------------------------------------------------------------------------------------


class Baseline:
    def __init__(self, data: dict, source: str | None):
        self.source = source
        self.config = dict(DEFAULT_CONFIG)
        self.config.update(data.get("config", {}) or {})
        self.doc_roots = data.get("doc_roots", []) or []
        self.anchors = data.get("anchors", []) or []
        self.retired_terms = data.get("retired_terms", []) or []
        self.watches = data.get("watches", []) or []
        self.accepted = data.get("accepted", []) or []
        self.known_open = data.get("known_open", []) or []

    @classmethod
    def load(cls, path: Path | None) -> "Baseline":
        if path is None:
            return cls({}, None)
        with path.open("rb") as fh:
            data = tomllib.load(fh)
        return cls(data, str(path))

    def accepted_reason(self, check: str, objkey: str) -> str | None:
        for row in self.accepted:
            if row.get("objkey") != objkey:
                continue
            if row.get("check", "*") in ("*", check):
                return row.get("reason", "(no reason recorded)")
        return None

    def known_ticket(self, objkey: str) -> str | None:
        for row in self.known_open:
            if row.get("objkey") == objkey:
                return row.get("ticket")
        return None


# --------------------------------------------------------------------------------------
# Document inventory
# --------------------------------------------------------------------------------------


class Doc:
    __slots__ = ("key", "path", "root_name", "kind", "text", "read_error")

    def __init__(self, key: str, path: Path, root_name: str, kind: str):
        self.key = key
        self.path = path
        self.root_name = root_name
        self.kind = kind  # "text" | "binary"
        self.text: str | None = None
        self.read_error: str | None = None


def resolve_roots(baseline: Baseline, repo: Path) -> tuple[list[tuple[str, Path]], list[str]]:
    """Return [(name, absolute path)] plus a list of roots that could not be resolved."""
    entries = baseline.doc_roots
    if not entries:
        # No baseline, or a baseline that named none: fall back to a conventional docs dir,
        # then to the repo root itself, so the sweep still produces something useful.
        for candidate in ("docs", "doc", "documentation"):
            if (repo / candidate).is_dir():
                return [(candidate, repo / candidate)], []
        return [("repo", repo)], []

    resolved: list[tuple[str, Path]] = []
    missing: list[str] = []
    for entry in entries:
        name = entry.get("name") or entry.get("path") or "root"
        raw = entry.get("path", "")
        expanded = os.path.expanduser(raw)
        if any(ch in expanded for ch in "*?["):
            # A glob keeps machine-specific segments (a synced-drive account folder, a versioned
            # directory) out of a committed baseline. First match wins, sorted for determinism.
            hits = sorted(p for p in glob.glob(expanded) if os.path.isdir(p))
            if hits:
                resolved.append((name, Path(hits[0])))
            else:
                missing.append(f"{name} -> {raw} (no directory matched the pattern)")
            continue
        p = Path(expanded)
        if not p.is_absolute():
            p = repo / p
        if p.is_dir():
            resolved.append((name, p))
        else:
            missing.append(f"{name} -> {raw}")
    return resolved, missing


def iter_tree(root: Path, skipped: list[str]) -> list[Path]:
    """Walk root, pruning any subdirectory that is its own checkout.

    A directory carrying a .git entry is a linked worktree, a submodule, or a nested clone. Its
    documents are another branch's copy of the same tree, so descending into it sweeps every doc
    once per checkout: the duplicates read exactly like real findings at triage, they carry a path
    no reviewer can act on, and their identity disappears the moment the worktree is deleted, so
    the baseline can never settle. Presence of .git is the test rather than the directory name,
    because worktrees take arbitrary names and only some projects park them under a predictable
    parent. Each pruned directory is appended to skipped so the report can name it: a tree quietly
    narrowed reads exactly like a tree with nothing wrong in it.
    """
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        keep = []
        for d in sorted(dirnames):
            child = here / d
            if (child / ".git").exists():
                skipped.append(child.as_posix())
                continue
            keep.append(d)
        dirnames[:] = keep
        for f in sorted(filenames):
            out.append(here / f)
    return out


def collect_docs(roots: list[tuple[str, Path]], cfg: dict) -> tuple[list[Doc], int, list[str]]:
    """Return the swept documents, how many were dropped by exclude_globs, and pruned checkouts.

    The exclusion count is returned so scoping is never invisible: a doc set narrowed by config
    reads exactly like a doc set with nothing wrong in it unless the report says how many were
    left out. Nested checkouts are returned by name for the same reason.
    """
    docs: list[Doc] = []
    seen: set[str] = set()
    excluded = 0
    skipped_checkouts: list[str] = []
    doc_globs = list(cfg["doc_globs"])
    binary_globs = list(cfg["binary_globs"])
    exclude_globs = list(cfg["exclude_globs"])

    for name, root in roots:
        for path in iter_tree(root, skipped_checkouts):
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            full = path.as_posix()
            if matches_any(rel, exclude_globs) or matches_any(full, exclude_globs):
                if matches_any(rel, doc_globs) or matches_any(rel, binary_globs):
                    excluded += 1
                continue
            if path.name.startswith("~$"):
                continue
            if matches_any(rel, doc_globs):
                kind = "text"
            elif matches_any(rel, binary_globs):
                kind = "binary"
            else:
                continue
            key = f"{name}/{rel}"
            if key in seen:
                continue
            seen.add(key)
            docs.append(Doc(key, path, name, kind))

    for doc in docs:
        if doc.kind != "text":
            continue
        try:
            doc.text = doc.path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                doc.text = doc.path.read_text(encoding="utf-8", errors="replace")
                doc.read_error = "decoded with replacement characters"
            except OSError as exc:
                doc.read_error = str(exc)
        except OSError as exc:
            doc.read_error = str(exc)
    return docs, excluded, skipped_checkouts


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------


class Finding:
    __slots__ = ("severity", "check", "objkey", "detail", "status")

    def __init__(self, severity: str, check: str, objkey: str, detail: str, status: str = "NEW"):
        self.severity = severity
        self.check = check
        self.objkey = objkey
        self.detail = detail
        self.status = status

    def as_dict(self) -> dict:
        return {
            "severity": self.severity,
            "check": self.check,
            "object": self.objkey,
            "status": self.status,
            "detail": self.detail,
        }


def extract_path_candidates(text: str, cfg: dict) -> set[str]:
    """Tokens in a doc that look like they name a real file in the repository.

    Deliberately over-inclusive on shape and strict on syntax: a token has to have a
    directory separator and a known file extension (or a trailing slash) before it is
    checked at all, which keeps route names like `/some-page` out of the results.
    """
    exts = {e.lower().lstrip(".") for e in cfg["path_extensions"]}
    github_repo = str(cfg.get("github_repo") or "").strip("/")
    blob_re = (
        re.compile(
            r"https?://(?:www\.)?github\.com/"
            + re.escape(github_repo)
            + r"/(?:blob|tree)/[^/\s]+/([^)\s#?]+)"
        )
        if github_repo
        else None
    )

    raw: set[str] = set()
    for match in MD_LINK.finditer(text):
        raw.add(match.group(1))
    for match in CODE_SPAN.finditer(text):
        raw.add(match.group(1))
    if blob_re:
        for match in blob_re.finditer(text):
            raw.add(match.group(1))

    out: set[str] = set()
    for token in raw:
        tok = token.strip().strip("<>")
        tok = tok.split("#", 1)[0].split("?", 1)[0]
        tok = tok.rstrip(".,;:)")
        if not tok or GLOBBY.search(tok):
            continue
        if "://" in tok:
            if not blob_re:
                continue
            m = blob_re.fullmatch(tok) or blob_re.match(tok)
            if not m:
                continue
            tok = m.group(1)
        if any(ch.isspace() for ch in tok):
            continue
        if tok.startswith("//") or tok.startswith("~"):
            continue
        if tok.startswith("./"):
            tok = tok[2:]
        tok = tok.lstrip("/")
        if not tok or ".." in tok.split("/"):
            continue
        if "/" not in tok:
            continue
        if tok.endswith("/"):
            out.add(tok)
            continue
        ext = tok.rsplit(".", 1)[-1].lower() if "." in tok.rsplit("/", 1)[-1] else ""
        if ext in exts:
            out.add(tok)
    return out


def path_resolves(tok: str, doc: Doc, repo: Path, cfg: dict) -> bool:
    """A path reference resolves if any legitimate reading of it names something real.

    Doc-relative comes first because that is what a markdown link literally means. Repo-relative
    is next because prose usually writes paths from the repo root. Anything further is a project
    convention and has to be declared in the baseline.
    """
    bases = [doc.path.parent, repo]
    bases += [repo / str(extra) for extra in cfg.get("path_search_roots", [])]
    want_dir = tok.endswith("/")
    for base in bases:
        target = base / tok
        if target.is_dir() if want_dir else target.exists():
            return True
    return False


def check_paths(docs: list[Doc], repo: Path, cfg: dict) -> list[Finding]:
    findings: list[Finding] = []
    for doc in docs:
        if doc.kind != "text" or not doc.text:
            continue
        for tok in sorted(extract_path_candidates(doc.text, cfg)):
            if path_resolves(tok, doc, repo, cfg):
                continue
            findings.append(
                Finding(
                    "MEDIUM",
                    "broken-repo-path",
                    f"{doc.key} :: path:{tok}",
                    f"Doc names path `{tok}`, which does not resolve doc-relative, "
                    "repo-relative, or under any configured search root",
                )
            )
    return findings


def check_anchors(
    baseline: Baseline, docs_by_key: dict[str, Doc], repo: Path, cfg: dict
) -> tuple[list[Finding], list[str]]:
    findings: list[Finding] = []
    skipped: list[str] = []
    timeout = int(cfg["command_timeout"])

    for anchor in baseline.anchors:
        aid = anchor.get("id") or "(unnamed)"
        dockey = anchor.get("doc", "")
        objkey = f"{dockey} :: anchor:{aid}"
        doc = docs_by_key.get(dockey)

        if doc is None:
            findings.append(
                Finding(
                    "HIGH",
                    "doc-missing",
                    objkey,
                    f"Baseline anchor `{aid}` names doc `{dockey}`, which is not in the swept "
                    "set. The check is inert until the doc path is corrected or the anchor removed",
                )
            )
            continue
        if doc.kind != "text" or not doc.text:
            skipped.append(f"anchor:{aid} — doc `{dockey}` is not text-readable")
            findings.append(
                Finding("INFO", "anchor-unreadable", objkey, "Doc is not text-readable", "SKIPPED")
            )
            continue

        pattern = anchor.get("extract", "")
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error as exc:
            skipped.append(f"anchor:{aid} — extract pattern does not compile: {exc}")
            findings.append(
                Finding(
                    "INFO",
                    "anchor-bad-pattern",
                    objkey,
                    f"extract regex does not compile: {exc}",
                    "SKIPPED",
                )
            )
            continue

        matches = rx.findall(doc.text)
        if not matches:
            findings.append(
                Finding(
                    "HIGH",
                    "anchor-not-found",
                    objkey,
                    f"Anchor `{aid}` no longer matches anything in `{dockey}` "
                    f"(pattern: {pattern}). The claim is no longer being checked — either the "
                    "doc was reworded and the anchor needs updating, or the claim was deleted",
                )
            )
            continue

        cmd = anchor.get("command", "")
        refused = command_is_refused(cmd)
        if refused:
            skipped.append(f"anchor:{aid} — command refused, contains `{refused}`")
            findings.append(
                Finding(
                    "INFO",
                    "anchor-command-refused",
                    objkey,
                    f"Verification command refused: it contains `{refused}` and this engine only "
                    "runs read-only commands",
                    "SKIPPED",
                )
            )
            continue

        code, out, err = run_cmd(cmd, repo, timeout)
        if code != 0 or out == "":
            skipped.append(
                f"anchor:{aid} — command exited {code}: {err or out or '(no output)'}"
            )
            findings.append(
                Finding(
                    "INFO",
                    "anchor-command-failed",
                    objkey,
                    f"Verification command exited {code} with no usable output "
                    f"({err or '(no stderr)'}). Truth value unknown — this is NOT a pass",
                    "SKIPPED",
                )
            )
            continue

        actual = out.splitlines()[-1].strip()
        kind = (anchor.get("kind") or "text").lower()
        for m in matches:
            stated = (m if isinstance(m, str) else m[0]).strip()
            same = False
            if kind == "int":
                try:
                    same = int(re.sub(r"[^\d-]", "", stated)) == int(re.sub(r"[^\d-]", "", actual))
                except ValueError:
                    same = stated == actual
            else:
                same = stated.casefold() == actual.casefold()
            if same:
                continue
            note = anchor.get("note", "")
            findings.append(
                Finding(
                    "HIGH",
                    "anchor-mismatch",
                    objkey,
                    f"Doc states `{stated}`; the code reports `{actual}`."
                    + (f" {note}" if note else ""),
                )
            )
            break
    return findings, skipped


def check_retired_terms(baseline: Baseline, docs: list[Doc]) -> tuple[list[Finding], list[str]]:
    findings: list[Finding] = []
    skipped: list[str] = []
    for term in baseline.retired_terms:
        tid = term.get("id") or "(unnamed)"
        pattern = term.get("pattern", "")
        allow = term.get("allow_docs", []) or []
        try:
            rx = re.compile(pattern)
        except re.error as exc:
            skipped.append(f"retired_term:{tid} — pattern does not compile: {exc}")
            findings.append(
                Finding(
                    "INFO",
                    "term-bad-pattern",
                    f"(config) :: term:{tid}",
                    f"pattern does not compile: {exc}",
                    "SKIPPED",
                )
            )
            continue
        for doc in docs:
            if doc.kind != "text" or not doc.text:
                continue
            if matches_any(doc.key, allow):
                continue
            hits = rx.findall(doc.text)
            if not hits:
                continue
            findings.append(
                Finding(
                    "MEDIUM",
                    "retired-term",
                    f"{doc.key} :: term:{tid}",
                    f"{len(hits)} occurrence(s) of retired term `{tid}`. "
                    + term.get("reason", "The project retired this name."),
                )
            )
    return findings, skipped


def check_watches(
    baseline: Baseline, docs_by_key: dict[str, Doc], repo: Path, cfg: dict
) -> tuple[list[Finding], list[str]]:
    findings: list[Finding] = []
    skipped: list[str] = []
    if not cfg.get("stale_check", True):
        return findings, skipped
    window = int(cfg.get("stale_days", 30)) * 86400
    timeout = int(cfg["command_timeout"])

    for watch in baseline.watches:
        wid = watch.get("id") or "(unnamed)"
        dockey = watch.get("doc", "")
        objkey = f"{dockey} :: watch:{wid}"
        doc = docs_by_key.get(dockey)
        if doc is None:
            findings.append(
                Finding(
                    "HIGH",
                    "doc-missing",
                    objkey,
                    f"Baseline watch `{wid}` names doc `{dockey}`, which is not in the swept set",
                )
            )
            continue

        code_paths = [str(p) for p in (watch.get("code", []) or [])]
        code_ts = git_timestamp(repo, code_paths, timeout)
        if code_ts is None:
            newest = None
            for pattern in code_paths:
                for path in repo.glob(pattern):
                    ts = file_timestamp(path)
                    if ts is not None and (newest is None or ts > newest):
                        newest = ts
            code_ts = newest
        if code_ts is None:
            skipped.append(f"watch:{wid} — no timestamp for code paths {code_paths}")
            findings.append(
                Finding(
                    "INFO",
                    "watch-no-code-timestamp",
                    objkey,
                    f"Could not date any of {code_paths}. Staleness unknown — NOT a pass",
                    "SKIPPED",
                )
            )
            continue

        doc_ts = None
        try:
            rel = doc.path.relative_to(repo).as_posix()
            doc_ts = git_timestamp(repo, [rel], timeout)
        except ValueError:
            doc_ts = None
        if doc_ts is None:
            doc_ts = file_timestamp(doc.path)
        if doc_ts is None:
            skipped.append(f"watch:{wid} — no timestamp for doc `{dockey}`")
            findings.append(
                Finding(
                    "INFO",
                    "watch-no-doc-timestamp",
                    objkey,
                    "Could not date the doc. Staleness unknown — NOT a pass",
                    "SKIPPED",
                )
            )
            continue

        delta = code_ts - doc_ts
        if delta > window:
            findings.append(
                Finding(
                    "LOW",
                    "stale-vs-code",
                    objkey,
                    f"Code it describes moved on {delta // 86400} days after the doc last changed "
                    f"(threshold {window // 86400} days). Watched paths: {', '.join(code_paths)}",
                )
            )
    return findings, skipped


# --------------------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------------------


def render_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    lines = []
    for idx, row in enumerate(rows):
        lines.append(" | ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip())
        if idx == 0:
            lines.append("-+-".join("-" * w for w in widths))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Documentation-vs-code drift sweep (read-only).")
    ap.add_argument("--repo", default=".", help="repository root (source of truth)")
    ap.add_argument("--baseline", default=None, help="path to the project's baseline TOML")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    ap.add_argument(
        "--list-docs", action="store_true", help="print the resolved document inventory and exit"
    )
    args = ap.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    if not repo.is_dir():
        print(f"FATAL: repo root not found: {repo}", file=sys.stderr)
        return 2

    baseline_path = Path(args.baseline).expanduser() if args.baseline else None
    if baseline_path is not None and not baseline_path.is_file():
        print(f"FATAL: baseline not found: {baseline_path}", file=sys.stderr)
        return 2
    try:
        baseline = Baseline.load(baseline_path)
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: baseline could not be parsed: {exc}", file=sys.stderr)
        return 2

    cfg = baseline.config
    roots, missing_roots = resolve_roots(baseline, repo)
    if not roots:
        print("FATAL: no documentation root resolved. RUN STATUS: NOT-RUN", file=sys.stderr)
        for m in missing_roots:
            print(f"  unresolved root: {m}", file=sys.stderr)
        return 2

    docs, excluded_count, skipped_checkouts = collect_docs(roots, cfg)
    docs_by_key = {d.key: d for d in docs}

    if args.list_docs:
        for doc in docs:
            print(f"{doc.kind:6}  {doc.key}")
        return 0

    findings: list[Finding] = []
    skipped: list[str] = [f"documentation root did not resolve: {m}" for m in missing_roots]

    if cfg.get("path_check", True):
        findings += check_paths(docs, repo, cfg)
    a_find, a_skip = check_anchors(baseline, docs_by_key, repo, cfg)
    findings += a_find
    skipped += a_skip
    t_find, t_skip = check_retired_terms(baseline, docs)
    findings += t_find
    skipped += t_skip
    w_find, w_skip = check_watches(baseline, docs_by_key, repo, cfg)
    findings += w_find
    skipped += w_skip

    for doc in docs:
        if doc.kind == "text" and doc.read_error:
            skipped.append(f"doc `{doc.key}` — {doc.read_error}")

    # Apply the reviewed allowlist, then label everything that survives.
    kept: list[Finding] = []
    suppressed: list[tuple[str, str]] = []
    for f in findings:
        if f.status == "SKIPPED":
            kept.append(f)
            continue
        reason = baseline.accepted_reason(f.check, f.objkey)
        if reason is not None:
            suppressed.append((f.objkey, reason))
            continue
        ticket = baseline.known_ticket(f.objkey)
        f.status = f"KNOWN-OPEN {ticket}" if ticket else "NEW"
        kept.append(f)

    kept.sort(
        key=lambda f: (
            0 if f.status == "NEW" else (2 if f.status == "SKIPPED" else 1),
            SEVERITY_ORDER.get(f.severity, 9),
            f.check,
            f.objkey,
        )
    )

    binary_docs = [d.key for d in docs if d.kind == "binary"]
    run_status = "PARTIAL" if skipped else "COMPLETE"
    exit_code = 1 if skipped else 0

    if args.format == "json":
        print(
            json.dumps(
                {
                    "run_status": run_status,
                    "repo": str(repo),
                    "baseline": baseline.source,
                    "doc_roots": [{"name": n, "path": str(p)} for n, p in roots],
                    "docs_text": len([d for d in docs if d.kind == "text"]),
                    "docs_excluded_by_config": excluded_count,
                    "nested_checkouts_skipped": skipped_checkouts,
                    "exclude_globs": list(cfg["exclude_globs"]),
                    "docs_not_machine_checked": binary_docs,
                    "accepted_suppressions": [
                        {"object": o, "reason": r} for o, r in suppressed
                    ],
                    "skipped_checks": skipped,
                    "findings": [f.as_dict() for f in kept],
                },
                indent=2,
            )
        )
        return exit_code

    print("Documentation drift sweep")
    print("=" * 78)
    print(f"  repo (source of truth) : {repo}")
    print(f"  baseline               : {baseline.source or 'NONE — every finding reads as NEW'}")
    for name, path in roots:
        print(f"  doc root               : {name} -> {path}")
    print(
        f"  documents              : {len([d for d in docs if d.kind == 'text'])} text, "
        f"{len(binary_docs)} not machine-checked, {excluded_count} excluded by config"
    )
    if excluded_count:
        print(f"  exclude patterns       : {', '.join(cfg['exclude_globs'])}")
    if skipped_checkouts:
        print(
            f"  nested checkouts       : {len(skipped_checkouts)} pruned "
            f"(worktree, submodule or nested clone; their docs belong to another checkout)"
        )
        for c in skipped_checkouts:
            print(f"                           {c}")
    print(
        f"  configured checks      : {len(baseline.anchors)} anchors, "
        f"{len(baseline.retired_terms)} retired terms, {len(baseline.watches)} watches, "
        f"path check {'on' if cfg.get('path_check', True) else 'off'}"
    )
    print(f"  accepted suppressions  : {len(suppressed)}")
    print()

    rows = [["SEVERITY", "CHECK", "OBJECT", "STATUS", "DETAIL"]]
    for f in kept:
        rows.append([f.severity, f.check, f.objkey, f.status, f.detail])
    if len(rows) == 1:
        print("No findings.")
    else:
        print(render_table(rows))
    print()

    if binary_docs:
        print("NOT MACHINE-CHECKED (present, but this engine cannot read them):")
        for key in binary_docs:
            print(f"  - {key}")
        print()

    if skipped:
        print("CHECKS THAT DID NOT RUN (this is not a pass):")
        for s in skipped:
            print(f"  - {s}")
        print()

    if suppressed:
        print("SUPPRESSED BY THE REVIEWED ALLOWLIST:")
        for objkey, reason in suppressed:
            print(f"  - {objkey}: {reason}")
        print()

    new_count = len([f for f in kept if f.status == "NEW"])
    known_count = len([f for f in kept if f.status.startswith("KNOWN-OPEN")])
    skip_rows = len([f for f in kept if f.status == "SKIPPED"])
    print(
        f"TOTALS: {new_count} NEW, {known_count} KNOWN-OPEN, {skip_rows} SKIPPED rows, "
        f"{len(suppressed)} suppressed"
    )
    print(f"RUN STATUS: {run_status}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
