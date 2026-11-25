// What to say: call and visit scripts in English, Marathi and Hindi, answers
// to the usual objections, a hook per type of business with a live example
// shop, and ready WhatsApp messages. {me} is the person's own name; {shop},
// {owner}, {day} ... are filled from the lead when the script is opened from
// one. Prices come from planLimits.js so they never drift from /plans.
import { PRICE } from '../utils/planLimits.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const M = inr(PRICE.monthly);
const Y = inr(PRICE.yearly);
const PER_DAY = inr(Math.round(PRICE.monthly / 30 / 10) * 10);

export const LANGS = Object.freeze([['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']]);

export const SCRIPT_LIST = Object.freeze([
  ['first', 'Every new lead'], ['signup', 'Made a shop, not paid yet'], ['visit', 'Field executives'],
]);

// [step, what to say, tip]
export const SCRIPTS = {
  first: {
    en: { title: 'First call to a new lead', time: 'About 2–3 minutes', goal: 'Goal: book a demo. Do not try to sell everything on the first call.', steps: [
      ['Open', 'Namaskar, I am {me} from PocketLink, Solapur. Am I speaking with {owner} from {shop}?', 'Busy? Ask: "When can I call you back for 2 minutes?" Then tap "Busy, call later".'],
      ['Find the need', 'How do customers order from you today: at the shop, on a call, or on WhatsApp? Do you send photos and prices one by one on WhatsApp?', 'Listen more than you talk. Write their answer in the note.'],
      ['Pitch', 'PocketLink gives your shop its own online link. Customers see every product with price and size, order in one tap, and the order comes to your WhatsApp. You can take UPI, card or cash on delivery, and send parcels with Delhivery or Shadowfax.', ''],
      ['Show', 'Can I send you a shop like yours on WhatsApp? Have a look while we talk.', 'Send the example shop for their type of business (below).'],
      ['Ask for the demo', 'Shall we do a 10-minute demo, tomorrow at your shop or on a video call?', `Price asked? "${M} a month with everything included, and no commission on your sales."`],
    ] },
    mr: { title: 'नवीन लीडला पहिला कॉल', time: 'सुमारे २–३ मिनिटे', goal: 'उद्देश: डेमो बुक करणे. पहिल्याच कॉलवर सगळं विकायचा प्रयत्न करू नका.', steps: [
      ['सुरुवात', 'नमस्कार, मी {me}, PocketLink, सोलापूरहून. {shop} चे {owner} बोलत आहेत का?', 'कामात असतील तर: "दोन मिनिटांसाठी कधी फोन करू?" मग "Busy, call later" दाबा.'],
      ['गरज समजून घ्या', 'आज ग्राहक तुमच्याकडे कसे ऑर्डर करतात: दुकानात येऊन, फोनवर की WhatsApp वर? WhatsApp वर एक-एक फोटो आणि किंमत पाठवता का?', 'बोलण्यापेक्षा जास्त ऐका. त्यांचे उत्तर नोटमध्ये लिहा.'],
      ['माहिती द्या', 'PocketLink तुमच्या दुकानाची स्वतःची ऑनलाइन लिंक बनवते. ग्राहकांना प्रत्येक वस्तू किंमत आणि साइजसह दिसते, एका टॅपमध्ये ऑर्डर होते आणि ऑर्डर तुमच्या WhatsApp वर येते. UPI, कार्ड किंवा कॅश ऑन डिलिव्हरी घेता येते, आणि Delhivery किंवा Shadowfax ने पार्सल पाठवता येतात.', ''],
      ['दाखवा', 'तुमच्यासारख्या दुकानाची लिंक WhatsApp वर पाठवू का? बोलता-बोलता बघा.', 'त्यांच्या व्यवसायासारखे उदाहरण दुकान पाठवा (खाली).'],
      ['डेमो विचारा', 'उद्या तुमच्या दुकानात किंवा व्हिडिओ कॉलवर १० मिनिटांचा डेमो करूया का?', `किंमत विचारली तर: "सगळं मिळून महिन्याला ${M}, आणि तुमच्या विक्रीवर कोणतेही कमिशन नाही."`],
    ] },
    hi: { title: 'नए लीड को पहला कॉल', time: 'लगभग 2–3 मिनट', goal: 'लक्ष्य: डेमो बुक करना। पहले ही कॉल पर सब कुछ बेचने की कोशिश न करें।', steps: [
      ['शुरुआत', 'नमस्ते, मैं {me}, PocketLink, सोलापुर से। क्या मेरी बात {shop} के {owner} जी से हो रही है?', 'व्यस्त हों तो: "दो मिनट के लिए कब कॉल करूँ?" फिर "Busy, call later" दबाएँ।'],
      ['ज़रूरत समझें', 'आज ग्राहक आपसे कैसे ऑर्डर करते हैं: दुकान पर आकर, फ़ोन पर या WhatsApp पर? क्या आप WhatsApp पर एक-एक फ़ोटो और दाम भेजते हैं?', 'बोलने से ज़्यादा सुनें। उनका जवाब नोट में लिखें।'],
      ['जानकारी दें', 'PocketLink आपकी दुकान का अपना ऑनलाइन लिंक बनाता है। ग्राहक हर सामान दाम और साइज़ के साथ देखते हैं, एक टैप में ऑर्डर करते हैं, और ऑर्डर आपके WhatsApp पर आता है। UPI, कार्ड या कैश ऑन डिलीवरी ले सकते हैं, और Delhivery या Shadowfax से पार्सल भेज सकते हैं।', ''],
      ['दिखाएँ', 'आपकी जैसी दुकान का लिंक WhatsApp पर भेजूँ? बात करते-करते देख लीजिए।', 'उनके बिज़नेस जैसी उदाहरण दुकान भेजें (नीचे)।'],
      ['डेमो माँगें', 'कल आपकी दुकान पर या वीडियो कॉल पर 10 मिनट का डेमो करें?', `दाम पूछें तो: "सब कुछ मिलाकर ${M} महीना, और आपकी बिक्री पर कोई कमीशन नहीं।"`],
    ] },
  },
  signup: {
    en: { title: 'Call after a sign-up', time: 'About 3–4 minutes', goal: 'Goal: help them finish the shop, then take the plan payment.', steps: [
      ['Open', 'Namaskar {owner}, I am {me} from PocketLink. You made your shop {shop} on PocketLink. Congratulations! Did it go smoothly?', ''],
      ['Help', 'Have you added your products yet? How many products do you sell?', 'Stuck? Offer to add the first products together on this call.'],
      ['Value', 'With the plan you get unlimited products, online payments into your own Razorpay, Delhivery and Shadowfax couriers, and 500 free WhatsApp order confirmations every month.', ''],
      ['Close', `It is ${M} a month, or ${Y} a year, which is two months free. Shall I send the payment link on WhatsApp now?`, 'Prices include GST. They can pay by UPI, card or net banking.'],
      ['If not today', 'No problem. I will call you on {day} after you add your products.', 'Set the follow-up date before you hang up.'],
    ] },
    mr: { title: 'साइन-अप नंतरचा कॉल', time: 'सुमारे ३–४ मिनिटे', goal: 'उद्देश: दुकान पूर्ण करायला मदत करणे, मग प्लॅनचे पेमेंट घेणे.', steps: [
      ['सुरुवात', 'नमस्कार {owner}, मी PocketLink कडून {me}. तुम्ही PocketLink वर {shop} हे दुकान बनवलं, अभिनंदन! सगळं नीट झालं का?', ''],
      ['मदत', 'तुमच्या वस्तू टाकल्या का? तुम्ही किती वस्तू विकता?', 'अडकले असतील तर: याच कॉलवर पहिल्या वस्तू सोबत टाकूया असं सांगा.'],
      ['फायदे', 'प्लॅनमध्ये अमर्याद वस्तू, तुमच्याच Razorpay मध्ये ऑनलाइन पेमेंट, Delhivery आणि Shadowfax कुरिअर, आणि दर महिन्याला ५०० मोफत WhatsApp ऑर्डर कन्फर्मेशन मिळतात.', ''],
      ['पेमेंट', `महिन्याला ${M}, किंवा वर्षाला ${Y}, म्हणजे दोन महिने मोफत. पेमेंटची लिंक आत्ता WhatsApp वर पाठवू का?`, 'किमतीत GST समाविष्ट आहे. UPI, कार्ड किंवा नेट बँकिंगने भरता येते.'],
      ['आज नाही तर', 'काही हरकत नाही. वस्तू टाकल्यावर {day} ला मी पुन्हा फोन करेन.', 'फोन ठेवण्याआधी फॉलो-अपची तारीख ठेवा.'],
    ] },
    hi: { title: 'साइन-अप के बाद कॉल', time: 'लगभग 3–4 मिनट', goal: 'लक्ष्य: दुकान पूरी करने में मदद करना, फिर प्लान का पेमेंट लेना।', steps: [
      ['शुरुआत', 'नमस्ते {owner} जी, मैं PocketLink से {me}। आपने PocketLink पर {shop} दुकान बनाई, बधाई हो! सब ठीक से हो गया?', ''],
      ['मदद', 'क्या आपने अपने सामान डाल दिए? आप कितने सामान बेचते हैं?', 'अटके हों तो: इसी कॉल पर पहले सामान साथ में डालने की पेशकश करें।'],
      ['फ़ायदे', 'प्लान में अनलिमिटेड सामान, आपके अपने Razorpay में ऑनलाइन पेमेंट, Delhivery और Shadowfax कूरियर, और हर महीने 500 मुफ़्त WhatsApp ऑर्डर कन्फ़र्मेशन मिलते हैं।', ''],
      ['पेमेंट', `${M} महीना, या ${Y} साल, यानी दो महीने मुफ़्त। पेमेंट का लिंक अभी WhatsApp पर भेजूँ?`, 'दाम में GST शामिल है। UPI, कार्ड या नेट बैंकिंग से भर सकते हैं।'],
      ['आज नहीं तो', 'कोई बात नहीं। सामान डालने के बाद {day} को फिर बात करते हैं।', 'फ़ोन रखने से पहले फ़ॉलो-अप की तारीख सेट करें।'],
    ] },
  },
  visit: {
    en: { title: 'Shop visit (field)', time: 'About 5–10 minutes', goal: 'Goal: meet the owner, show a live shop, and leave with a next step.', steps: [
      ['Walk in', 'Namaskar, I am {me} from PocketLink. Can I take two minutes of your time?', 'Ask for the owner by name if you know it. Give the leaflet.'],
      ['Look around', 'Do customers order from you on WhatsApp? Do you send parcels outside Solapur?', 'Look for: WhatsApp orders on the counter phone, an Instagram page, parcels waiting.'],
      ['Show on your phone', 'Look, this is a shop like yours on PocketLink. Customers see everything, add to cart and the order comes on WhatsApp.', ''],
      ['Ask', 'Shall we make your shop right now? I will set it up with you.', 'Not now? Book the demo day before you leave.'],
      ['Check in', 'Before you leave: take the shop photo, choose how it went and set the next step.', 'A visit without a photo and location does not count in your score.'],
    ] },
    mr: { title: 'दुकान भेट (फील्ड)', time: 'सुमारे ५–१० मिनिटे', goal: 'उद्देश: मालकाला भेटणे, चालू दुकान दाखवणे, आणि पुढची स्टेप ठरवून निघणे.', steps: [
      ['आत जा', 'नमस्कार, मी PocketLink कडून {me}. तुमची दोन मिनिटे मिळतील का?', 'मालकाचे नाव माहीत असेल तर नावाने विचारा. पत्रक द्या.'],
      ['निरीक्षण', 'ग्राहक तुमच्याकडे WhatsApp वर ऑर्डर करतात का? सोलापूरबाहेर पार्सल पाठवता का?', 'काउंटरच्या फोनवर WhatsApp ऑर्डर, Instagram पेज, पाठवायचे पार्सल आहेत का बघा.'],
      ['फोनवर दाखवा', 'बघा, हे तुमच्यासारखं दुकान PocketLink वर आहे. ग्राहक सगळं बघतात, कार्टमध्ये टाकतात आणि ऑर्डर WhatsApp वर येते.', ''],
      ['विचारा', 'आत्ताच तुमचं दुकान बनवूया का? मी तुमच्यासोबत सेट करून देईन.', 'आत्ता नाही तर निघण्याआधी डेमोचा दिवस ठरवा.'],
      ['चेक-इन', 'निघण्याआधी: दुकानाचा फोटो घ्या, काय झालं ते निवडा आणि पुढची स्टेप ठेवा.', 'फोटो आणि लोकेशनशिवाय भेट तुमच्या स्कोअरमध्ये मोजली जात नाही.'],
    ] },
    hi: { title: 'दुकान विज़िट (फ़ील्ड)', time: 'लगभग 5–10 मिनट', goal: 'लक्ष्य: मालिक से मिलना, चालू दुकान दिखाना, और अगला कदम तय करके निकलना।', steps: [
      ['अंदर जाएँ', 'नमस्ते, मैं PocketLink से {me}। क्या आपके दो मिनट मिल सकते हैं?', 'मालिक का नाम पता हो तो नाम से पूछें। पर्चा दें।'],
      ['देखें', 'क्या ग्राहक आपसे WhatsApp पर ऑर्डर करते हैं? क्या आप सोलापुर के बाहर पार्सल भेजते हैं?', 'काउंटर के फ़ोन पर WhatsApp ऑर्डर, Instagram पेज, भेजने वाले पार्सल देखें।'],
      ['फ़ोन पर दिखाएँ', 'देखिए, यह आपकी जैसी दुकान PocketLink पर है। ग्राहक सब देखते हैं, कार्ट में डालते हैं और ऑर्डर WhatsApp पर आता है।', ''],
      ['पूछें', 'अभी आपकी दुकान बना दें? आपके साथ अभी सेट कर देते हैं।', 'अभी नहीं तो निकलने से पहले डेमो का दिन तय करें।'],
      ['चेक-इन', 'निकलने से पहले: दुकान की फ़ोटो लें, क्या हुआ वह चुनें और अगला कदम रखें।', 'फ़ोटो और लोकेशन के बिना विज़िट आपके स्कोर में नहीं गिनी जाती।'],
    ] },
  },
};

export const OBJECTIONS = {
  en: [
    ['It is too costly.', `${M} a month is about ${PER_DAY} a day. One extra order a day pays for it, and there is no commission on any sale.`],
    ['I already sell on WhatsApp.', 'Keep WhatsApp! Every order still comes to your WhatsApp. You just stop sending photos and prices one by one, and customers order in one tap.'],
    ['My customers do not pay online.', 'Cash on delivery works. Buyers get a "Confirm my order" message on WhatsApp, so fake orders show up before you ship.'],
    ['I am not good with technology.', 'We set it up with you. If you can use WhatsApp, you can use PocketLink.'],
    ['Instagram is enough for me.', 'Instagram brings people in; PocketLink turns them into orders with a cart, payment and delivery tracking. Put your PocketLink link in your Instagram bio.'],
    ['Do you take a commission?', 'Never. 0% commission. Online payments go straight to your own Razorpay account.'],
    ['I will think about it.', 'Of course. Can I show you a 10-minute demo tomorrow, so you decide after seeing it?'],
  ],
  mr: [
    ['खूप महाग आहे.', `महिन्याला ${M} म्हणजे दिवसाला सुमारे ${PER_DAY}. दिवसाला एक जास्त ऑर्डर आली तरी खर्च निघतो, आणि कोणत्याही विक्रीवर कमिशन नाही.`],
    ['मी आधीच WhatsApp वर विकतो.', 'WhatsApp चालूच ठेवा! प्रत्येक ऑर्डर तुमच्या WhatsApp वरच येते. फक्त एक-एक फोटो आणि किंमत पाठवणं थांबतं, आणि ग्राहक एका टॅपमध्ये ऑर्डर करतात.'],
    ['माझे ग्राहक ऑनलाइन पैसे देत नाहीत.', 'कॅश ऑन डिलिव्हरी चालते. ग्राहकाला WhatsApp वर "Confirm my order" मेसेज जातो, त्यामुळे खोट्या ऑर्डर पाठवण्याआधीच समजतात.'],
    ['मला टेक्नॉलॉजी जमत नाही.', 'आम्ही तुमच्यासोबत सेट करून देतो. WhatsApp वापरता येत असेल तर PocketLink पण वापरता येईल.'],
    ['मला Instagram पुरेसं आहे.', 'Instagram वरून लोक येतात; PocketLink त्यांना कार्ट, पेमेंट आणि डिलिव्हरी ट्रॅकिंगसह ऑर्डरमध्ये बदलते. तुमची PocketLink लिंक Instagram bio मध्ये टाका.'],
    ['तुम्ही कमिशन घेता का?', 'कधीच नाही. 0% कमिशन. ऑनलाइन पेमेंट थेट तुमच्या स्वतःच्या Razorpay खात्यात जाते.'],
    ['विचार करून सांगतो.', 'नक्की. उद्या १० मिनिटांचा डेमो दाखवू का, म्हणजे बघून ठरवता येईल?'],
  ],
  hi: [
    ['बहुत महँगा है।', `${M} महीना यानी दिन का लगभग ${PER_DAY}। दिन में एक ऑर्डर ज़्यादा आया तो खर्च निकल गया, और किसी भी बिक्री पर कमीशन नहीं।`],
    ['मैं पहले से WhatsApp पर बेचता हूँ।', 'WhatsApp चालू रखिए! हर ऑर्डर आपके WhatsApp पर ही आता है। बस एक-एक फ़ोटो और दाम भेजना बंद हो जाता है, और ग्राहक एक टैप में ऑर्डर करते हैं।'],
    ['मेरे ग्राहक ऑनलाइन पैसे नहीं देते।', 'कैश ऑन डिलीवरी चलता है। ग्राहक को WhatsApp पर "Confirm my order" मैसेज जाता है, इसलिए फ़र्ज़ी ऑर्डर भेजने से पहले ही पता चल जाते हैं।'],
    ['मुझे टेक्नोलॉजी नहीं आती।', 'हम आपके साथ सेट कर देते हैं। WhatsApp चला लेते हैं तो PocketLink भी चला लेंगे।'],
    ['मेरे लिए Instagram काफ़ी है।', 'Instagram से लोग आते हैं; PocketLink उन्हें कार्ट, पेमेंट और डिलीवरी ट्रैकिंग के साथ ऑर्डर में बदलता है। अपना PocketLink लिंक Instagram bio में डालिए।'],
    ['क्या आप कमीशन लेते हैं?', 'कभी नहीं। 0% कमीशन। ऑनलाइन पेमेंट सीधे आपके अपने Razorpay खाते में जाता है।'],
    ['सोचकर बताऊँगा।', 'ज़रूर। कल 10 मिनट का डेमो दिखा दूँ, ताकि देखकर फ़ैसला कर सकें?'],
  ],
};

export const OBJ_TITLE = { en: 'When they say…', mr: 'ग्राहक म्हणतो…', hi: 'ग्राहक कहता है…' };

// A hook per type of business, with a live example shop where there is one.
export const BUSINESS_HOOKS = Object.freeze([
  { t: 'Clothing and sarees', hook: 'Every design with sizes and colours on one link. No more "price?" on every photo.', shop: 'rupasi-sarees' },
  { t: 'Food, spices, sweets', hook: 'Send parcels across India with Delhivery or Shadowfax; buyers track them on a page with the shop’s name.', shop: 'maharaja-sweets' },
  { t: 'Restaurants and cafés', hook: 'A menu link for WhatsApp and Instagram. Orders come straight to the shop, with no app commission.', shop: 'annapurna-khanaval' },
  { t: 'Kirana and grocery', hook: 'Regular customers reorder from the link. Cash on delivery with a "Confirm my order" message.', shop: '' },
  { t: 'Textiles and towels', hook: 'Wholesale and retail prices on one page; bulk buyers order without calling.', shop: 'solapur-chaddar' },
  { t: 'Services (salon, tailor, classes)', hook: 'A price list customers can open and book from on WhatsApp.', shop: 'glow-grace-salon' },
  { t: 'Lodges and hotels', hook: 'Rooms with photos and prices; guests book on WhatsApp before they arrive.', shop: 'vitthal-lodge' },
]);
export const shopLink = (slug) => `https://www.pocketlink.store/${slug}`;

export const MESSAGES = Object.freeze([
  { t: 'Make your shop (your own link)', text: 'Namaskar {owner}, make your shop on PocketLink here: {my link} - it takes 2 minutes. Call me if you need any help. — {me}, PocketLink' },
  { t: 'After the call', text: 'Namaskar {owner}, thank you for your time. Here is a shop like yours on PocketLink: {example link}. — {me}, PocketLink' },
  { t: 'Demo reminder (day before)', text: 'Namaskar {owner}, reminder: our 10-minute PocketLink demo is tomorrow at {time}. See you then! — {me}, PocketLink' },
  { t: 'Payment link', text: `Here is your PocketLink plan link: {payment link}. ${M} a month incl. GST, cancel anytime. Your plan starts as soon as you pay. — {me}, PocketLink` },
]);

/** Put the known values into a script line; unknown {placeholders} stay for the screen to mark. */
export function fillScript(text, values) {
  return String(text).replace(/\{([a-z ]+)\}/g, (m, k) => (values?.[k] ? values[k] : m));
}
