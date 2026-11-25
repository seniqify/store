-- ===========================================================================
--  PocketLink Sales CRM  --  TRAINING v2: more exam questions
--  For the new training content (a day in the job, new-lead alerts, the call
--  timer, the code on the sign-up page, the incentive check, example shops).
--  The exam still picks 15 at random. Safe to run twice.
--  Undo: delete from public.sales_exam_questions where id between 26 and 32;
-- ===========================================================================
insert into public.sales_exam_questions (id, topic, question, options, answer) values
 (26, 'Day', 'What is saved as your login time?', '["The time your manager writes","The first time you open the CRM that day","Your first call","9:30 am, always"]', 1),
 (27, 'Day', 'A green "New lead" bar appears at the top of the CRM. What do you do?', '["Finish your list first","Call that lead within 5 minutes","Wait for the manager","Close it"]', 1),
 (28, 'Calls', 'How does the CRM know how long your call was?', '["You type it","From tapping Call to coming back to the CRM","The phone company sends it","It does not"]', 1),
 (29, 'Wins', 'A shop owner signs up later by themselves. How can the shop still be yours?', '["It cannot","They type your code on the sign-up page (Have a code from someone at PocketLink?)","Call the manager","Mark it won"]', 1),
 (30, 'Wins', 'A shop paid with your link, then stopped paying before its check. What happens to the incentive?', '["You still get it","It is cancelled","It is halved","It waits a year"]', 1),
 (31, 'Field', 'Where do you take the shop photo for a check-in?', '["From the gallery","At the shop, of the shop front, in the check-in","Any photo of the owner","From Google Maps"]', 1),
 (32, 'Product', 'Where is a live example shop you can send to a clothing shop?', '["pocketlink.store/demo/aanyaboutique","Any customer''s shop","A screenshot from Instagram","There is none"]', 0)
on conflict (id) do update set topic = excluded.topic, question = excluded.question, options = excluded.options, answer = excluded.answer;

select count(*) as active_questions from public.sales_exam_questions where active;
