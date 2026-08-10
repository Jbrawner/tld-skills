-- rls-audit.sql — project-agnostic RLS / SECURITY DEFINER posture check for a Postgres database.
--
-- READ-ONLY. Creates temp tables in its own session and reads system catalogs. It never touches
-- application data, and it holds no locks beyond catalog reads.
--
-- Usage (baseline optional, but always list it FIRST so its config wins):
--   psql "$CONN" -f <project>/.tld/rls-audit-baseline.sql -f rls-audit.sql
--   psql "$CONN" -f rls-audit.sql                      # no baseline: pure defaults, everything is NEW
--
-- Emits ONE result set. Zero rows = clean. Each row: severity | check_name | object | status | detail
--   status = NEW              -> not on any list. Triage it; treat as a regression until proven otherwise.
--   status = KNOWN-OPEN <KEY> -> already tracked by that ticket. Not new; do not re-file.
--
-- The three temp tables below are the entire per-project surface. A baseline file creates and fills
-- them; this engine supplies defaults for anything the baseline did not set. See baseline.example.sql.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
\timing off

-- A baseline file may already have created the temp tables below; skip the "already exists" notices.
SET client_min_messages TO warning;

-- ---- per-project surface (baseline may have already created and filled these) --------------------

CREATE TEMP TABLE IF NOT EXISTS rls_audit_config (ckey text PRIMARY KEY, cvalue text);

-- Findings the project has reviewed and deliberately accepted. check_name '*' accepts across all checks.
CREATE TEMP TABLE IF NOT EXISTS rls_audit_accepted (check_name text, objkey text, reason text);

-- Deviations already tracked by an open ticket, so a recurring run can separate NEW from tracked.
CREATE TEMP TABLE IF NOT EXISTS rls_audit_known_open (objkey text, ticket text);

-- Defaults. Supabase-shaped, because that is the common case; override any of them in the baseline.
INSERT INTO rls_audit_config (ckey, cvalue)
SELECT v.ckey, v.cvalue
FROM (VALUES
  -- Schemas to audit, comma-separated.
  ('schemas', 'public'),
  -- Roles a browser/API client can act as. These are the roles that must NOT reach internal helpers.
  -- Roles that do not exist in this database are ignored, so plain Postgres projects degrade cleanly.
  ('client_roles', 'anon,authenticated'),
  -- LIKE pattern for data-returning RPCs that must always be guarded (reporting endpoints and such).
  -- Set to something unmatchable (e.g. an empty string) to switch check R4 off.
  ('data_rpc_pattern', 'report\_%'),
  -- Regex that counts as an in-body authentication guard.
  ('auth_guard_regex', 'auth\.(uid|role)\(\)'),
  -- Optional extra regex of project membership/permission helpers that also count as a guard.
  -- Empty means "none"; an empty regex would otherwise match every function.
  ('membership_guard_regex', '')
) AS v(ckey, cvalue)
WHERE NOT EXISTS (SELECT 1 FROM rls_audit_config c WHERE c.ckey = v.ckey);

WITH
cfg AS (
  SELECT
    string_to_array(max(cvalue) FILTER (WHERE ckey = 'schemas'), ',')        AS schemas,
    max(cvalue) FILTER (WHERE ckey = 'data_rpc_pattern')                     AS data_rpc_pattern,
    max(cvalue) FILTER (WHERE ckey = 'auth_guard_regex')                     AS auth_guard_regex,
    nullif(max(cvalue) FILTER (WHERE ckey = 'membership_guard_regex'), '')   AS membership_guard_regex
  FROM rls_audit_config
),
-- Only roles that actually exist here. to_regrole returns NULL for an unknown role name.
client_roles AS (
  SELECT btrim(r) AS rolename
  FROM rls_audit_config, unnest(string_to_array(cvalue, ',')) AS r
  WHERE ckey = 'client_roles' AND to_regrole(btrim(r)) IS NOT NULL
),
audited_ns AS (
  SELECT n.oid, n.nspname FROM pg_namespace n, cfg WHERE n.nspname = ANY (cfg.schemas)
),
-- Every SECURITY DEFINER function in scope, with its definition and client reachability resolved once.
definers AS (
  SELECT
    p.oid,
    p.proname,
    p.proname || '(' || pg_get_function_arguments(p.oid) || ')' AS signature,
    pg_get_function_result(p.oid)                               AS result_type,
    pg_get_functiondef(p.oid)                                   AS def,
    EXISTS (SELECT 1 FROM client_roles cr
            WHERE has_function_privilege(cr.rolename, p.oid, 'EXECUTE'))    AS client_executable,
    has_function_privilege('anon', p.oid, 'EXECUTE')
      AND to_regrole('anon') IS NOT NULL                                    AS anon_executable
  FROM pg_proc p JOIN audited_ns n ON n.oid = p.pronamespace
  WHERE p.prosecdef
),
-- A function is "guarded" if its body authenticates, or names one of the project's permission helpers.
definers_guarded AS (
  SELECT d.*,
         (d.def ~* (SELECT auth_guard_regex FROM cfg))                       AS has_auth_guard,
         ((SELECT membership_guard_regex FROM cfg) IS NOT NULL
           AND d.def ~* (SELECT membership_guard_regex FROM cfg))            AS has_membership_guard
  FROM definers d
),

-- ================================================================================================
-- INVARIANTS — always expected empty. A row here is a hard regression.
-- ================================================================================================

-- I1: every base table in scope must have row-level security enabled.
i1 AS (
  SELECT 'HIGH' AS severity, 'rls-disabled' AS check_name,
         c.relname AS objkey, c.relname AS object,
         'Base table has RLS disabled; add ENABLE ROW LEVEL SECURITY and policies' AS detail
  FROM pg_class c JOIN audited_ns n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND c.relrowsecurity = false
),

-- I2: every SECURITY DEFINER function must pin search_path, or its body can be hijacked by a
-- caller-controlled schema shadowing the objects it references.
i2 AS (
  SELECT 'HIGH', 'definer-no-search-path', d.proname, d.signature,
         'SECURITY DEFINER function has no pinned search_path; add SET search_path'
  FROM definers_guarded d
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) s
    WHERE p.oid = d.oid AND s LIKE 'search_path=%'
  )
),

-- I3: an INSERT/UPDATE/ALL policy without WITH CHECK constrains which rows you can see, but not
-- which rows you can write, so a member can write outside their own scope.
i3 AS (
  SELECT 'HIGH', 'write-policy-no-with-check',
         tablename || ' :: ' || policyname, tablename || ' :: ' || policyname,
         cmd || ' policy has no WITH CHECK; writes are unconstrained'
  FROM pg_policies p, cfg
  WHERE p.schemaname = ANY (cfg.schemas) AND p.cmd IN ('INSERT','UPDATE','ALL') AND p.with_check IS NULL
),

-- ================================================================================================
-- REVIEW — heuristics with legitimate exceptions. A NEW row here deserves a read, not a reflex.
-- ================================================================================================

-- R1: a DEFINER function that returns data, is reachable by a client role, and never authenticates.
-- This is the "internal helper callable directly, skipping the wrapper that checks permission" shape.
-- It deliberately over-flags: a false positive costs a few minutes, a missed one costs a data leak.
r1 AS (
  SELECT 'MEDIUM', 'definer-anon-exec-no-authuid', d.proname, d.signature,
         'DEFINER fn returns ' || d.result_type || ', executable by a client role, body never authenticates'
           || '; reachable directly as rpc/' || d.proname
  FROM definers_guarded d
  WHERE d.client_executable
    AND d.result_type NOT IN ('trigger','void','boolean')
    AND NOT d.has_auth_guard
    AND NOT d.has_membership_guard
),

-- R2: same shape, but the function returns only boolean/void — a probe or a fire-and-forget write.
-- Lower signal, so lower severity, but a cross-tenant write helper still lands here.
r2 AS (
  SELECT 'LOW', 'definer-anon-exec-unguarded', d.proname, d.signature,
         'DEFINER fn (' || d.result_type || ') executable by a client role, no auth or permission guard in body'
  FROM definers_guarded d
  WHERE d.client_executable
    AND d.result_type IN ('void','boolean')
    AND NOT d.has_auth_guard
    AND NOT d.has_membership_guard
),

-- R3: a policy whose USING clause is literally true, granted to a client role. Sometimes correct
-- (genuinely public content), which is exactly why it belongs on a reviewed list rather than an invariant.
r3 AS (
  SELECT 'MEDIUM', 'policy-world-open',
         tablename || ' :: ' || policyname, tablename || ' :: ' || policyname,
         cmd || ' policy has qual = true for roles ' || roles::text || ' (world-open)'
  FROM pg_policies p, cfg
  WHERE p.schemaname = ANY (cfg.schemas)
    AND p.qual = 'true'
    AND (p.roles::text LIKE '%anon%' OR p.roles::text = '{public}' OR p.roles::text LIKE '%authenticated%')
),

-- R4: a data RPC matching the project's reporting convention that is anon-reachable or unauthenticated.
-- These are the endpoints that return aggregated business data, so they must never be either.
r4 AS (
  SELECT 'HIGH', 'report-rpc-unguarded', d.proname, d.proname,
         CASE WHEN d.anon_executable THEN 'report RPC is anon-executable; ' ELSE '' END
           || CASE WHEN NOT d.has_auth_guard THEN 'report RPC body never authenticates' ELSE '' END
  FROM definers_guarded d, cfg
  WHERE cfg.data_rpc_pattern <> ''
    AND d.proname LIKE cfg.data_rpc_pattern
    AND d.result_type NOT IN ('trigger','void','boolean','integer','numeric')
    AND (d.anon_executable OR NOT d.has_auth_guard)
),

findings AS (
  SELECT * FROM i1 UNION ALL SELECT * FROM i2 UNION ALL SELECT * FROM i3
  UNION ALL SELECT * FROM r1 UNION ALL SELECT * FROM r2
  UNION ALL SELECT * FROM r3 UNION ALL SELECT * FROM r4
)

SELECT
  f.severity,
  f.check_name,
  f.object,
  CASE WHEN ko.ticket IS NOT NULL THEN 'KNOWN-OPEN ' || ko.ticket ELSE 'NEW' END AS status,
  f.detail
FROM findings f
LEFT JOIN rls_audit_known_open ko ON ko.objkey = f.objkey
WHERE NOT EXISTS (
  SELECT 1 FROM rls_audit_accepted a
  WHERE a.objkey = f.objkey AND a.check_name IN ('*', f.check_name)
)
ORDER BY
  (CASE WHEN ko.ticket IS NULL THEN 0 ELSE 1 END),          -- NEW first
  CASE f.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
  f.check_name, f.object;
