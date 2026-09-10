-- Explicit, persisted ad-account selection for a store's Meta connection.
--
-- Until now the code took ad_account_ids[0]. That is silent and wrong the moment
-- a merchant has more than one account: showme ended up pairing the PocketLink
-- Page with the Shobha IVF ad account purely because of array order, and the
-- only "fix" available was to reorder the array — which hides an explicit choice
-- inside incidental ordering.
--
-- selected_ad_account_id stores the merchant's actual choice. It is validated
-- server-side before being written (must be one of the accounts granted at
-- consent AND still readable via the Graph API), and it is used consistently by
-- reporting, preview and campaign creation.
--
-- Deliberately NOT backfilled: a store with several accounts and no selection is
-- asked to choose rather than being silently pointed at one. A store with a
-- single account keeps working with no selection stored.

alter table public.store_meta_accounts
  add column if not exists selected_ad_account_id text;

comment on column public.store_meta_accounts.selected_ad_account_id is
  'Merchant-chosen ad account (act_<digits>). Must be one of ad_account_ids. '
  'NULL = no explicit choice; callers use the single account if there is exactly '
  'one, otherwise they must ask the merchant to choose.';
