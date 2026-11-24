-- ===========================================================================
--  PocketLink Sales CRM  --  IMPORT (run after sales-crm-forward.sql)
--
--  Brings everything the founder asked for into the new CRM (2026-11-23,
--  "transfer all the client data ... and all the data which was used to login
--  till date"):
--    1. Hub logins (crm_team)        -> sales_staff. Same email and password.
--                                       admin -> manager, sales -> caller (the
--                                       manager changes roles in Team).
--    2. Hub leads (crm_leads)        -> sales_leads, one per phone, with stage,
--                                       follow-up date, owner, notes, reasons.
--    3. Shop owners who signed up    -> sales_leads marked "Signed up": shop
--                                       name, sign-up phone, city, type only.
--                                       Paying today -> stage won; else new.
--    4. Pending sign-ups             -> sales_leads to call.
--  Not recoverable: people who only verified an OTP and never made a shop
--  (their numbers are kept only as hashes since security phase 1).
--
--  Safe to run again: nothing is inserted twice (one lead per phone, Hub ids
--  are unique) and existing CRM work is never overwritten. The Hub tables are
--  only read. Demo and reviewer shops are skipped.
-- ===========================================================================

-- 1. Staff ---------------------------------------------------------------------
insert into public.sales_staff (user_id, name, email, role)
select t.user_id,
       left(coalesce(nullif(btrim(t.name), ''), split_part(u.email, '@', 1), 'Team member'), 80),
       u.email,
       case when t.role = 'admin' then 'manager' else 'caller' end
  from public.crm_team t
  join auth.users u on u.id = t.user_id
on conflict (user_id) do nothing;

-- 2. Hub leads -----------------------------------------------------------------
with numbered as (
  select c.*, right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10) as p10
    from public.crm_leads c
), src as (
  select distinct on (p10) *
    from numbered
   where length(p10) = 10
   order by p10, updated_at desc nulls last, created_at desc
)
insert into public.sales_leads (
  created_at, updated_at, shop_name, owner_name, phone, business_type, city, area,
  source, source_detail, stage, heat, won_plan, won_amount, lost_reason,
  signed_up, store_slug, next_action_at, next_action, assigned_to, created_by,
  last_activity_at, hub_lead_id)
select s.created_at,
       coalesce(s.updated_at, s.created_at),
       left(coalesce(nullif(btrim(s.business_name), ''), 'Shop'), 120),
       left(nullif(btrim(s.owner_name), ''), 80),
       s.p10,
       left(nullif(btrim(s.category), ''), 60),
       left(nullif(btrim(s.city), ''), 80),
       left(nullif(btrim(s.area), ''), 120),
       'hub',
       left(nullif(btrim(s.source), ''), 200),
       case s.status when 'won-paid' then 'won' when 'won-free' then 'won'
                     when 'contacted' then 'contacted' when 'demo' then 'demo'
                     when 'interested' then 'interested' when 'lost' then 'lost'
                     else 'new' end,
       case s.priority when 'high' then 'hot' when 'medium' then 'warm' when 'low' then 'cold' end,
       case when s.status = 'won-paid' then left(coalesce(nullif(s.plan, ''), 'paid'), 40)
            when s.status = 'won-free' then 'free' end,
       case when s.status = 'won-paid' and s.amount between 0 and 10000000 then s.amount end,
       case when s.status = 'lost' then left(nullif(btrim(s.objection), ''), 200) end,
       s.store_slug is not null,
       s.store_slug,
       case when s.next_follow_up is not null and s.status not in ('won-paid', 'won-free', 'lost')
            then (s.next_follow_up + time '10:00') at time zone 'Asia/Kolkata' end,
       case when s.next_follow_up is not null and s.status not in ('won-paid', 'won-free', 'lost')
            then 'Follow up (from the Hub)' end,
       case when exists (select 1 from public.sales_staff st where st.user_id = s.assigned_to) then s.assigned_to end,
       s.created_by,
       coalesce(s.updated_at, s.created_at),
       s.id
  from src s
on conflict do nothing;

-- The Hub's notes, reasons and objection become the first line of history.
insert into public.sales_activities (lead_id, staff_id, kind, outcome, note, created_at)
select l.id, null, 'system', 'moved_from_hub',
       left(nullif(concat_ws(chr(10),
         nullif(btrim(c.notes), ''),
         case when c.reasons is not null and cardinality(c.reasons) > 0
              then 'Why they bought: ' || array_to_string(c.reasons, ', ') end,
         case when nullif(btrim(c.objection), '') is not null then 'Objection: ' || btrim(c.objection) end
       ), ''), 2000),
       c.created_at
  from public.sales_leads l
  join public.crm_leads c on c.id = l.hub_lead_id
 where not exists (select 1 from public.sales_activities a where a.lead_id = l.id and a.outcome = 'moved_from_hub');

-- 3. Shop owners who signed up -------------------------------------------------
drop table if exists pg_temp.sales_import_shops;
create temporary table sales_import_shops as
select distinct on (p10) *
  from (
    select s.slug,
           s.created_at,
           left(coalesce(nullif(btrim(s.config->>'businessName'), ''), s.slug), 120) as shop_name,
           left(nullif(btrim(s.config->>'businessType'), ''), 60) as business_type,
           left(nullif(btrim(s.config->>'city'), ''), 80) as city,
           right(regexp_replace(coalesce(nullif(s.config->>'ownerPhone', ''), s.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10) as p10,
           coalesce(s.config->>'plan', 'free') <> 'free'
             and coalesce(s.config->>'planExpiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
             and (s.config->>'planExpiresAt')::timestamptz > now() as paying,
           coalesce(s.config->>'plan', 'free') as plan
      from public.stores s
     where s.slug not in ('solapur-chaddar', 'annapurna-khanaval', 'vitthal-lodge', 'maharaja-sweets',
                          'glow-grace-salon', 'rupasi-sarees', 'showme')
  ) x
 where length(p10) = 10 and p10 <> '9000000000'
 order by p10, created_at desc;

-- Already a lead (from the Hub): just mark it signed up.
update public.sales_leads l
   set signed_up = true,
       store_slug = coalesce(l.store_slug, s.slug)
  from sales_import_shops s
 where l.phone = s.p10 and (not l.signed_up or l.store_slug is null);

insert into public.sales_leads (
  created_at, shop_name, phone, business_type, city, source, source_detail,
  stage, won_plan, signed_up, store_slug)
select s.created_at, s.shop_name, s.p10, s.business_type, s.city, 'signup', 'Signed up on PocketLink',
       case when s.paying then 'won' else 'new' end,
       case when s.paying then left(s.plan, 40) end,
       true, s.slug
  from sales_import_shops s
on conflict do nothing;

insert into public.sales_activities (lead_id, staff_id, kind, outcome, note, created_at)
select l.id, null, 'system', 'signed_up', 'Signed up on PocketLink', s.created_at
  from public.sales_leads l
  join sales_import_shops s on s.p10 = l.phone
 where not exists (select 1 from public.sales_activities a where a.lead_id = l.id and a.outcome = 'signed_up');

-- 4. Pending sign-ups ----------------------------------------------------------
with p as (
  select distinct on (p10) *
    from (select ps.*, right(regexp_replace(coalesce(ps.phone, ''), '[^0-9]', '', 'g'), 10) as p10
            from public.pending_signups ps) x
   where length(p10) = 10 and p10 <> '9000000000'
   order by p10, created_at desc
)
insert into public.sales_leads (created_at, shop_name, phone, source, source_detail, stage)
select p.created_at, 'Sign-up not finished', p.p10, 'pending_signup',
       left('Started sign-up for the ' || coalesce(nullif(p.plan, ''), 'paid') || ' plan, did not finish', 200), 'new'
  from p
on conflict do nothing;

drop table if exists pg_temp.sales_import_shops;

-- What came in.
select source, stage, count(*) as leads
  from public.sales_leads
 group by source, stage
 order by source, stage;
