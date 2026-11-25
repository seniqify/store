// Training for the sales team, by role: each role reads its own track of
// modules (TRACKS) with screenshots of the real CRM (public/crm-training/*.webp,
// markers in trainingShots.json), then a short exam on its role, graded on the
// server (sales_exam_start / sales_exam_submit). The manager then signs the
// person off in Team. Facts follow pricingCopy.js / planLimits.js; prices are
// never typed here. Module keys never change (sales_training stores them).
//
// A module: { key, title, minutes, intro, sections, mistakes, check, points }.
// A section may say roles: [...] to show only in those roles' tracks.
// A section is one of:
//   { h, p }                      heading + paragraph
//   { h, list }                   heading + bullet list
//   { h, how: [...] }             heading + numbered how-to steps
//   { shot, h, caption, steps }   a screenshot; steps[i] explains marker i + 1
//   { widget: 'incentive' }       the incentive explainer (live rule)
import { PRICE } from '../utils/planLimits.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const M = inr(PRICE.monthly);
const Y = inr(PRICE.yearly);

export const MODULES = Object.freeze([
  {
    key: 'product', title: 'PocketLink in 10 minutes', minutes: 12,
    intro: 'What we sell, who it is for and what it costs. Everything you say to a customer starts here, so know it well.',
    sections: [
      { h: 'What PocketLink is', p: 'PocketLink gives a shop its own online page: one link (pocketlink.store/the-shop-name) with every product, price, size and colour. Customers open it in any browser, add to cart and the order arrives on the shop’s WhatsApp. No app to download, for the shop or for the customer.' },
      { shot: 'shop', h: 'What a shop page looks like', caption: 'A live example you can open and send: pocketlink.store/demo/aanyaboutique. Scroll it on your own phone before your first call, so you can describe it with confidence.' },
      { h: 'What is included in the one plan', list: [
        'Unlimited products and categories, with sizes, colours and stock counts.',
        'Online payments (UPI, card, net banking) straight into the shop’s own Razorpay account. Cash on delivery works too.',
        'Delivery across India with Delhivery and Shadowfax: pick the courier for each order, print the label, and the customer tracks it live on a page with the shop’s name.',
        'WhatsApp on autopilot: order confirmations (500 free every month), shipping updates, cart reminders and offers. Extra messages are paid in Coins (1 Coin = ₹0.50).',
        'Facebook and Instagram ads made and measured inside PocketLink; nothing is spent until the shop approves.',
        'Real profit per order and product, and sales statements in PDF and Excel.',
        'The shop’s own brand with a verified badge, and no PocketLink branding.',
      ] },
      { h: 'Price', p: `${M} a month, or ${Y} a year (two months free). Prices include GST. No setup fee, no contract, no commission on sales. The shop can cancel anytime; the page stays online and only the paid features stop. An optional ₹299 a month boost lifts a shop inside the PocketLink Marketplace.` },
      { h: 'Who it is for', p: 'Any business that sells and talks to customers on WhatsApp: clothing and sarees, sweets and spices, kirana, restaurants and cafés, bakeries, mobiles, jewellery, salons and other services, lodges. Most of our shops are in Solapur and nearby towns, and we are growing across Maharashtra.' },
      { h: 'Say it in one breath', p: '“PocketLink gives your shop its own online page. Customers see every product with the price, order in one tap, and the order comes to your WhatsApp. Payments and delivery are built in, and there is no commission.”' },
    ],
    mistakes: [
      `Quoting old prices. Today it is ${M} a month or ${Y} a year, nothing else.`,
      'Calling it an app. Nobody downloads anything: it is a link.',
      'Promising a feature you are not sure of. Check FAQ & help, or ask the manager.',
    ],
    check: { q: 'What does PocketLink take from each order a shop gets?', options: ['5% of the order', 'Nothing: 0% commission', '₹10 per order', 'Only on online payments'], answer: 1, why: 'There is no commission. Online money goes straight to the shop’s own Razorpay.' },
    points: [`${M} a month or ${Y} a year, GST included`, '0% commission; online money goes to the shop’s own Razorpay', 'No app for anyone: a link that opens in the browser, orders on WhatsApp', 'Cancel anytime'],
  },
  {
    key: 'day', title: 'A day in the job', minutes: 10,
    intro: 'What a good day looks like, from signing in to going home.',
    sections: [
      { shot: 'login', h: 'Sign in', caption: 'Open crm.pocketlink.store on your phone (add it to your home screen so it opens like an app).', steps: [
        'Your work email.', 'The password your manager gave you. Change it in My account.', 'Sign in. The first time you open the CRM each day is your login time.', 'Forgot it? A link comes to your email.',
      ] },
      { shot: 'today', h: 'Your Today screen', caption: 'Start every day here.', steps: [
        'Your login time today (and, for the field team, when you started the day).',
        'Your own sign-up link and code: share it with every shop.',
        'What is due now and the new leads given to you.',
        'Open the call queue (callers) or check in at a shop (field).',
      ] },
      { roles: ['caller'], h: 'Your day as a calling executive', how: [
        '9:30 am: sign in, look at Today. Late follow-ups first.',
        '10 am to 1 pm: the call queue, one lead after another. Save an outcome after every call.',
        'Whenever the green “New lead” bar appears: call that lead within 5 minutes.',
        '2 pm to 6 pm: more calls, demos you booked, WhatsApp messages to send.',
        'Before 6:30 pm: every lead you spoke to has a note and a next date. Check Follow-ups for tomorrow.',
      ] },
      { roles: ['field'], shot: 'today_field', h: 'Start and end the day', caption: 'Your location is saved when you start and when you end the day.', steps: [
        'Start my day when you begin; End my day before you go home.', 'Check in at every shop you visit.',
      ] },
      { roles: ['field'], h: 'Your day as a field executive', how: [
        'Start my day. Plan the area: leads near each other, follow-ups due today first.',
        'At each shop: talk, show the example shop on your phone, make their shop if they are ready.',
        'Check in before you leave every shop, with the photo and the next step.',
        'End my day. Check Follow-ups for tomorrow.',
      ] },
    ],
    mistakes: ['Forgetting Start my day / End my day (field).', 'Leaving a lead without a next date.', 'Letting a new ad or website lead wait an hour.'],
    check: { q: 'What is your login time?', options: ['When your manager says', 'The first time you open the CRM that day', 'When you make your first call', '9:30 am always'], answer: 1, why: 'The first time you open the CRM each day is saved as your login time.' },
    points: ['Start every day on Today', 'Call new leads within 5 minutes', 'Every lead gets a note and a next date'],
  },
  {
    key: 'prospects', title: 'Who to call and visit', minutes: 8,
    intro: 'Good leads close faster. Learn to spot the shops that need PocketLink most, and where leads come from.',
    sections: [
      { h: 'Signs a shop needs PocketLink', list: [
        'They send product photos and prices one by one on WhatsApp.',
        'They have an Instagram page but no way to take orders from it.',
        'They send parcels outside the city, or want to.',
        'Customers ask “price?” on every photo, or orders get lost in chats.',
        'They already take UPI payments by hand and check screenshots.',
      ] },
      { h: 'Where leads come from', list: [
        'Sign-ups on PocketLink: they made a shop but did not pay yet. Call fast: they already want it.',
        'Ads and the website “Call me back” form: hot leads. Call within 5 minutes; after an hour, half of them forget they asked.',
        'Lists, expos and referrals your manager gives you.',
        'Field: the shop you are standing in. Add it at check-in.',
      ] },
      { shot: 'alert', h: 'A new lead arrives', caption: 'When a new lead is given to you, a green bar appears at the top with a sound (turn on alerts on Today).', steps: [
        'Who it is and where it came from.', 'Call now: the call timer starts.', 'Open the lead to see everything first.',
      ] },
      { h: 'Show a shop like theirs', p: 'Scripts → By type of business has live examples (clothing and salons) to send on WhatsApp. Seeing a real shop works better than any explanation.' },
    ],
    mistakes: ['Calling a hot lead tomorrow. Today, within 5 minutes.', 'Spending ten minutes on a shop that sells only to walk-in customers and never uses WhatsApp.'],
    check: { q: 'A lead from the website arrives at 11 am. When do you call?', options: ['Tomorrow morning', 'Within 5 minutes', 'After lunch', 'When they call again'], answer: 1, why: 'Speed wins: call new ad and website leads within 5 minutes.' },
    points: ['Call ad and website leads within 5 minutes', 'Sign-ups who did not pay are the warmest leads', 'Always show a live example'],
  },
  {
    key: 'first_call', title: 'The first call', minutes: 12,
    intro: 'The first call has one goal: book a 10-minute demo. Do not try to sell everything.',
    sections: [
      { h: 'The five steps', how: [
        'Open: your name, PocketLink, Solapur; check you are speaking to the owner. Busy? Ask when to call back and save it.',
        'Find the need: how do customers order today? Listen more than you talk; write their answer in the note.',
        'Pitch in two lines: their own link, every product with price, orders in one tap on their WhatsApp, payments and delivery built in.',
        'Show: send the example shop on WhatsApp while you talk.',
        'Ask for the demo: tomorrow at the shop or on a video call. Save the demo time before you hang up.',
      ] },
      { roles: ['caller'], shot: 'queue', h: 'The call queue, step by step', caption: 'Callers spend most of the day here.', steps: [
        'The lead you are calling now, and why (follow-up, new, late).',
        'Call: the phone opens; the call timer starts.',
        'What to say for their type of business. Scripts has the full script.',
        'After the call, tap how it went.',
        'Pick when to follow up.',
        'The call time is filled in for you. Wrong? Clear it.',
        'Save and call next.',
      ] },
      { roles: ['field'], h: 'Face to face at the shop', p: 'The same five steps work in person: ask for the owner by name, ask how customers order today, show the example shop on your phone, and book the demo, or give it right there if the shop is quiet. Before you leave, check in with the outcome and the next step.' },
      { h: 'Tone', p: 'Speak the customer’s language: Marathi, Hindi or English (Scripts has all three). Be short, friendly and honest. If they are not interested, thank them and save “Not interested” with the reason: it helps the whole team.' },
    ],
    mistakes: ['Not saving an outcome: the call does not count.', 'No note after a real conversation: the next person knows nothing.', 'Talking for five minutes before asking a single question.'],
    check: { q: 'What is the goal of the first call?', options: ['Take the payment', 'Book a 10-minute demo', 'Read the whole feature list', 'Get a referral'], answer: 1, why: 'Book the demo; the demo sells.' },
    points: ['Goal of the first call: a demo booked', 'Listen first, write the note', 'Save an outcome after every call'],
  },
  {
    key: 'demo', title: 'The 10-minute demo', minutes: 10,
    intro: 'A demo turns interest into a paid shop. Make their shop with them, on their phone, with your own link.',
    sections: [
      { h: 'The flow', how: [
        'Open the example shop for their type and place a test order, so they see the order arrive on WhatsApp.',
        'Open your own sign-up link on their phone (My account → My sign-up link). The shop is then yours when it pays.',
        'Make the shop together: name, WhatsApp number, three products with photos and prices.',
        'Share their new link to their WhatsApp status. Seeing their own shop live is the moment they decide.',
        `Close: ${M} a month or ${Y} a year, paid at pocketlink.store/plans by UPI, card or net banking (the module “Taking the payment” shows every step).`,
      ] },
      { shot: 'mylink', h: 'Your own sign-up link', caption: 'On Today and in My account.', steps: [
        'Your code. A shop owner can also type it when signing up.', 'Send the link on WhatsApp.', 'Copy the code to say or write it.',
      ] },
      { shot: 'start', h: 'What the shop owner sees', caption: 'Your link opens PocketLink’s sign-up page with your code already filled in.', steps: [
        'The owner enters their WhatsApp number and continues.', 'Your code is shown here. If they came without your link, they tap “Have a code from someone at PocketLink?” and type it.',
      ] },
      { roles: ['caller'], h: 'On a video call', how: [
        'Send a WhatsApp video call at the time you booked. Ask them to keep their phone charged and on Wi-Fi if they can.',
        'Share your screen: the example shop for their type, then a test order arriving on WhatsApp.',
        'Send your own sign-up link on WhatsApp and stay on the call while they open it and make the shop.',
        'Guide them through three products, step by step. Never ask for their OTP or password: they type it themselves.',
      ] },
      { roles: ['field'], h: 'At the shop', how: [
        'Sit with the owner, not the staff. Ask for 10 minutes when the shop is quiet.',
        'Show the example shop on your phone, then open your own sign-up link on their phone.',
        'Take photos of three real products together, in good light, and add them with prices.',
        'Put the new link in their WhatsApp status before you leave.',
      ] },
      { h: 'If they need time', p: 'Book the next step before you leave: a call in 2 days, after they add products. Never leave without a date.' },
    ],
    mistakes: ['Making their shop without your link or code: the win is not yours.', 'Leaving without the next date.', 'Doing everything for them: they should add at least one product themselves.'],
    check: { q: 'You help a shop sign up on their phone. How do you make sure the win is yours?', options: ['Tell the manager later', 'Use your own sign-up link or code', 'Mark it Won yourself', 'Save their number'], answer: 1, why: 'The link or code records that you brought the shop; when it pays, the CRM credits you by itself.' },
    points: ['Always use your own sign-up link', 'Make three products together; share the link live', 'Never leave without the next date'],
  },
  {
    key: 'objections', title: 'Objections and honest answers', minutes: 10,
    intro: 'Most “no” answers are questions. Answer honestly and never promise what PocketLink does not do.',
    sections: [
      { h: 'The usual ones', list: [
        `“Too costly”: ${M} a month is about ₹50 a day. One extra order a day pays for it, and there is no commission.`,
        '“I already sell on WhatsApp”: keep WhatsApp! Orders still come there, without sending photos and prices one by one.',
        '“My customers do not pay online”: cash on delivery works, and the “Confirm my order” message catches fake orders before they ship.',
        '“I am not good with technology”: we set it up together. If they can use WhatsApp, they can use PocketLink.',
        '“Instagram is enough”: Instagram brings people; PocketLink turns them into orders. Put the PocketLink link in the bio.',
        '“Do you take a commission?”: never. 0%.',
        '“I will think about it”: offer the 10-minute demo, so they decide after seeing it.',
      ] },
      { shot: 'scripts', h: 'Scripts: what to say, in their language', caption: 'Open it from a lead to fill in their name.', steps: [
        'English, मराठी or हिंदी.', 'The script for the situation: first call, after a sign-up, shop visit.', 'Each step: what to say, with a tip.', 'Answers to objections.',
      ] },
      { h: 'Never promise', list: [
        'A discount or a free period your manager has not allowed (FAQ & help shows the rule).',
        'A feature that is not live. If you are not sure, ask the manager in FAQ & help.',
        'Results (“you will get 100 orders”). Promise what PocketLink does, not what the shop will earn.',
      ] },
    ],
    mistakes: ['Arguing with the customer.', 'Giving a discount to close.', 'Saying “I don’t know” and stopping: say “I will check and call you back today”, then do it.'],
    check: { q: '“It is too costly.” Your best answer:', options: ['Offer 50% off', 'About ₹50 a day; one extra order a day pays for it, and no commission', 'Say other apps cost more', 'End the call politely'], answer: 1, why: 'Make the price small and real, and remind them there is no commission.' },
    points: ['Most objections have a short honest answer in Scripts', 'Never promise discounts, features or results that are not real'],
  },
  {
    key: 'field', title: 'Shop visits (field team)', minutes: 10,
    intro: 'A visit counts only with a photo of the shop front and the place, taken at the shop.',
    sections: [
      { shot: 'checkin', h: 'Check in, step by step', caption: 'Do it before you leave every shop.', steps: [
        'Your location is found by itself. Weak (more than 150 m)? Step outside and press Again.',
        'Pick the lead, or “New shop here” for a shop that is not in the CRM yet.',
        'Take the photo of the shop front, at the shop. Never from the gallery.',
        'Who you met.',
        'How it went.',
        'The next step; it becomes a follow-up.',
        'Save the visit.',
      ] },
      { h: 'Before you leave every shop', how: [
        'Location found, accurate to under 150 m.',
        'The photo of the shop front is taken, in the check-in.',
        'Who you met and how it went are chosen.',
        'The next step has a day (or Won · paid / Not interested).',
        'A note with what they said: their own words help the next call.',
      ] },
      { h: 'What the manager sees', list: [
        'Each visit with its photo, the place on a map and the time.',
        'Visits far from where the shop was first checked in, a weak location, the same photo used twice, or too many kilometres in a few minutes are flagged.',
        'A flagged visit can be marked “do not count”, and leaves your score.',
      ] },
    ],
    mistakes: ['A photo from the gallery.', 'Checking in from the road instead of the shop.', 'No next step.'],
    check: { q: 'Your location says it is accurate to 400 m only. What do you do?', options: ['Save anyway', 'Step outside and press Again', 'Use a photo from the gallery', 'Skip the check-in'], answer: 1, why: 'A weak location gets the visit flagged; step outside and try again.' },
    points: ['Start and end your day in the CRM', 'Photo + place at the shop, every visit', 'Odd visits are flagged and may not count'],
  },
  {
    key: 'crm', title: 'Using the CRM every day', minutes: 12,
    intro: 'The CRM tells you who to call next and remembers everything for you.',
    sections: [
      { shot: 'lead', h: 'A lead', caption: 'Everything about one shop.', steps: [
        'The shop and the owner.', 'Call: opens the phone and starts the call timer.', 'WhatsApp the owner.',
      ] },
      { shot: 'followups', h: 'Follow-ups', caption: 'Every lead you keep needs a next step with a date.', steps: [
        'Late: their day has passed. These lower your Discipline score; do them first.', 'Due today.',
      ] },
      { h: 'Rules the CRM follows for you', list: [
        'Did not pick up three times: the lead waits three days, then you try again.',
        'A new ad or website lead nobody calls in time can move to the next person.',
        'A lead that belongs to someone else: do not call it. Ask the manager in FAQ & help to move it to you.',
      ] },
      { shot: 'help', h: 'FAQ & help', caption: 'Answers for customers and for you.', steps: [
        'Customer questions, with the right answers.', 'Your own doubts: score, incentive, rules.', 'Not there? Ask the manager; the answer comes back here.',
      ] },
      { shot: 'attendance', h: 'Attendance', caption: 'Your login times, the month and leave.', steps: [
        'Today: login time, start and end of day.', 'Your month: present, late, half day, leave, holidays, weekly offs.', 'Ask for leave; your manager approves it here.',
      ] },
    ],
    mistakes: ['Keeping leads in your head instead of in the CRM.', 'Calling a lead that belongs to someone else.'],
    check: { q: 'When is a follow-up late?', options: ['When it is in the evening', 'When its day has passed and it was not done', 'When the customer is busy', 'Never'], answer: 1, why: 'Late follow-ups lower your Discipline score.' },
    points: ['Save an outcome and a next date for every lead', 'Late follow-ups lower your score', 'Ask the manager in FAQ & help'],
  },
  {
    key: 'wins', title: 'Your link, wins and incentive', minutes: 12,
    intro: 'Your work is counted fairly: only real payments make wins, and incentives wait 30 days, so they are paid only for shops that stay.',
    sections: [
      { h: 'When a win counts', list: [
        'When PocketLink sees the shop’s payment.',
        'Or when the manager approves a win you marked yourself (for example, a shop that paid another way).',
        'Tapping “Won · paid” alone does not count until one of these happens.',
      ] },
      { shot: 'lead_won', h: 'A proven win', caption: 'The lead shows the payment was seen: only the plan and the amount, nothing else about the shop.', steps: ['Payment seen by PocketLink, with the plan and the amount.'] },
      { widget: 'incentive' },
      { shot: 'incentive_list', h: 'My incentive', caption: 'Each paid shop and where its incentive is.', steps: [
        'The shop (your lead), the plan and the amount it paid.', 'Earned: the shop was still paying after 30 days.', 'Waiting: the date of its check.',
      ] },
      { shot: 'score', h: 'My score', caption: 'Five areas from your calls, visits and wins.', steps: [
        'Your score and its band (Excellent 90+, Good 75+, Needs work 60+, At risk below).', 'Your biggest gap: work on it first.', 'Each area with its KPIs.',
      ] },
    ],
    mistakes: ['Selling to a shop that will not use PocketLink: it stops paying and the incentive is cancelled.', 'Forgetting your link with a shop you helped.'],
    check: { q: 'A shop paid on 1 November with your link. When is your incentive earned?', options: ['On 1 November', 'If the shop is still paying when it is checked, 34 days later', 'At the end of the year', 'When you ask the manager'], answer: 1, why: 'The incentive waits 30 days (checked on day 34, after the renewal) and is earned only if the shop still pays.' },
    points: ['Use your own link or code with every shop', 'A win counts when the payment is seen or the manager approves', 'Incentive is earned if the shop still pays after 30 days'],
  },
  {
    key: 'rules', title: 'Rules and conduct', minutes: 6,
    intro: 'Simple rules that keep customers’ trust and keep the team fair.',
    sections: [
      { h: 'Work', list: [
        'Your shift and weekly off are in My account. Your login time is the first time you open the CRM each day.',
        'Late, half days and absence follow the rules your manager set; ask for leave in Attendance.',
        'Your score is made of areas (Activity, Reach, Conversion, Revenue, Discipline) with targets for your role; see My score.',
      ] },
      { h: 'Money', list: [
        'Never take cash, or money to your own UPI, for the plan. The shop pays at pocketlink.store/plans by UPI, card or net banking and gets a GST invoice.',
        'Never promise a price that is not on pocketlink.store/plans.',
      ] },
      { h: 'Privacy and respect', list: [
        'Share only PocketLink’s own facts, prices and example shops.',
        'Never share another shop’s orders, customers or numbers, or your CRM password.',
        'Call between 9:30 am and 8 pm. If someone asks not to be called again, save it as Not interested.',
      ] },
    ],
    mistakes: ['Taking cash.', 'Sharing your password with a colleague.', 'Calling late at night.'],
    check: { q: 'A customer wants to pay you in cash. What do you do?', options: ['Take the cash', 'Ask them to pay at pocketlink.store/plans (UPI, card or net banking; GST invoice)', 'Your own UPI', 'A friend collects it'], answer: 1, why: 'The plan is paid only on pocketlink.store/plans. It is safe for everyone and gives the shop a GST invoice.' },
    points: ['No cash or personal UPI for the plan: pocketlink.store/plans only', 'Never share other shops’ data or your password', 'Call only 9:30 am to 8 pm'],
  },
  // ── Selling: the payment, the first 30 days, practice (callers and field) ──
  {
    key: 'payment', title: 'Taking the payment', minutes: 8,
    intro: 'The shop pays for the plan itself, on PocketLink’s plans page, on its own phone. You guide; you never touch the money.',
    sections: [
      { shot: 'plans', h: 'The plans page', caption: 'pocketlink.store/plans. Send it on WhatsApp, or open it on the owner’s phone.', steps: [
        'Monthly or yearly. Yearly is two months free.',
        'The price, GST included.',
        'Subscribe now: the owner confirms their WhatsApp number with a code, then pays.',
      ] },
      { h: 'Step by step, on the owner’s phone', how: [
        'New shop? Open your own sign-up link first (My account), so the shop is yours when it pays.',
        'Open pocketlink.store/plans and pick monthly or yearly with them.',
        'They enter their WhatsApp number and the code that comes on WhatsApp. They type it; never ask for it.',
        'They pay by UPI, card or net banking. The plan starts the moment the payment succeeds, with a GST invoice.',
        'A shop that already exists is upgraded at once. A new owner goes on to make the shop: stay with them.',
      ] },
      { h: 'After it is paid', list: [
        'The CRM sees the payment by itself and marks the lead Won with the plan and the amount. You do nothing.',
        'The payment did not go through? Try again, or another UPI app. Still stuck: note it and call back the same day.',
        'Paid another way (rare)? Mark Won yourself; it counts when your manager approves it.',
      ] },
    ],
    mistakes: ['Taking cash or money to your own UPI.', 'Asking for the WhatsApp code: the owner types it.', 'Forgetting your own link with a new shop.'],
    check: { q: 'How does a shop pay for PocketLink?', options: ['Cash to you', 'At pocketlink.store/plans, by UPI, card or net banking', 'A transfer to the manager', 'A payment link from the CRM'], answer: 1, why: 'Only on the plans page. It is safe, instant and gives a GST invoice.' },
    points: ['pocketlink.store/plans: monthly or yearly, UPI, card or net banking', 'Your link first with a new shop', 'Never cash, never your UPI, never the OTP'],
  },
  {
    key: 'first30', title: 'The first 30 days of a new shop', minutes: 8,
    intro: 'A shop that gets its first orders keeps paying. Your incentive is checked after 30 days, so help every new shop get started.',
    sections: [
      { h: 'Your plan for each new shop', how: [
        'Day 1: at least ten products with clear photos and prices. The link in their WhatsApp status and Instagram bio.',
        'Day 3: call. Any orders yet? Help them share the link with their regular customers.',
        'Day 7: the first order. Turn on online payments (their own Razorpay) and delivery if they send parcels.',
        'Day 14: a first offer or a festival message to their customers.',
        'Day 25: before the renewal, ask what is working and what is not. Fix it, or tell your manager.',
      ] },
      { h: 'Ideas that bring the first orders', list: [
        'A QR code of the shop link at the counter.',
        'The link in every WhatsApp reply: “See everything here”.',
        'Ten products is the minimum; thirty sells far better.',
        'Real photos of real products, not pictures from the internet.',
      ] },
      { shot: 'followups', h: 'Save it in the CRM', caption: 'Add each call as a follow-up on the lead (Day 3, 7, 14 and 25), so none is forgotten and your manager can see it.', steps: [
        'Late: a new shop waiting for your call. Do these first.', 'Due today: the calls for today.',
      ] },
    ],
    mistakes: ['Disappearing after the sale.', 'Leaving a shop with three products and no photos.', 'Waiting for the shop to call you with a problem.'],
    check: { q: 'A shop paid 10 days ago and has no orders yet. What do you do?', options: ['Nothing: it is paid', 'Help them share the link: status, bio, QR, a first offer', 'Offer a refund', 'Tell them to wait'], answer: 1, why: 'Shops with orders stay; shops without orders stop paying before the check.' },
    points: ['Day 1, 3, 7, 14, 25: a follow-up each', 'Ten products, real photos, the link everywhere', 'A shop with orders keeps paying'],
  },
  {
    key: 'practice', title: 'Practice and sign-off', minutes: 8,
    intro: 'Read, practise aloud, then do it with your manager watching. After the exam your manager signs you off.',
    sections: [
      { h: 'Practise these three with a colleague', list: [
        'The busy owner: “I am busy, call later.” Get a time and save it.',
        '“It is too costly.” About ₹50 a day; one extra order pays for it; no commission.',
        '“I already sell on WhatsApp.” Keep WhatsApp: orders still come there, without sending photos one by one.',
      ] },
      { shot: 'scripts', h: 'Practise with Scripts', caption: 'Open Scripts and read each step aloud.', steps: [
        'Practise in the language you will use most: English, मराठी or हिंदी.', 'Pick the situation: first call, after a sign-up, shop visit.', 'Say each step in your own words, with its tip.', 'Practise the answers to objections the most.',
      ] },
      { h: 'How to practise', how: [
        'Read the script in Scripts aloud three times, in the language you will use most.',
        'Do each role-play twice: once as the seller, once as the owner.',
        'Record yourself on your phone and listen once. Shorter is better.',
      ] },
      { h: 'Sign-off', list: [
        'After you pass the exam, your manager listens to a few of your calls (or joins two visits).',
        'Then they sign you off in Team. Until then, ask them before anything unusual.',
      ] },
    ],
    mistakes: ['Learning the script by heart and reading it like a robot.', 'Skipping practice and practising on real customers.'],
    check: { q: 'You passed the exam. What happens next?', options: ['Nothing', 'Your manager listens to some calls or joins visits, then signs you off', 'You get all the leads', 'The exam again'], answer: 1, why: 'The sign-off is the manager’s check that you can do it on your own.' },
    points: ['Practise the three hardest moments aloud', 'Short, friendly, honest', 'Sign-off comes after the exam'],
  },

  // ── Manager ────────────────────────────────────────────────────────────────
  {
    key: 'mgr_team', title: 'Your team’s day and coaching', minutes: 10,
    intro: 'Today shows the team now; Performance shows the month. Use both to coach one thing at a time.',
    sections: [
      { shot: 'mgr_today', h: 'Today', caption: 'Open it every morning and after lunch.', steps: [
        'The team’s numbers so far today.',
        'Each person: logged in, calls, visits or leads checked, late follow-ups.',
        'What needs you: wins to approve, leave to decide, questions to answer.',
      ] },
      { shot: 'mgr_performance', h: 'Performance', caption: 'Each person’s score from their own targets, and the team’s.', steps: [
        'The team score and paid shops against the target.',
        'Each person’s score, band and rank. Tap a person for their areas.',
        'Wins waiting for proof: approve only if the shop really paid.',
      ] },
      { h: 'A coaching routine', how: [
        'Every morning, 10 minutes: yesterday’s numbers, today’s focus, late follow-ups first.',
        'Every week, 15 minutes with each person: their weakest area (Performance shows it) and one change.',
        'Listen to three calls a week per caller, or join one field visit; praise one thing, fix one thing.',
      ] },
    ],
    mistakes: ['Looking only at paid shops: the areas show why.', 'Coaching five things at once.'],
    check: { q: 'A caller’s score is low. Where do you start?', options: ['Shout at them', 'Their weakest area in Performance, one change at a time', 'Give them fewer leads', 'Ignore it until month end'], answer: 1, why: 'Performance shows the biggest gap; fix that first.' },
    points: ['Today every morning; Performance every week', 'One change at a time, from the weakest area', 'Listen to real calls'],
  },
  {
    key: 'mgr_leads', title: 'Leads, Assign and lead sources', minutes: 12,
    intro: 'Who gets which lead: by hand in Assign, or by the auto-assign rules. Ad and website leads arrive by themselves.',
    sections: [
      { shot: 'mgr_assign', h: 'Assign', caption: 'Give leads to people.', steps: [
        'Show: not assigned, untouched for 7 days, not reachable, or one person’s leads.',
        'Tick the leads.',
        'One person, split evenly, or fewest open leads first.',
        'The auto-assign rules: on or off, who is in, places, and slow leads moved on.',
      ] },
      { h: 'The auto-assign rules', list: [
        'Turn them on so every ad and website lead goes to a caller at once, day or night (night leads wait for 9:30 am).',
        'Tick who gets leads; “turns” gives one each in order, “fewest” evens out the load.',
        'A place rule sends a city or area to one person (e.g. Pune → the Pune field executive).',
        'Slow leads: a new lead nobody calls in time moves to the next person.',
        'The Ads & leads team is never given leads; their checked leads go out by these rules.',
      ] },
      { shot: 'mgr_sources', h: 'Lead sources', caption: 'Where leads come from, and what they cost.', steps: [
        'Connect the website form, Google Ads and Facebook / Instagram lead forms.',
        'Every lead as it arrives, and how fast it was called.',
        'This month by campaign: leads, real and junk, called, demo, paid, cost per paid shop.',
      ] },
      { h: 'Importing a list', p: 'Add leads → Import a list (Excel or CSV). Leads already in the CRM are skipped. Lists the Ads & leads team imports wait until they are checked.' },
    ],
    mistakes: ['Leaving auto-assign off: hot leads wait for you.', 'Giving a caller 500 leads at once: give a day’s worth.'],
    check: { q: 'How do new ad and website leads reach callers?', options: ['You forward them on WhatsApp', 'The auto-assign rules give them out; turn them on in Assign', 'Callers pick them', 'They wait for the weekly report'], answer: 1, why: 'With the rules on, every lead has an owner within seconds.' },
    points: ['Auto-assign on, with the right people in it', 'Import lists; duplicates are skipped', 'Watch cost per paid shop, not cost per lead'],
  },
  {
    key: 'mgr_visits', title: 'Checking field visits', minutes: 6,
    intro: 'Every visit has a photo and a place. The CRM flags the odd ones; you decide.',
    sections: [
      { shot: 'mgr_visits', h: 'Field visits', caption: 'Each day, each person.', steps: [
        'The day and the person.',
        'Visits to check: why each one was flagged.',
        'It is fine, or Do not count it (it leaves their score).',
      ] },
      { h: 'Why a visit is flagged', list: [
        'Far from where the same shop was first checked in.',
        'A weak location (more than 150 m).',
        'The same photo used twice.',
        'Too many kilometres in a few minutes since the visit before.',
      ] },
      { h: 'Fair checks', p: 'Ask the person first: a shop may have moved, or GPS was poor inside a market. Mark it fine when it is explained; do not count it when it is not.' },
    ],
    mistakes: ['Not counting a visit without asking.', 'Never opening Field visits: then nobody follows the rules.'],
    check: { q: 'A visit is flagged as far from the shop’s first check-in. What do you do?', options: ['Ignore it', 'Ask the person, then mark it fine or do not count it', 'Fire them', 'Delete the visit'], answer: 1, why: 'Ask first; then decide.' },
    points: ['Check flagged visits weekly', 'Ask before you decide', 'Not counted = out of the score'],
  },
  {
    key: 'mgr_wins', title: 'Wins and incentives', minutes: 10,
    intro: 'A win counts when PocketLink sees the payment, or when you approve it. Incentives are paid only for shops that stay.',
    sections: [
      { h: 'Wins waiting for proof', list: [
        'A shop that paid on pocketlink.store/plans is marked Won by itself: nothing to do.',
        'A win someone marked themselves waits for you: Approve the win only if the shop really paid; otherwise Not paid yet.',
      ] },
      { shot: 'mgr_incentives', h: 'Incentives', caption: 'Everyone’s paid shops and what is owed.', steps: [
        'By person: waiting, earned and paid.',
        'Mark what is earned as paid on pay day.',
        'Approved wins need your check after 30 days: still paying, or stopped.',
      ] },
      { h: 'The rule', list: [
        'Set in Settings: the amount per monthly and yearly shop, a higher rate for the best months, the days a shop must keep paying, the pay day.',
        'The Ads & leads team gets a small amount for each paid shop from a lead they checked, with the same 30-day rule.',
        'Each shop is checked automatically 4 days after the hold, after its renewal.',
      ] },
    ],
    mistakes: ['Approving a win without seeing the payment.', 'Paying before the 30-day check.'],
    check: { q: 'When is an incentive earned?', options: ['The day the shop pays', 'When the shop is still paying at the check after the hold', 'At the end of the year', 'When the caller asks'], answer: 1, why: 'So nobody sells to shops that cancel.' },
    points: ['Approve only real payments', 'Earned after the 30-day check', 'Mark paid on pay day'],
  },
  {
    key: 'mgr_people', title: 'People: hiring, training and sign-off', minutes: 10,
    intro: 'Add people, set their targets, see their training and sign them off when they are ready.',
    sections: [
      { shot: 'mgr_team', h: 'Team', caption: 'Everyone in the CRM.', steps: [
        'Their role: calling, field, Ads & leads or manager.',
        'Targets for this person; empty means the team target from Settings.',
        'Passed the exam: listen, then Sign off.',
        'Add a person: they sign in with their email and the password you set.',
      ] },
      { h: 'A new person’s first week', how: [
        'Day 1: add them in Team (Must pass training: yes). They read their role’s modules.',
        'Day 2: role-play with you (the Practice module). They take the exam (three tries a day).',
        'Day 3 to 5: listen to their calls, join their visits, or watch them check leads.',
        'Sign them off in Team when they can work on their own.',
      ] },
      { h: 'When someone leaves', list: [
        'Team → Can sign in: No. Their history stays.',
        'Assign → their leads → give them to someone else, or follow the rules.',
      ] },
    ],
    mistakes: ['Signing off without listening to a single call.', 'Leaving the leads of someone who left with nobody.'],
    check: { q: 'A new hire passed the exam. What is next?', options: ['Nothing', 'Listen to their calls or join their visits, then sign them off in Team', 'Give them all the leads', 'Change their password'], answer: 1, why: 'The exam checks knowledge; the sign-off checks the work.' },
    points: ['Role, targets and training in Team', 'Sign off after watching real work', 'Move leads when someone leaves'],
  },
  {
    key: 'mgr_settings', title: 'Settings and reports', minutes: 8,
    intro: 'The team’s rules in one place, and a WhatsApp summary every evening.',
    sections: [
      { shot: 'mgr_settings', h: 'Settings', caption: 'Changes apply straight away. The chips at the top jump to each part.', steps: [
        'Score: area weights (adding up to 100) and team targets for each role.',
        'The incentive rule, with the pictures the team sees.',
        'Work hours, shifts and weekly offs, holidays, the training pass mark, reports.',
      ] },
      { h: 'Before each month', list: [
        'Add the month’s holidays, so nobody is marked absent on them.',
        'Check each person’s shift and weekly off.',
        'Tell the team about any change to targets or the incentive rule before the month starts.',
      ] },
      { h: 'Reports', list: [
        'Every day at 7 pm and every Monday at 9 am, a summary comes to the managers’ WhatsApp.',
        'Reports keeps each one: calls, visits, demos, paid shops, money, late follow-ups, who was in.',
      ] },
    ],
    mistakes: ['Changing targets in the middle of the month without telling the team.', 'Forgetting holidays: people are marked absent on them.'],
    check: { q: 'Where do you change targets, area weights and the incentive rule?', options: ['Team', 'Settings', 'Reports', 'FAQ & help'], answer: 1, why: 'Settings holds the team’s rules; a person’s own target is in Team.' },
    points: ['Team rules in Settings; personal targets in Team', 'The 7 pm report every day'],
  },

  // ── Ads & leads executive ──────────────────────────────────────────────────
  {
    key: 'ads_job', title: 'Your job: good leads, fast', minutes: 8,
    intro: 'You keep the leads clean: you check every lead from ads and the website, add and import new ones, and watch which campaigns bring real shops.',
    sections: [
      { shot: 'ads_today', h: 'Your Today screen', caption: 'Start every day here.', steps: [
        'Leads waiting for your check, and ad leads waiting over 30 minutes.',
        'What you checked today, and how many were real.',
        'Open Check leads.',
      ] },
      { h: 'What you do', list: [
        'Check every ad and website lead within 30 minutes: real or not.',
        'Add leads you find, and import lists (Facebook Leads Center, expos, Google). They wait for your check.',
        'Give your checked leads out by the auto-assign rules.',
        'Enter what each source spent, and tell your manager which campaigns bring junk.',
      ] },
      { h: 'What you do not do', list: [
        'Ad leads go to a caller at once; you do not hold them back. You check them at the same time.',
        'You do not give a lead to a person, or own leads. The rules do it.',
        'You do not see other people’s leads, scores, incentives or attendance.',
      ] },
      { h: 'Your day', how: [
        '9:30 am: sign in. Check the leads that came in overnight first.',
        'All day: every 30 minutes, check what is new. Ad leads first.',
        'Between checks: add and import leads, then check them and give them out.',
        'Before you leave: enter ad spend if it changed; note campaigns with a lot of junk.',
      ] },
    ],
    mistakes: ['Letting ad leads wait hours for a check.', 'Importing a list and not checking it: nobody calls it.'],
    check: { q: 'A new Facebook lead arrives. Who calls it first?', options: ['You, before anyone', 'The caller the rules give it to, within 5 minutes; you check it at the same time', 'The manager', 'Nobody until it is checked'], answer: 1, why: 'Hot leads never wait for the check; the check keeps the CRM clean.' },
    points: ['Every ad lead checked within 30 minutes', 'Your imports wait for your check', 'The rules give leads out, not you'],
  },
  {
    key: 'ads_check', title: 'Checking a lead', minutes: 10,
    intro: 'Verified means a caller can sell to it: a real person, with a real business, on a working number, not already in the CRM.',
    sections: [
      { shot: 'ads_check', h: 'Check leads', caption: 'One card for each lead.', steps: [
        'The lead: name, number, where it came from, and who has it.',
        'How long it has waited. Amber: an ad lead over 30 minutes.',
        'Call or WhatsApp to check.',
        'Fix the name, type of business and place, then Verified.',
        'Or close it: Spam, Wrong number, Duplicate, Not a business.',
      ] },
      { h: 'How to check', how: [
        'Look first: a real name? A business name, or a person’s name with a business type?',
        'WhatsApp: “Namaskar, this is PocketLink. You asked about an online shop for your business. Is this a good time to talk?” Or a short call.',
        'Ask one thing: “What do you sell?” A clear answer means a real business.',
        'Fix what is wrong (shop name, type, city, area) and add a note, then Verified.',
      ] },
      { h: 'Which result', list: [
        'Spam: random letters, a test, abuse, a bot.',
        'Wrong number: does not exist, or someone else answers.',
        'Duplicate: the same shop is already a lead (Add leads tells you when a number exists).',
        'Not a business: a buyer looking for a product, a job seeker, a student.',
        'Not sure after two tries? Leave it; check it again later in the day.',
      ] },
    ],
    mistakes: ['Marking Verified without checking, to look fast.', 'Selling on the check call: the caller sells, you check.'],
    check: { q: 'The name is random letters and the number does not exist. What do you mark?', options: ['Verified', 'Spam', 'Duplicate', 'Leave it'], answer: 1, why: 'Spam closes it, so nobody calls it again.' },
    points: ['Real person + real business + working number = Verified', 'Fix the details before Verified', 'Junk is closed, so nobody wastes a call'],
  },
  {
    key: 'ads_add', title: 'Adding and importing leads', minutes: 8,
    intro: 'New leads you add or import have no owner. They wait in Check leads until you check them, then the rules give them out.',
    sections: [
      { h: 'One lead', how: [
        'Add leads → One lead: shop name, mobile, type, city and where it came from.',
        'If the number is already a lead, the CRM tells you: do not add it again.',
        'Save. It waits in Check leads.',
      ] },
      { h: 'A list', how: [
        'Facebook: Meta Business Suite → Leads Center → Download (CSV). Google Ads: download the lead form answers.',
        'Add leads → Import a list → choose the file. Match the columns (shop name and mobile are needed).',
        'Pick where they came from (Facebook ad, Instagram ad, Google, expo list) and name the list with the campaign.',
        'Import. Numbers already in the CRM are skipped by themselves.',
      ] },
      { shot: 'ads_ready', h: 'Give out the checked ones', caption: 'After you check them, they go to the callers by the rules.', steps: [
        'How many checked leads have no owner yet.',
        'Give them out by the auto-assign rules. Off? Ask your manager to turn the rules on.',
      ] },
    ],
    mistakes: ['A list without a name: nobody knows which campaign it was.', 'Giving out a list before checking it.'],
    check: { q: 'You import a list from Facebook Leads Center. When does the team get it?', options: ['At once', 'After you check the leads and give them out by the rules', 'Next month', 'Never'], answer: 1, why: 'Imported lists wait for your check, so callers get only real leads.' },
    points: ['Name every list with the campaign', 'Imports wait for your check', 'Give out checked leads by the rules'],
  },
  {
    key: 'ads_quality', title: 'Lead quality and ad spend', minutes: 8,
    intro: 'A cheap lead is worthless if it is junk. Watch real leads and paid shops per rupee spent.',
    sections: [
      { shot: 'ads_sources', h: 'Lead sources: this month by campaign', caption: 'Each campaign from lead to paid shop.', steps: [
        'Each campaign: its leads, and how many you checked real.',
        'Junk. Red when a third or more is junk; the table goes on with called, demo and paid.',
        'Enter ad spend: then the cost per paid shop appears.',
      ] },
      { h: 'What to watch', list: [
        'Cost per paid shop: the number that matters.',
        'Junk share: a third or more means the form or the audience is wrong. Tell your manager the campaign name.',
        'Speed: leads checked within 30 minutes; callers called within 5.',
      ] },
      { h: 'Ad spend', p: 'At least once a week (and on the 1st for last month), enter what each source spent this month in Lead sources → Enter ad spend.' },
    ],
    mistakes: ['Judging a campaign by the number of leads.', 'Forgetting to enter spend: the cost per paid shop is then wrong.'],
    check: { q: 'Which number shows best that a campaign is good?', options: ['Likes', 'Leads', 'Cost per paid shop', 'Reach'], answer: 2, why: 'Only paid shops pay the bills.' },
    points: ['Cost per paid shop, not per lead', 'A third junk: tell your manager', 'Spend entered every week'],
  },
  {
    key: 'ads_incentive', title: 'Your score and incentive', minutes: 8,
    intro: 'Your score comes from how many leads you check, how fast, and how many of your real leads reach a demo and pay.',
    sections: [
      { shot: 'ads_score', h: 'My score', caption: 'Against targets your manager sets.', steps: [
        'Your score and band.',
        'Your biggest gap: work on it first.',
        'Each area: leads checked a day, checked within 30 minutes, checked leads that reached a demo, leads added, paid shops from your leads.',
      ] },
      { widget: 'incentive' },
      { h: 'Why careful checks pay', p: 'A lead you mark Verified that turns out fake wastes a caller’s time and never pays. Real leads become demos and paid shops: that is your score and your incentive.' },
    ],
    mistakes: ['Checking fast but carelessly.', 'Not adding leads on quiet days.'],
    check: { q: 'What do you earn for a lead you checked?', options: ['Nothing', 'A small amount when that shop pays and still pays after 30 days', 'The caller’s incentive', 'A fixed bonus'], answer: 1, why: 'The same 30-day rule as the callers, for a smaller amount.' },
    points: ['Score: checks, speed, demos, leads added, paid shops', 'A small amount per paid shop from your real leads', 'Careful checks beat fast checks'],
  },
]);

export const EXAM_SIZE = 15;

/** Each role's modules, in reading order. */
export const TRACKS = Object.freeze({
  caller: ['product', 'day', 'prospects', 'first_call', 'demo', 'objections', 'payment', 'first30', 'crm', 'wins', 'practice', 'rules'],
  field: ['product', 'day', 'prospects', 'field', 'first_call', 'demo', 'objections', 'payment', 'first30', 'crm', 'wins', 'practice', 'rules'],
  manager: ['product', 'mgr_team', 'mgr_leads', 'mgr_visits', 'mgr_wins', 'mgr_people', 'mgr_settings', 'objections', 'rules'],
  ads: ['product', 'ads_job', 'ads_check', 'ads_add', 'ads_quality', 'ads_incentive', 'rules'],
});
export const TRACK_LABEL = Object.freeze({ caller: 'Calling executive', field: 'Field executive', ads: 'Ads & leads executive', manager: 'Manager' });

/** A role's modules, each with only the sections meant for that role. */
export function modulesFor(role) {
  const keys = TRACKS[role] || TRACKS.caller;
  const r = TRACKS[role] ? role : 'caller';
  return keys.map((k) => MODULES.find((m) => m.key === k)).filter(Boolean)
    .map((m) => ({ ...m, sections: m.sections.filter((x) => !x.roles || x.roles.includes(r)) }));
}
