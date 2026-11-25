// Training for new sales team members: ten modules with screenshots of the
// real CRM (public/crm-training/*.webp, markers in trainingShots.json), then a
// short exam graded on the server (sales_exam_start / sales_exam_submit).
// Facts follow pricingCopy.js / planLimits.js; prices are never typed here.
//
// A module: { key, title, minutes, intro, sections, mistakes, check, points }.
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
    intro: 'What a good day looks like, from signing in to going home, for callers and for the field team.',
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
      { h: 'Calling executive: the day', how: [
        '9:30 am: sign in, look at Today. Late follow-ups first.',
        '10 am to 1 pm: the call queue, one lead after another. Save an outcome after every call.',
        'Whenever the green “New lead” bar appears: call that lead within 5 minutes.',
        '2 pm to 6 pm: more calls, demos you booked, WhatsApp messages to send.',
        'Before 6:30 pm: every lead you spoke to has a note and a next date. Check Follow-ups for tomorrow.',
      ] },
      { shot: 'today_field', h: 'Field executive: start and end the day', caption: 'Your location is saved when you start and when you end the day.', steps: [
        'Start my day when you begin; End my day before you go home.', 'Check in at every shop you visit.',
      ] },
      { h: 'Field executive: the day', how: [
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
      { shot: 'queue', h: 'The call queue, step by step', caption: 'Callers spend most of the day here.', steps: [
        'The lead you are calling now, and why (follow-up, new, late).',
        'Call: the phone opens; the call timer starts.',
        'What to say for their type of business. Scripts has the full script.',
        'After the call, tap how it went.',
        'Pick when to follow up.',
        'The call time is filled in for you. Wrong? Clear it.',
        'Save and call next.',
      ] },
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
        `Close: ${M} a month or ${Y} a year. Payment by UPI, card or net banking; the plan starts the moment the payment succeeds.`,
      ] },
      { shot: 'mylink', h: 'Your own sign-up link', caption: 'On Today and in My account.', steps: [
        'Your code. A shop owner can also type it when signing up.', 'Send the link on WhatsApp.', 'Copy the code to say or write it.',
      ] },
      { shot: 'start', h: 'What the shop owner sees', caption: 'Your link opens PocketLink’s sign-up page with your code already filled in.', steps: [
        'The owner enters their WhatsApp number and continues.', 'Your code is shown here. If they came without your link, they tap “Have a code from someone at PocketLink?” and type it.',
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
        'Your score has five areas: Activity, Reach, Conversion, Revenue and Discipline.',
      ] },
      { h: 'Money', list: [
        'Never take cash for the plan. The safest is the Razorpay payment link, which gives the shop a GST invoice.',
        'Never promise a price that is not on pocketlink.store/plans.',
      ] },
      { h: 'Privacy and respect', list: [
        'Share only PocketLink’s own facts, prices and example shops.',
        'Never share another shop’s orders, customers or numbers, or your CRM password.',
        'Call between 9:30 am and 8 pm. If someone asks not to be called again, save it as Not interested.',
      ] },
    ],
    mistakes: ['Taking cash.', 'Sharing your password with a colleague.', 'Calling late at night.'],
    check: { q: 'A customer wants to pay you in cash. The safest way:', options: ['Take the cash', 'Send the Razorpay payment link (GST invoice)', 'Your own UPI', 'A friend collects it'], answer: 1, why: 'The payment link is safe for everyone and gives the shop a GST invoice.' },
    points: ['No cash for the plan; use the payment link', 'Never share other shops’ data or your password', 'Call only 9:30 am to 8 pm'],
  },
]);

export const EXAM_SIZE = 15;
