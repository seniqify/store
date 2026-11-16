-- ===========================================================================
-- UNDO supabase/review-asks-forward.sql
--
-- Removes the two functions and the "don't ask" table. Every "don't ask" the
-- shops chose is lost (those customers show under "To ask" again). Review
-- links, reviews and everything else are untouched: the forward file changed
-- nothing else.
-- ===========================================================================

begin;

drop function if exists public.get_review_asks(text, text);
drop function if exists public.set_review_ask_skip(text, text, uuid, boolean);
drop table if exists public.review_ask_skips;

commit;
