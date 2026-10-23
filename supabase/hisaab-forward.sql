-- ===========================================================================
--  Hisaab: the shop's own expenses and monthly sales goal  --  FORWARD
--
--  2026-10-23, Payments redesign part 2 (founder-approved): the Hisaab tab
--  answers "is my shop really making money?". Product cost, courier charges,
--  packing and returns are already in PocketLink. What is not is the money the
--  owner spends outside an order - rent, ads, salary, transport, boxes - and
--  the month's sales goal. This adds a place for both, and nothing else.
--
--  TWO TABLES, reached ONLY through the PIN-checked functions below. RLS is on
--  with no policy, and the browser roles have no table privilege, so no
--  request can read or write a row directly:
--
--    store_expenses     one row per expense the owner adds. A row with
--                       repeats_monthly counts in every month from spent_on's
--                       month until ends_on's month (null = still repeating).
--    store_sales_goals  the goal per month (first day of the month). A month
--                       with no row uses the latest earlier one; 0 = no goal.
--
--  FIVE FUNCTIONS, each PIN-checked first, like update_order_status. A wrong
--  PIN reads as an empty book and every write returns null / false:
--
--    get_store_hisaab(slug, pin)                       -> jsonb {expenses, goals}
--    add_store_expense(slug, pin, day, amount, category, note, paid_with,
--                      repeats)                        -> uuid (null = refused)
--    delete_store_expense(slug, pin, id)               -> boolean
--    stop_store_expense(slug, pin, id, last_month)     -> boolean
--    set_store_sales_goal(slug, pin, month, amount)    -> boolean
--
--  The read returns ONE jsonb value rather than a set, so the API's 1,000-row
--  cap never applies to it.
--
--  Nothing that exists is changed.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/hisaab-verify.sql (every H row PASS)
--  UNDO: supabase/hisaab-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
declare
  v_md5  text;
  v_cols text;
  r      record;
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin(text,text) is missing - nothing changed';
  end if;
  if to_regclass('public.stores') is null then
    raise exception 'preflight: public.stores is missing - nothing changed';
  end if;

  -- A table of the same name that is not this one: stop, do not guess.
  if to_regclass('public.store_expenses') is not null then
    select string_agg(column_name, ',' order by column_name) into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'store_expenses';
    if v_cols <> 'amount,category,created_at,ends_on,id,note,paid_with,repeats_monthly,spent_on,store_slug' then
      raise exception 'preflight: a different public.store_expenses already exists (%) - nothing changed', v_cols;
    end if;
  end if;
  if to_regclass('public.store_sales_goals') is not null then
    select string_agg(column_name, ',' order by column_name) into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'store_sales_goals';
    if v_cols <> 'amount,month,store_slug,updated_at' then
      raise exception 'preflight: a different public.store_sales_goals already exists (%) - nothing changed', v_cols;
    end if;
  end if;

  -- A function of the same name that is not the reviewed one: stop.
  for r in
    select * from (values
      ('public.get_store_hisaab(text,text)',                                             '91082b923f5bc7c4c352589f719c4d5d'),
      ('public.add_store_expense(text,text,date,numeric,text,text,text,boolean)',        'b6ec422e03b5767da74a25c5c2d5e559'),
      ('public.delete_store_expense(text,text,uuid)',                                    '6bf0d262af9b2f33e8f8bb94002285c4'),
      ('public.stop_store_expense(text,text,uuid,date)',                                 '4377f639092f641481cc29dc3dc413dd'),
      ('public.set_store_sales_goal(text,text,date,numeric)',                            'a2ebe8fd23668e0f5d59730a594521bb')
    ) as t(sig, want)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is not null and v_md5 <> r.want then
      raise exception 'preflight: a different % already exists (md5 %) - nothing changed', r.sig, v_md5;
    end if;
  end loop;
end;
$preflight$;

-- ── 1. The tables ───────────────────────────────────────────────────────────

create table if not exists public.store_expenses (
  id              uuid          primary key default gen_random_uuid(),
  store_slug      text          not null references public.stores (slug) on delete cascade,
  spent_on        date          not null,
  amount          numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  category        text          not null check (category in
                    ('transport', 'packing', 'rent', 'salary', 'ads', 'raw_material', 'other')),
  note            text          not null default '' check (char_length(note) <= 80),
  paid_with       text          not null default 'cash' check (paid_with in ('cash', 'bank')),
  repeats_monthly boolean       not null default false,
  -- The LAST month a repeating expense counts in, as its first day.
  ends_on         date          check (ends_on is null
                    or (repeats_monthly and ends_on = date_trunc('month', ends_on::timestamp)::date
                        and ends_on >= date_trunc('month', spent_on::timestamp)::date)),
  created_at      timestamptz   not null default now()
);

comment on table public.store_expenses is
  'Hisaab: money a shop spent outside an order (rent, ads, salary...). Reached only through the PIN-checked hisaab functions.';

create index if not exists store_expenses_store_day_idx
  on public.store_expenses (store_slug, spent_on);

create table if not exists public.store_sales_goals (
  store_slug  text          not null references public.stores (slug) on delete cascade,
  month       date          not null check (extract(day from month) = 1),
  amount      numeric(12,2) not null check (amount >= 0 and amount <= 100000000),
  updated_at  timestamptz   not null default now(),
  primary key (store_slug, month)
);

comment on table public.store_sales_goals is
  'Hisaab: a shop''s sales goal from this month on (0 = no goal). Reached only through set_store_sales_goal / get_store_hisaab.';

alter table public.store_expenses    enable row level security;
alter table public.store_sales_goals enable row level security;
revoke all on table public.store_expenses    from public, anon, authenticated;
revoke all on table public.store_sales_goals from public, anon, authenticated;

-- ── 2. Read: the whole book, as one value ───────────────────────────────────

create or replace function public.get_store_hisaab(
  p_slug       text,
  p_hashed_pin text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  -- A wrong PIN reads as an empty book, never an error, like get_store_orders.
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return jsonb_build_object('expenses', '[]'::jsonb, 'goals', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'spent_on', e.spent_on, 'amount', e.amount,
               'category', e.category, 'note', e.note, 'paid_with', e.paid_with,
               'repeats_monthly', e.repeats_monthly, 'ends_on', e.ends_on,
               'created_at', e.created_at)
             order by e.spent_on, e.created_at, e.id)
        from public.store_expenses e
       where e.store_slug = p_slug), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('month', g.month, 'amount', g.amount) order by g.month)
        from public.store_sales_goals g
       where g.store_slug = p_slug), '[]'::jsonb));
end;
$function$;

-- ── 3. Writes ───────────────────────────────────────────────────────────────

create or replace function public.add_store_expense(
  p_slug       text,
  p_hashed_pin text,
  p_spent_on   date,
  p_amount     numeric,
  p_category   text,
  p_note       text,
  p_paid_with  text,
  p_repeats    boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_id    uuid;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;

  -- Refuse, never raise: the app says "could not save" either way.
  if p_spent_on is null or p_spent_on < date '2020-01-01' or p_spent_on > v_today
     or p_amount is null or p_amount <= 0 or p_amount > 10000000
     or p_category is null
     or p_category not in ('transport', 'packing', 'rent', 'salary', 'ads', 'raw_material', 'other')
     or coalesce(p_paid_with, '') not in ('cash', 'bank') then
    return null;
  end if;
  -- A bound on one shop's book, far above any real use.
  if (select count(*) from public.store_expenses e where e.store_slug = p_slug) >= 20000 then
    return null;
  end if;

  insert into public.store_expenses
    (store_slug, spent_on, amount, category, note, paid_with, repeats_monthly)
  values
    (p_slug, p_spent_on, round(p_amount, 2), p_category,
     left(btrim(coalesce(p_note, '')), 80), p_paid_with, coalesce(p_repeats, false))
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.delete_store_expense(
  p_slug       text,
  p_hashed_pin text,
  p_id         uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return false;
  end if;
  delete from public.store_expenses e
   where e.id = p_id and e.store_slug = p_slug;
  return found;
end;
$function$;

-- Stop a repeating expense: it still counts up to and including p_last_month,
-- and in no month after. Months already past keep it.
create or replace function public.stop_store_expense(
  p_slug       text,
  p_hashed_pin text,
  p_id         uuid,
  p_last_month date
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return false;
  end if;
  if p_last_month is null then
    return false;
  end if;
  update public.store_expenses e
     set ends_on = date_trunc('month', p_last_month::timestamp)::date
   where e.id = p_id and e.store_slug = p_slug
     and e.repeats_monthly
     and date_trunc('month', p_last_month::timestamp)::date >= date_trunc('month', e.spent_on::timestamp)::date;
  return found;
end;
$function$;

create or replace function public.set_store_sales_goal(
  p_slug       text,
  p_hashed_pin text,
  p_month      date,
  p_amount     numeric
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return false;
  end if;
  if p_month is null or p_amount is null or p_amount < 0 or p_amount > 100000000 then
    return false;
  end if;
  insert into public.store_sales_goals (store_slug, month, amount, updated_at)
  values (p_slug, date_trunc('month', p_month::timestamp)::date, round(p_amount, 2), now())
  on conflict (store_slug, month)
  do update set amount = excluded.amount, updated_at = excluded.updated_at;
  return true;
end;
$function$;

comment on function public.get_store_hisaab(text, text) is
  'PIN-checked: the shop''s expenses and sales goals as one jsonb value. Wrong PIN = empty book.';
comment on function public.add_store_expense(text, text, date, numeric, text, text, text, boolean) is
  'PIN-checked: add one expense. Returns its id, or null when refused.';
comment on function public.delete_store_expense(text, text, uuid) is
  'PIN-checked: delete one of this shop''s expenses. Returns whether it did.';
comment on function public.stop_store_expense(text, text, uuid, date) is
  'PIN-checked: a repeating expense stops after the given month. Returns whether it changed.';
comment on function public.set_store_sales_goal(text, text, date, numeric) is
  'PIN-checked: the sales goal from this month on (0 = no goal). Returns whether it saved.';

revoke all on function public.get_store_hisaab(text, text) from public;
revoke all on function public.add_store_expense(text, text, date, numeric, text, text, text, boolean) from public;
revoke all on function public.delete_store_expense(text, text, uuid) from public;
revoke all on function public.stop_store_expense(text, text, uuid, date) from public;
revoke all on function public.set_store_sales_goal(text, text, date, numeric) from public;
grant execute on function public.get_store_hisaab(text, text) to anon, authenticated, service_role;
grant execute on function public.add_store_expense(text, text, date, numeric, text, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.delete_store_expense(text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.stop_store_expense(text, text, uuid, date) to anon, authenticated, service_role;
grant execute on function public.set_store_sales_goal(text, text, date, numeric) to anon, authenticated, service_role;

commit;
