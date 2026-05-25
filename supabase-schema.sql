-- Run this in Supabase → SQL Editor

create table public.stores (
  id         uuid        default gen_random_uuid() primary key,
  slug       text        unique not null,
  config     jsonb       not null,
  pin        text        not null default '1234',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.stores enable row level security;

create policy "Public read"   on public.stores for select using (true);
create policy "Public insert" on public.stores for insert with check (true);
create policy "Public update" on public.stores for update using (true);
