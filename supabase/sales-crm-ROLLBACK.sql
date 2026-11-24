-- ===========================================================================
--  PocketLink Sales CRM  --  ROLLBACK (emergency only)
--
--  Removes everything sales-crm-forward.sql added, INCLUDING all CRM work done
--  since (leads, calls, visits, attendance). The Hub's crm_* tables were only
--  read by the import and are untouched, so the Hub still has its data.
--  Visit photos in the sales-visits bucket are left in place (delete them in
--  Storage first if the bucket itself must go).
-- ===========================================================================

drop policy if exists sales_visits_upload on storage.objects;
drop policy if exists sales_visits_view on storage.objects;

drop function if exists public.sales_day(text, double precision, double precision, integer);
drop function if exists public.sales_touch();
drop function if exists public.sales_today();
drop function if exists public.sales_assign(uuid[], uuid);
drop function if exists public.sales_log(uuid, text, text, text, text, timestamptz, text, double precision, double precision, integer, text, integer, text);
drop function if exists public.sales_phone_lookup(text);

drop table if exists public.sales_leave;
drop table if exists public.sales_holidays;
drop table if exists public.sales_attendance;
drop table if exists public.sales_activities;
drop table if exists public.sales_leads;
drop function if exists public.sales_leads_guard();
drop table if exists public.sales_staff;

drop function if exists public.sales_is_manager();
drop function if exists public.sales_is_staff();
drop function if exists public.sales_role();
