-- ===========================================================================
--  Phase 3C, PR 1  --  UNDO
--
--  Drops public.plan_entitlements and everything in it.
--
--  This is safe ONLY while the ledger is still what PR 1 made it: a write-only
--  record that nothing reads and nothing else writes. In that state the table
--  is pure addition, so removing it restores the database exactly.
--
--  IT IS NOT SAFE LATER. Once PR 2+ make the ledger authoritative -- the
--  activation endpoint writing it, the webhook writing it, anything reading it
--  to decide a plan -- dropping it destroys the only server-side record of why
--  merchants have the plans they have, and there is no way to reconstruct it.
--
--  So this file REFUSES rather than trusting whoever pasted it. Section 1 aborts
--  the transaction if it finds any evidence that the ledger has become live.
--  If it aborts, that is the file working correctly. Do not delete the check to
--  get past it -- work out what is writing the ledger first.
--
--  What this file does NOT touch, because PR 1 never touched them:
--    upgrade_store_plan, pending_signups, stores, the webhook, checkout,
--    coupons, phase 1, phase 2.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
--  VERIFY afterwards: supabase/plan-entitlements-verify.sql
--          (every A/S/E/P/H row returns to 'N/A - ledger not installed',
--           and B1..B7 must read exactly what they read before PR 1.)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse if the ledger is no longer just an import
-- ---------------------------------------------------------------------------
--  HOW THIS GUARD DECIDES, and why it takes two different approaches.
--
--  Measured against this exact table in a rolled-back transaction, creating one
--  of each kind of dependent object and reading pg_depend afterwards:
--
--    dependent object                        recorded in pg_depend?
--    ------------------------------------    ----------------------
--    a VIEW selecting from it                YES  pg_rewrite,   deptype n
--    a FOREIGN KEY from another table        YES  pg_constraint, deptype n
--    a SQL function with a BEGIN ATOMIC body YES  pg_proc,       deptype n
--    a plpgsql function reading it           NO   nothing at all
--    a SQL function with a string body       NO   nothing at all
--
--  So the catalog is authoritative for everything it records, and for plpgsql
--  -- which is what almost every function in this database is written in --
--  there is no catalog dependency to read. Check (b) is therefore the real
--  test, and check (d) is a text scan kept ONLY because it is the sole signal
--  that exists for the cases the catalog cannot see. A text match may be a
--  false positive. That is fine: a false positive refuses, which is the safe
--  direction. Nothing is excluded from it, including this project's own
--  machinery -- if a name collides, a human reads the message and decides.
do $guard$
declare
  v_tbl       oid;
  v_foreign   integer := 0;
  v_catalog   text;
  v_triggers  text;
  v_textmatch text;
begin
  v_tbl := to_regclass('public.plan_entitlements');
  if v_tbl is null then
    raise notice 'plan_entitlements does not exist - nothing to roll back';
    return;
  end if;

  -- (a) DATA. Any row that did NOT come from the migration means a real writer
  --     has been active, and its evidence would be destroyed by this drop.
  execute 'select count(*) from public.plan_entitlements where source <> ''migration_backfill'''
    into v_foreign;

  if v_foreign > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - %s entitlements were written by something other than the '
                    || 'migration. The ledger is live. Dropping it would destroy the only '
                    || 'server-side record of those grants.', v_foreign),
      hint    = 'Export public.plan_entitlements first, then decide deliberately.';
  end if;

  -- (b) CATALOG DEPENDENCIES -- the authoritative check.
  --
  --     Every object PostgreSQL knows depends on this table or any of its
  --     columns, in ANY schema: views and rules (pg_rewrite), foreign keys
  --     from other tables (pg_constraint), BEGIN ATOMIC function bodies
  --     (pg_proc), and anything else that records a normal dependency.
  --
  --     deptype 'n' is what a genuine outside dependency records. The table's
  --     own indexes, defaults, TOAST table and rowtype record 'a' or 'i' and
  --     are not outside dependencies. Its own CHECK constraints DO record 'n'
  --     on the columns they read, so they are excluded by conrelid -- that is
  --     the only exclusion, and it is structural rather than by name.
  select string_agg(distinct kind || ': ' || name, ', ') into v_catalog
    from (
      select d.classid::regclass::text as kind,
             coalesce(
               (select n.nspname || '.' || c2.relname
                  from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
                 where d.classid = 'pg_class'::regclass and c2.oid = d.objid),
               (select n.nspname || '.' || vc.relname
                  from pg_rewrite r
                  join pg_class vc on vc.oid = r.ev_class
                  join pg_namespace n on n.oid = vc.relnamespace
                 where d.classid = 'pg_rewrite'::regclass and r.oid = d.objid),
               (select n.nspname || '.' || p.proname
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where d.classid = 'pg_proc'::regclass and p.oid = d.objid),
               (select cn.conname || ' on ' || cr.relname
                  from pg_constraint cn join pg_class cr on cr.oid = cn.conrelid
                 where d.classid = 'pg_constraint'::regclass and cn.oid = d.objid),
               (select t.tgname || ' on ' || tr.relname
                  from pg_trigger t join pg_class tr on tr.oid = t.tgrelid
                 where d.classid = 'pg_trigger'::regclass and t.oid = d.objid),
               'oid ' || d.objid::text
             ) as name
        from pg_depend d
       where d.refclassid = 'pg_class'::regclass
         and d.refobjid   = v_tbl
         and d.deptype    = 'n'
         and not (d.classid = 'pg_constraint'::regclass
                  and exists (select 1 from pg_constraint cn
                               where cn.oid = d.objid and cn.conrelid = v_tbl))
         and not (d.classid = 'pg_class'::regclass and d.objid = v_tbl)
    ) dep;

  if v_catalog is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - PostgreSQL records these objects as depending on the '
                    || 'ledger: %s. A later phase has wired it in.', v_catalog),
      hint    = 'Drop or repoint them first, on purpose.';
  end if;

  -- (c) TRIGGERS ON the table. A trigger added by a later phase is a dependency
  --     in the direction the check above does not look, so it gets its own row.
  select string_agg(t.tgname, ', ' order by t.tgname) into v_triggers
    from pg_trigger t
   where t.tgrelid = v_tbl and not t.tgisinternal;

  if v_triggers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - the ledger carries triggers a later phase added: %s', v_triggers),
      hint    = 'Drop them first, on purpose.';
  end if;

  -- (d) TEXT SCAN -- supplementary, and the ONLY signal for plpgsql and
  --     string-bodied SQL functions, whose bodies the catalog cannot see.
  --     Every schema, not just public. Deliberately not narrowed: refusing on
  --     a false match is the safe direction.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_textmatch
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ilike '%plan_entitlements%';

  if v_textmatch is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these function bodies mention the ledger: %s. The catalog '
                    || 'records no dependency for plpgsql or string-bodied SQL functions, so '
                    || 'this text match is the only warning available. Read them before '
                    || 'deciding.', v_textmatch),
      hint    = 'If the match is genuinely unrelated, confirm it by hand rather than removing this check.';
  end if;

  raise notice 'ledger is still import-only with no dependants - safe to drop';
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Drop it
--
-- No CASCADE. If something unexpected depends on this table, PostgreSQL should
-- stop and say so rather than quietly removing it too. The guard above has
-- already checked the cases we know about.
--
-- The indexes and constraints go with the table. There is nothing else to
-- undo: PR 1 created no function, no policy, no trigger, and altered no
-- existing grant.
-- ---------------------------------------------------------------------------
drop table if exists public.plan_entitlements;

commit;

-- ===========================================================================
--  Nothing else is reverted, because nothing else was changed. In particular
--  upgrade_store_plan is still SECURITY DEFINER with EXECUTE granted to anon,
--  exactly as it was before PR 1 and exactly as it is after it. Closing that
--  is PR 4.
-- ===========================================================================
