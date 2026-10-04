-- Verifier for wallet-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with fns(sig, browser) as (
  values ('public.wallet_credit_topup(text,text,integer)', false),
         ('public.wallet_debit(text,integer,text,text)',   false),
         ('public.wallet_refund(text,text)',               false),
         ('public.wallet_adjust(text,integer,text)',       false),
         ('public.get_store_wallet(text,text)',            true)
),
f as (
  select fns.sig, fns.browser, to_regprocedure(fns.sig) as oid
    from fns
),
tabs(t) as (values ('public.store_wallets'), ('public.wallet_topups'), ('public.wallet_ledger')),
drift as (
  select w.store_slug
    from public.store_wallets w
    left join (select store_slug, sum(amount_paise) as s from public.wallet_ledger group by store_slug) l
      on l.store_slug = w.store_slug
   where w.balance_paise <> coalesce(l.s, 0)
)
select 'C1' as grp, 'C1 the three wallet tables exist with row level security on' as check_name,
  case when (select count(*) from tabs join pg_class c on c.oid = to_regclass(tabs.t) where c.relrowsecurity) = 3
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 the browser roles have no direct access to any wallet table',
  case when not exists (
         select 1 from tabs, unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
          where to_regclass(tabs.t) is not null and has_table_privilege(r, tabs.t, p))
        and (select count(*) from tabs where to_regclass(tabs.t) is not null) = 3
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the five wallet functions exist, SECURITY DEFINER, search_path public, pg_temp',
  case when (select count(*) from f join pg_proc p on p.oid = f.oid
              where p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') = 5
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 only get_store_wallet is callable from the browser; credit/debit/refund/adjust are service_role only',
  case when (select count(*) from f where f.oid is not null) = 5
        and not exists (select 1 from f where not f.browser and (
              has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE')))
        and not exists (select 1 from f, pg_proc p, aclexplode(p.proacl) x where p.oid = f.oid and x.grantee = 0)
        and has_function_privilege('anon', 'public.get_store_wallet(text,text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.wallet_debit(text,integer,text,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 get_store_wallet checks the PIN before reading anything',
  case when (select p.prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%return null;%'
               from pg_proc p where p.oid = to_regprocedure('public.get_store_wallet(text,text)'))
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 the price is Rs 1.50 per message',
  case when public.wallet_message_price_paise() = 150 then 'PASS' else 'FAIL' end
union all
select 'C7', 'C7 every wallet balance equals the sum of its ledger',
  case when not exists (select 1 from drift) then 'PASS'
       else 'FAIL - ' || (select string_agg(store_slug, ', ') from drift) end
union all
select 'I1', 'I1 wallets / total balance (Rs) / top-ups paid / top-ups waiting',
  (select count(*) from public.store_wallets)::text || ' / ' ||
  (select coalesce(sum(balance_paise), 0) / 100.0 from public.store_wallets)::text || ' / ' ||
  (select count(*) from public.wallet_topups where status = 'paid')::text || ' / ' ||
  (select count(*) from public.wallet_topups where status = 'created')::text;
