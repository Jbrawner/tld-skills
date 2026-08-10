-- rls-audit baseline — TEMPLATE. Copy into your repo as `rls-audit-baseline.sql` and edit.
-- Put it in `.tld/`, or in `.claude/` if the repo gitignores `.tld/`, or at the repo root.
--
-- This file is the entire per-project surface of /rls-audit. It holds three things:
--   1. config      — what this project's roles, schemas and naming conventions are
--   2. accepted    — deviations a human reviewed and deliberately accepted
--   3. known_open  — deviations already tracked by an open ticket
--
-- It is loaded BEFORE the engine, in the same psql session:
--   psql "$CONN" -f <this file> -f <skill>/rls-audit.sql
--
-- Commit it. It is the audit's memory: without it every known finding reads as new every week, and a
-- report that cries wolf every week is a report nobody reads.
--
-- Adding a row to `accepted` is a security sign-off, not a way to quiet a noisy check. Only add one
-- after reading the function and its call chain, and always leave the reason.

CREATE TEMP TABLE IF NOT EXISTS rls_audit_config (ckey text PRIMARY KEY, cvalue text);
CREATE TEMP TABLE IF NOT EXISTS rls_audit_accepted (check_name text, objkey text, reason text);
CREATE TEMP TABLE IF NOT EXISTS rls_audit_known_open (objkey text, ticket text);

-- ---- 1. config ----------------------------------------------------------------------------------
-- Only override what differs from the defaults. Defaults are Supabase-shaped:
--   schemas='public', client_roles='anon,authenticated', data_rpc_pattern='report\_%',
--   auth_guard_regex='auth\.(uid|role)\(\)', membership_guard_regex='' (none)

INSERT INTO rls_audit_config (ckey, cvalue) VALUES
  -- Name this project's permission helpers so a function that calls one is not flagged as unguarded.
  -- Leave unset if the project has none; an empty regex would match everything.
  ('membership_guard_regex', 'is_org_member|is_org_admin|current_tenant_id'),

  -- Where /rls-audit files its findings, for repos with no `.tld/campaign.md`. These configure this
  -- audit only, and campaign.md's Project -> Issue tracker wins wherever it exists. Omit them all and
  -- the sweep still runs; it just reports instead of filing.
  ('tracker',          'Jira'),                 -- Jira or Linear
  ('tracker_cloud_id', '00000000-0000-0000-0000-000000000000'),
  ('tracker_project',  'ABC'),
  ('ticket_labels',    'rls-audit,security')
ON CONFLICT (ckey) DO UPDATE SET cvalue = EXCLUDED.cvalue;

-- ---- 2. accepted (reviewed, by design) ----------------------------------------------------------
-- objkey is the function NAME for function checks, or 'table :: policy' for policy checks.
-- check_name '*' accepts the object across every check.

INSERT INTO rls_audit_accepted (check_name, objkey, reason) VALUES
  ('policy-world-open', 'public_docs :: public_docs_select',
   'Marketing docs are global content, intentionally readable by anyone.'),
  ('definer-anon-exec-no-authuid', 'current_user_org_ids',
   'Foundational RLS helper: returns only membership ids and is called as fn(auth.uid()) by policies.');

-- ---- 3. known_open (tracked by an open ticket) --------------------------------------------------
-- Pairs an object with the ticket that will fix it, so a recurring run reports it as tracked rather
-- than new. Delete the row once the fix lands; the finding stops matching anyway.

INSERT INTO rls_audit_known_open (objkey, ticket) VALUES
  ('legacy_lookup_helper', 'ABC-123');
