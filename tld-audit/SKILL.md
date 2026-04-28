---
name: tld-audit
description: |
  Security and architecture audit for the current ticket's changes. Catches mistakes like business logic on the
  frontend that belongs on the backend, missing auth checks, RLS gaps, exposed secrets, and validation holes.
  Use this skill whenever the user says "tld-audit", "audit", "security check", "check my work", "anything I'm missing",
  or wants a safety review before committing. Best run after /tld-build and before /tld-run-test, but can be run anytime
  there are uncommitted changes. Read-only — this skill does not modify code, only reports findings.
---

# TLD Audit

You are running a security and architecture review of the current ticket's changes. Your job is to catch the mistakes the developer isn't thinking about: logic that belongs on a different layer, missing protections, data exposure risks, and architectural smells.

**This skill is read-only. It reports findings but does NOT modify any code.**

## When to use this

- After `/tld-build`, before `/tld-run-test` (recommended spot in the flow)
- Anytime the user wants a sanity check on their changes
- After a side quest that touched auth, data, or API code
- When a ticket involves new tables, endpoints, or user-facing features

## Process

### 1. Identify what changed

Run `git diff --name-only` and `git diff --name-only --cached` to get the list of modified/new files. Also check the active ticket context from the conversation for the expected file list.

**If the conversation lacks current-ticket context** (no ticket ID known, no description, no "Files to Create/Modify" list), fall back to Linear:

Query Linear for issues with status = "In Progress".

- **Exactly one In-Progress ticket:** Load it via `get_issue` and use it as the current ticket. Extract title, description, AC, and Files to Create/Modify.
- **Zero In-Progress tickets:** Stop and output: "No ticket context and no In-Progress ticket in Linear. Run /tld-setup to pick one up, or provide the ticket ID." Do not proceed — the audit needs a spec to compare against.
- **Two or more In-Progress tickets:** Stop and output the list of IDs and titles with: "Multiple tickets are In Progress — unclear which to audit. Resolve one first (complete, cancel, or tell me which ID)." Do not guess.

If Linear is unreachable, stop and output: "Cannot reach Linear — aborting. No offline mode."

Group the changes by layer:
- **Database** — migrations, seed files, SQL
- **Backend** — edge functions, shared modules, stored procedures
- **Frontend** — components, pages, services, API calls
- **Config** — env files, package.json, supabase config

### 2. Run the audit checks

For each changed file, apply the relevant checks from the categories below. Skip checks that don't apply to the file type.

---

#### CHECK 1: Frontend doing backend's job

**What to look for:** Business logic, data mutations, or authorization decisions happening on the frontend instead of the backend.

- **Data writes without edge function:** Frontend code that calls Supabase directly for INSERT/UPDATE/DELETE instead of going through an edge function. The anon key + RLS is not enough for mutations that need validation.
- **Business logic in components:** Your domain logic (scoring, ranking, phase transitions, etc.) living in frontend code. These belong in stored procedures or edge functions.
- **Client-side authorization:** Code like `if (user.role === 'admin')` in React components to gate features. The backend must enforce this; frontend checks are UX only, not security.
- **Secret-adjacent values:** API keys, internal IDs, admin endpoints, or configuration that reveals system internals in frontend code. Check for anything that isn't `NEXT_PUBLIC_*` (the Next.js client-side env-var convention — other frameworks use different prefixes such as `VITE_`, `REACT_APP_`, or `PUBLIC_`; adapt the check to your framework).

**Severity:** HIGH for data mutations and auth decisions. MEDIUM for business logic.

---

#### CHECK 2: Missing auth on backend endpoints

**What to look for:** Edge functions that accept requests without verifying the caller.

- **No auth check on mutation endpoints:** Any edge function handling POST/PUT/PATCH/DELETE that doesn't call `[your-auth-helper](req)` or `[your-api-key-helper](req)` near the top.
- **Auth check but no early return:** Auth is called but the function continues even when `error` is returned. Pattern to look for:
  ```typescript
  const { user, error } = await [your-auth-helper](req);
  if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  ```
- **Admin endpoints without admin check:** Functions that should be admin-only but don't verify `ADMIN_API_KEY`.
- **GET endpoints exposing private data:** Query endpoints that return user-specific data without filtering by `auth.uid()`.

**Severity:** HIGH for missing auth. MEDIUM for auth without early return.

---

#### CHECK 3: RLS policy gaps

**What to look for:** New tables or modified tables without proper RLS.

- **Table created without `alter table ... enable row level security`:** Every table must have RLS enabled.
- **Missing SELECT policy:** Tables that should be publicly readable need an explicit `for select to public using (true)` policy.
- **Missing owner-based write policies:** Tables with user data need `for insert/update/delete to authenticated using (auth.uid() = user_id_column)`.
- **Overly permissive policies:** `using (true)` on INSERT/UPDATE/DELETE means anyone can write. This is almost always wrong.
- **Service role grants:** New tables should have `grant all on [table] to service_role` for edge function access.
- **Missing grants for anon/authenticated:** If RLS policies reference these roles, the roles need SELECT/INSERT/UPDATE grants on the table.

**Severity:** HIGH for missing RLS or overly permissive write policies. MEDIUM for missing grants.

---

#### CHECK 4: Input validation gaps

**What to look for:** Endpoints that accept user input without validating it.

- **No validation on request body:** Edge functions that destructure the body without checking types, lengths, or allowed values. Look for `const { field } = await req.json()` without subsequent validation.
- **SQL injection risk:** String interpolation in SQL queries instead of parameterized queries. Look for template literals in SQL: `` `SELECT * FROM table WHERE id = '${userInput}'` ``.
- **Frontend-only validation:** If the frontend validates a field (length, format, etc.) but the backend endpoint accepts the same field without validation. The backend must validate independently.
- **Missing enum/range checks:** Fields that should be constrained (e.g., round must be one of R32/R16/QF/SF/F) but are accepted as arbitrary strings.

**Severity:** HIGH for SQL injection. MEDIUM for missing validation.

---

#### CHECK 5: Data exposure

**What to look for:** API responses or database queries that return more data than the client needs.

- **SELECT * in queries:** Edge functions that select all columns when only a few are needed. Especially dangerous with tables that have internal columns (hashed keys, admin flags, etc.).
- **Leaking internal IDs or hashes:** API responses that include `api_key_hash`, service-internal UUIDs, or database metadata.
- **Error messages revealing internals:** Catch blocks that return the raw error message to the client. Pattern: `return new Response(JSON.stringify({ error: err.message }))` — this can leak table names, column names, or constraint details.
- **Sensitive data in logs:** `console.log` of request bodies, tokens, or user data that would appear in function logs.

**Severity:** HIGH for leaking secrets/hashes. MEDIUM for verbose errors. LOW for SELECT *.

---

#### CHECK 6: Architecture smells

**What to look for:** Patterns that work now but will cause problems.

- **Duplicated types:** Same TypeScript interface defined in both frontend and backend without a shared source. Changes to one will silently diverge from the other.
- **Hardcoded URLs or IDs:** Production URLs, specific domain IDs, or environment-specific values baked into code instead of coming from config/env.
- **Missing error handling on fetch:** Frontend API calls without try/catch or .catch(), or without handling non-200 responses.
- **Race conditions in state updates:** Frontend code that reads state, makes an async call, then writes state without checking if state changed during the call.
- **Missing CORS headers:** New edge functions without proper CORS handling (check for OPTIONS method handling and `Access-Control-*` headers).

**Severity:** MEDIUM for most. LOW for style issues.

---

### 3. Output

Present findings in a severity-grouped table format:

```
## Audit Report — [ticket ID]

**Files reviewed:** [count]
**Findings:** [count] ([X] high, [Y] medium, [Z] low)
```

**If findings exist:**

| # | Severity | Check | File | Finding | Fix |
|---|----------|-------|------|---------|-----|
| 1 | HIGH | Auth gap | `functions/foo/index.ts` | POST handler missing auth check | Add `[your-auth-helper](req)` with early 401 return |
| 2 | MEDIUM | Frontend logic | `components/[YourFeature].tsx` | Score calculation in component | Move to stored procedure or edge function |
| 3 | LOW | Data exposure | `functions/bar/index.ts` | `SELECT *` on `[your-domain-table]` | Select only needed columns |

Sort by severity (HIGH first), then by check number.

**If no findings:**

```
No issues found. The changes look clean from a security and architecture perspective.
```

### Numbered shortcut recognition

When you present the "What's next?" options at the end of your output, the user may respond with just a number (e.g., "1" or "2"). If the user's next message is a bare number matching one of the options you presented, treat it as if they typed the corresponding slash command and invoke that skill immediately.

### 4. Present options

---

**If HIGH severity findings exist:**

**What's next?**

> **1.** Fix the findings above, then re-run /tld-audit
>    Best for: standard flow after finding issues

> **2.** /tld-run-test — skip audit fixes, proceed to verify
>    Best for: you disagree with the audit (not recommended)

> **3.** /tld-side-quest — address findings in a separate ticket
>    Best for: findings are out of scope for this ticket

Type **1**, **2**, or **3** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT fix the findings yourself, do NOT invoke `/tld-run-test` or any other skill. Wait for the user to pick an option or type a command.**

**If only MEDIUM/LOW or no findings:**

**What's next?**

> **1.** /tld-run-test — verify, manual QA, and commit
>    Best for: everything looks clean, ready to verify

> **2.** /tld-side-quest — handle a quick fix first
>    Best for: medium/low findings worth fixing inline

Type **1** or **2** to proceed.

**HARD STOP: After outputting the above, you are DONE. Do NOT invoke `/tld-run-test` or any other skill. Wait for the user to pick an option or type a command.**

## What this skill does NOT check

- **Performance** — no query plan analysis, bundle size checks, or load testing
- **Accessibility** — no ARIA or screen reader checks
- **Test coverage** — that's /tld-run-test's job (drift check covers AC coverage)
- **Code style** — no linting or formatting checks

This is a security and architecture review only. It catches the "you built it on the wrong layer" and "you forgot to lock the door" mistakes.
