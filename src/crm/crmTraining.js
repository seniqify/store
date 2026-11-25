// Training for new sales team members: nine modules to read, then a short
// exam (graded on the server: sales_exam_start / sales_exam_submit). Facts
// follow pricingCopy.js / planLimits.js; prices are never typed here.
import { PRICE } from '../utils/planLimits.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const M = inr(PRICE.monthly);
const Y = inr(PRICE.yearly);

// Each module: { key, title, minutes, intro, sections: [{ h, p?, list? }], points: [...] }
export const MODULES = Object.freeze([
  {
    key: 'product', title: 'PocketLink in 10 minutes', minutes: 10,
    intro: 'What we sell, who it is for and what it costs. Everything you say to a customer starts here.',
    sections: [
      { h: 'What PocketLink is', p: 'PocketLink gives a shop its own online page: one link (pocketlink.store/the-shop-name) with every product, price, size and colour. Customers open it in any browser, add to cart and the order arrives on the shop’s WhatsApp. No app to download, for the shop or the customer.' },
      { h: 'What is included in the one plan', list: [
        'Unlimited products and categories, with sizes, colours and stock counts.',
        'Online payments (UPI, card, net banking) into the shop’s own Razorpay account. Cash on delivery works too.',
        'Delivery across India with Delhivery and Shadowfax: pick the courier for each order, print the label, the customer tracks it live.',
        'WhatsApp on autopilot: order confirmations (500 free every month), shipping updates, cart reminders and offers. Extra messages are paid in Coins (1 Coin = ₹0.50).',
        'Facebook and Instagram ads made and measured inside PocketLink, with nothing spent until the shop approves.',
        'Real profit per order and product, sales statements in PDF and Excel.',
        'The shop’s own brand with a verified badge, and no PocketLink branding.',
      ] },
      { h: 'Price', p: `${M} a month, or ${Y} a year (two months free). Prices include GST. No setup fee, no contract, no commission on sales. The shop can cancel anytime; the page stays online and only the paid features stop.` },
      { h: 'Who it is for', p: 'Any business that sells and talks to customers on WhatsApp: clothing and sarees, sweets and spices, kirana, restaurants and cafés, bakeries, mobiles, jewellery, salons and other services, lodges. Most of our shops are in Solapur and nearby towns, and we are growing across Maharashtra.' },
    ],
    points: [`${M} a month or ${Y} a year, GST included`, '0% commission; online money goes to the shop’s own Razorpay', 'No app for anyone: a link that opens in the browser, orders on WhatsApp', 'Cancel anytime'],
  },
  {
    key: 'prospects', title: 'Who to call and visit', minutes: 8,
    intro: 'Good leads close faster. Learn to spot the shops that need PocketLink most.',
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
        'Ads and the website: a hot lead. Call within 5 minutes; after an hour, half of them forget they asked.',
        'Lists, expos and referrals your manager gives you.',
        'Field: the shop you are standing in. Add it at check-in.',
      ] },
      { h: 'Show a shop like theirs', p: 'Scripts → By type of business has a live example shop for each type. Sending a real shop like theirs works better than any explanation.' },
    ],
    points: ['Call ad and website leads within 5 minutes', 'Sign-ups who did not pay are the warmest leads', 'Always show a live example shop of their type'],
  },
  {
    key: 'first_call', title: 'The first call', minutes: 10,
    intro: 'The first call has one goal: book a 10-minute demo. Do not try to sell everything.',
    sections: [
      { h: 'The five steps', list: [
        'Open: your name, PocketLink, Solapur; check you are speaking to the owner. Busy? Ask when to call back and save it.',
        'Find the need: how do customers order today? Listen more than you talk; write their answer in the note.',
        'Pitch in two lines: their own link, every product with price, orders in one tap on their WhatsApp, payments and delivery built in.',
        'Show: send the example shop for their type on WhatsApp while you talk.',
        'Ask for the demo: tomorrow at the shop or on a video call. Save the demo time before you hang up.',
      ] },
      { h: 'Tone', p: 'Speak the customer’s language: Marathi, Hindi or English (Scripts has all three). Be short, friendly and honest. If they are not interested, thank them and save “Not interested” with the reason: it helps the whole team.' },
      { h: 'After every call', p: 'Tap how it went and save. Every call needs an outcome, and a note when they picked up. The call timer saves how long you talked.' },
    ],
    points: ['Goal of the first call: a demo booked', 'Listen first, write the note', 'Save an outcome after every call'],
  },
  {
    key: 'demo', title: 'The 10-minute demo', minutes: 8,
    intro: 'A demo turns interest into a paid shop. Make their shop with them, on their phone.',
    sections: [
      { h: 'The flow', list: [
        'Open the example shop for their type and place a test order, so they see the order arrive on WhatsApp.',
        'Open pocketlink.store/start on their phone with your own sign-up link (My account → My sign-up link). The shop is then yours when it pays.',
        'Make the shop together: name, WhatsApp number, three products with photos and prices.',
        'Share their new link to their WhatsApp status. Seeing their own shop live is the moment they decide.',
        'Close: the plan is ' + M + ' a month or ' + Y + ' a year. Payment by UPI, card or net banking; the plan starts the moment the payment succeeds.',
      ] },
      { h: 'If they need time', p: 'Book the next step before you leave: a call in 2 days, after they add products. Never leave without a date.' },
    ],
    points: ['Always use your own sign-up link', 'Make three products together; share the link live', 'Never leave without the next date'],
  },
  {
    key: 'objections', title: 'Objections and honest answers', minutes: 8,
    intro: 'Most “no” answers are questions. Answer honestly and never promise what PocketLink does not do.',
    sections: [
      { h: 'The usual ones', list: [
        `“Too costly”: ${M} a month is about ₹50 a day. One extra order a day pays for it, and there is no commission.`,
        '“I already sell on WhatsApp”: keep WhatsApp! Orders still come there, without sending photos and prices one by one.',
        '“My customers do not pay online”: cash on delivery works, and the “Confirm my order” message catches fake orders before they ship.',
        '“I am not good with technology”: we set it up together. If they can use WhatsApp, they can use PocketLink.',
        '“Instagram is enough”: Instagram brings people; PocketLink turns them into orders. Put the PocketLink link in the bio.',
        '“I will think about it”: offer the 10-minute demo, so they decide after seeing it.',
      ] },
      { h: 'Never promise', list: [
        'A discount or a free period your manager has not allowed (FAQ & help shows the rule).',
        'A feature that is not live. If you are not sure, ask the manager in FAQ & help.',
        'Results (“you will get 100 orders”). Promise what PocketLink does, not what the shop will earn.',
      ] },
    ],
    points: ['Most objections have a short honest answer in Scripts', 'Never promise discounts, features or results that are not real'],
  },
  {
    key: 'field', title: 'Shop visits (field team)', minutes: 8,
    intro: 'A visit counts only with a photo of the shop front and the place, taken at the shop.',
    sections: [
      { h: 'Your day', list: [
        'Start my day on Today: your location is saved with the time.',
        'Plan visits by area; call ahead when you can.',
        'At each shop: talk, show the example shop, then Check in before you leave.',
        'End my day before you go home.',
      ] },
      { h: 'Check-in rules', list: [
        'Take the photo of the shop front at the shop; never from the gallery.',
        'Location on, allowed for the CRM. If it says “accurate to” more than 150 m, step outside and press Again.',
        'Choose who you met and how it went, and set the next step.',
        'The manager sees each visit with its photo and place. Far-away places, the same photo twice, or too many kilometres in a few minutes are flagged, and a visit can be not counted.',
      ] },
    ],
    points: ['Start and end your day in the CRM', 'Photo + place at the shop, every visit', 'Odd visits are flagged and may not count'],
  },
  {
    key: 'crm', title: 'Using the CRM every day', minutes: 10,
    intro: 'The CRM tells you who to call next and remembers everything for you.',
    sections: [
      { h: 'Today and the call queue', list: [
        'Today shows your login time, what is due and new leads for you.',
        'Call queue: due now first, then later today, then new leads. Tap Call, talk, come back, tap how it went, Save and call next.',
        'Did not pick up three times: the lead waits three days, then try again.',
      ] },
      { h: 'Follow-ups', p: 'Every lead you keep needs a next step with a date. A follow-up after its day is late, and late follow-ups lower your Discipline score. Follow-ups shows late, today, tomorrow and this week.' },
      { h: 'New leads arrive by themselves', p: 'Sign-ups and ad or website leads are given to people by the manager’s rules. A green bar and a sound tell you; call within 5 minutes. A lead nobody calls in time can move to the next person.' },
      { h: 'Not your lead?', p: 'Do not call a shop that belongs to someone else. Ask the manager in FAQ & help to move it to you.' },
    ],
    points: ['Save an outcome and a next date for every lead', 'Late follow-ups lower your score', 'Call new leads within 5 minutes'],
  },
  {
    key: 'wins', title: 'Your link, wins and incentive', minutes: 8,
    intro: 'Your work is counted fairly: only real payments make wins, and incentives wait 30 days.',
    sections: [
      { h: 'Your own sign-up link and code', p: 'My account and Today show your own link (pocketlink.store/start?ref=YOURCODE) and code. Share the link on WhatsApp, or let the owner type your code when they sign up. When that shop pays, the CRM marks the lead Won with the plan and amount, for you, by itself.' },
      { h: 'When a win counts', list: [
        'When PocketLink sees the shop’s payment.',
        'Or when the manager approves a win you marked yourself (for example, a shop that paid another way).',
        'Tapping “Won · paid” alone does not count until one of these happens.',
      ] },
      { h: 'Incentive', p: 'Your manager sets the amounts in Settings; My incentive shows the rule and each of your wins. An incentive is earned only if the shop is still paying 30 days after it paid (checked automatically after the first renewal). If the shop stops paying, the incentive is cancelled, so sell only to shops that will really use PocketLink.' },
    ],
    points: ['Use your own link or code with every shop', 'A win counts when the payment is seen or the manager approves', 'Incentive is earned if the shop still pays after 30 days'],
  },
  {
    key: 'rules', title: 'Rules and conduct', minutes: 6,
    intro: 'Simple rules that keep customers’ trust and keep the team fair.',
    sections: [
      { h: 'Work', list: [
        'Your shift and weekly off are in My account. Your login time is the first time you open the CRM each day.',
        'Late, half days and absence follow the rules in Settings; ask for leave in Attendance.',
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
    points: ['No cash for the plan; use the payment link', 'Never share other shops’ data or your password', 'Call only 9:30 am to 8 pm'],
  },
]);

export const EXAM_SIZE = 15;
