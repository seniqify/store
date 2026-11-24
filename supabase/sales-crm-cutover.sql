-- ===========================================================================
--  PocketLink Sales CRM  --  CUTOVER (run once the team works in the new CRM)
--
--  The Hub gave every crm_team member read access to ALL orders and
--  store_views. The Hub screen is gone and its sales people now work in the CRM
--  (sales_staff), so take them out of crm_team. Only 'admin' rows stay: the
--  founder's Console and staff-operated ads still check crm_team role 'admin'.
--
--  The crm_leads table is left as it was (an archive of the Hub).
--  Undo: re-insert the removed rows (the select below lists them first).
-- ===========================================================================

-- Who is about to lose Hub access (copy this result before running the delete).
select t.user_id, t.name, t.role
  from public.crm_team t
 where t.role <> 'admin'
   and exists (select 1 from public.sales_staff s where s.user_id = t.user_id);

delete from public.crm_team t
 where t.role <> 'admin'
   and exists (select 1 from public.sales_staff s where s.user_id = t.user_id);

-- After: only admins remain.
select role, count(*) as people from public.crm_team group by role;
