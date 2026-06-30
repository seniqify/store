/**
 * coachI18n — all owner-facing text for the Manage "Assistant" (Pocket) coach,
 * in English, Hindi and Marathi. Kept separate from storeCoach.js so the scoring
 * logic stays language-independent and every string lives in one place.
 *
 * Tasks and FAQs are matched to storeCoach by position/id, so only the text
 * differs per language — never the structure. Use coachText(lang) in the UI.
 */

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी'   },
  { code: 'mr', label: 'मराठी'   },
];

// Which tab/page each FAQ jumps to (shared across languages, by position).
const FAQ_META = [
  { tab: 'orders'   },
  { tab: 'settings' },
  { tab: 'settings' },
  { tab: 'products' },
  { tab: 'settings' },
  { tab: 'offers'   },
  { tab: 'orders'   },
  { link: '/plans'  },
  { tab: 'settings' },
];

const STR = {
  // ─────────────────────────── English ───────────────────────────
  en: {
    ui: {
      subtitle:      'Pocket · your store assistant',
      stepsProgress: '{done} of {total} steps done — finish the rest to get your store fully ready.',
      doNext:        'Do this next',
      checklist:     'Setup checklist',
      allStepsDone:  'All steps complete — nicely done! ✅',
      completed:     '{n} completed',
      gotQuestion:   'Got a question?',
      takeThere:     'Take me there',
      seePlans:      'See plans',
      allSetTitle:   'Your store is fully set up! 🎉',
      bringCustomers:'Now bring in customers:',
      shareTips: [
        'Share your link on WhatsApp status & groups',
        'Add it to your Instagram & Google profiles',
        'Print the QR poster for your shop counter',
      ],
      shareBtn:      'Share my store',
    },
    greeting: {
      name: 'there',
      t100: 'Your store is fully set up, {name}! 🎉 Here’s how to get more orders.',
      t75:  'Looking great, {name}! Just a few finishing touches left.',
      t40:  'You’re off to a strong start. Let’s finish setting up your store.',
      t0:   'Welcome, {name}! Let’s get your store ready to share — I’ll guide you step by step.',
    },
    tasks: {
      whatsapp:      { title: 'Add your WhatsApp number', desc: 'Every order is sent here — without it customers can’t reach you.', cta: 'Add number' },
      firstProduct:  { title: 'Add your first product', desc: 'Give customers something to browse and buy.', cta: 'Add product' },
      logo:          { title: 'Add your logo', desc: 'A logo makes your store look trustworthy and professional.', cta: 'Add logo' },
      tagline:       { title: 'Write a short tagline', desc: 'One line telling customers what you sell (shows in link previews too).', cta: 'Write tagline' },
      productImages: { title: 'Add photos to your products', desc: 'Products with clear photos sell far more.', cta: 'Add photos' },
      payment:       { title: 'Set up payments (UPI)', desc: 'Show your UPI so customers can pay you instantly at checkout.', cta: 'Add UPI' },
      catalogue:     { title: 'Build out your catalogue (4+ products)', desc: 'A fuller catalogue gives shoppers more reasons to order.', cta: 'Add more' },
      cover:         { title: 'Add a cover photo', desc: 'A banner photo makes your store page feel complete.', cta: 'Add cover' },
      categories:    { title: 'Organise products into categories', desc: 'Group products so customers can browse easily.', cta: 'Add category' },
      address:       { title: 'Add your shop address', desc: 'Helps nearby customers trust and find you.', cta: 'Add address' },
      offer:         { title: 'Add a welcome offer', desc: 'A small discount or announcement nudges first orders.', cta: 'Add offer' },
    },
    faqs: [
      { q: 'How do customers place an order?', a: 'Customers open your store link, add items to their cart, and tap “Place Order” / “Order on WhatsApp”. The full order arrives on your WhatsApp number, and also shows in your Orders tab.' },
      { q: 'How do my customers pay me?', a: 'You collect payment directly — UPI, cash on delivery, or bank transfer. PocketLink doesn’t take any cut. Add your UPI ID in Settings so it appears for customers at checkout.' },
      { q: 'How do I share my store?', a: 'In Settings, use “Copy link”, “Share on WhatsApp”, or print the “QR Poster”. Put your link in your WhatsApp status, Instagram bio, and Google profile to bring in customers.' },
      { q: 'How do I add or edit products?', a: 'Open the Products tab to add a product with its name, price and photo. Tap any product to edit its price, photo, stock or description anytime.' },
      { q: 'How do I change my name, logo or colours?', a: 'Everything about your store’s look — business name, tagline, logo, cover photo, brand colour and banner style — is in the Settings tab.' },
      { q: 'How do I run a sale or offer?', a: 'Use the Offers tab to add an announcement banner or a scheduled sale with discounted prices. It shows up automatically on your store page.' },
      { q: 'How do I manage orders I receive?', a: 'The Orders tab lists every order. Update its status (confirmed, packed, delivered), message the customer on WhatsApp, or call them — all from one card.' },
      { q: 'What do I get with Premium?', a: 'Premium removes the “Powered by PocketLink” badge, adds your AI store assistant and AI Insights, advanced stats, scheduled sales and more. See all plans on the Plans page.' },
      { q: 'Is my store already live?', a: 'Yes — your store is live the moment it’s created. Anyone with your link can browse and order. You just need to share it!' },
    ],
  },

  // ─────────────────────────── हिंदी (Hindi) ───────────────────────────
  hi: {
    ui: {
      subtitle:      'Pocket · आपका स्टोर सहायक',
      stepsProgress: '{total} में से {done} काम पूरे — बाकी पूरे करके अपना स्टोर तैयार करें।',
      doNext:        'आगे यह करें',
      checklist:     'सेटअप चेकलिस्ट',
      allStepsDone:  'सभी काम पूरे — बहुत बढ़िया! ✅',
      completed:     '{n} पूरे हुए',
      gotQuestion:   'कोई सवाल है?',
      takeThere:     'वहाँ ले चलें',
      seePlans:      'प्लान देखें',
      allSetTitle:   'आपका स्टोर पूरी तरह तैयार है! 🎉',
      bringCustomers:'अब ग्राहक लाएँ:',
      shareTips: [
        'अपना लिंक WhatsApp स्टेटस और ग्रुप में शेयर करें',
        'इसे Instagram और Google प्रोफ़ाइल में डालें',
        'दुकान के काउंटर के लिए QR पोस्टर प्रिंट करें',
      ],
      shareBtn:      'मेरा स्टोर शेयर करें',
    },
    greeting: {
      name: 'दोस्त',
      t100: 'आपका स्टोर पूरी तरह तैयार है, {name}! 🎉 अब ज़्यादा ऑर्डर पाने का तरीका देखें।',
      t75:  'बहुत बढ़िया, {name}! बस कुछ आख़िरी काम बाकी हैं।',
      t40:  'अच्छी शुरुआत! चलिए आपका स्टोर पूरा सेट करते हैं।',
      t0:   'स्वागत है, {name}! चलिए आपका स्टोर शेयर करने के लिए तैयार करें — मैं कदम-कदम पर मदद करूँगा।',
    },
    tasks: {
      whatsapp:      { title: 'अपना WhatsApp नंबर जोड़ें', desc: 'हर ऑर्डर यहीं आता है — इसके बिना ग्राहक आप तक नहीं पहुँच पाएँगे।', cta: 'नंबर जोड़ें' },
      firstProduct:  { title: 'अपना पहला प्रोडक्ट जोड़ें', desc: 'ग्राहकों को देखने और खरीदने के लिए कुछ दें।', cta: 'प्रोडक्ट जोड़ें' },
      logo:          { title: 'अपना लोगो जोड़ें', desc: 'लोगो से आपका स्टोर भरोसेमंद और पेशेवर दिखता है।', cta: 'लोगो जोड़ें' },
      tagline:       { title: 'एक छोटी टैगलाइन लिखें', desc: 'एक लाइन जो बताए आप क्या बेचते हैं (लिंक प्रीव्यू में भी दिखती है)।', cta: 'टैगलाइन लिखें' },
      productImages: { title: 'अपने प्रोडक्ट में फ़ोटो जोड़ें', desc: 'साफ़ फ़ोटो वाले प्रोडक्ट कहीं ज़्यादा बिकते हैं।', cta: 'फ़ोटो जोड़ें' },
      payment:       { title: 'पेमेंट सेट करें (UPI)', desc: 'अपना UPI दिखाएँ ताकि ग्राहक चेकआउट पर तुरंत भुगतान कर सकें।', cta: 'UPI जोड़ें' },
      catalogue:     { title: 'अपनी सूची बढ़ाएँ (4+ प्रोडक्ट)', desc: 'ज़्यादा प्रोडक्ट होने से ग्राहक ज़्यादा ऑर्डर करते हैं।', cta: 'और जोड़ें' },
      cover:         { title: 'कवर फ़ोटो जोड़ें', desc: 'बैनर फ़ोटो से आपका स्टोर पेज पूरा लगता है।', cta: 'कवर जोड़ें' },
      categories:    { title: 'प्रोडक्ट को श्रेणियों में बाँटें', desc: 'प्रोडक्ट को ग्रुप करें ताकि ग्राहक आसानी से देख सकें।', cta: 'श्रेणी जोड़ें' },
      address:       { title: 'अपनी दुकान का पता जोड़ें', desc: 'आस-पास के ग्राहकों को भरोसा करने और ढूँढने में मदद करता है।', cta: 'पता जोड़ें' },
      offer:         { title: 'एक स्वागत ऑफ़र जोड़ें', desc: 'छोटी छूट या घोषणा पहले ऑर्डर के लिए प्रेरित करती है।', cta: 'ऑफ़र जोड़ें' },
    },
    faqs: [
      { q: 'ग्राहक ऑर्डर कैसे करते हैं?', a: 'ग्राहक आपका स्टोर लिंक खोलते हैं, सामान कार्ट में डालते हैं, और “Place Order” / “Order on WhatsApp” दबाते हैं। पूरा ऑर्डर आपके WhatsApp नंबर पर आता है और Orders टैब में भी दिखता है।' },
      { q: 'ग्राहक मुझे पैसे कैसे देते हैं?', a: 'आप सीधे पैसे लेते हैं — UPI, कैश ऑन डिलीवरी या बैंक ट्रांसफ़र। PocketLink कोई कमीशन नहीं लेता। Settings में अपना UPI ID डालें ताकि वह चेकआउट पर ग्राहकों को दिखे।' },
      { q: 'मैं अपना स्टोर कैसे शेयर करूँ?', a: 'Settings में “Copy link”, “Share on WhatsApp” इस्तेमाल करें या “QR Poster” प्रिंट करें। अपना लिंक WhatsApp स्टेटस, Instagram बायो और Google प्रोफ़ाइल में डालें ताकि ग्राहक आएँ।' },
      { q: 'मैं प्रोडक्ट कैसे जोड़ूँ या बदलूँ?', a: 'Products टैब खोलकर नाम, कीमत और फ़ोटो के साथ प्रोडक्ट जोड़ें। किसी भी प्रोडक्ट पर टैप करके उसकी कीमत, फ़ोटो, स्टॉक या जानकारी कभी भी बदलें।' },
      { q: 'मैं नाम, लोगो या रंग कैसे बदलूँ?', a: 'आपके स्टोर की दिखावट से जुड़ी हर चीज़ — बिज़नेस नाम, टैगलाइन, लोगो, कवर फ़ोटो, ब्रांड रंग और बैनर स्टाइल — Settings टैब में है।' },
      { q: 'मैं सेल या ऑफ़र कैसे चलाऊँ?', a: 'Offers टैब से घोषणा बैनर या छूट वाली शेड्यूल्ड सेल जोड़ें। यह आपके स्टोर पेज पर अपने-आप दिखती है।' },
      { q: 'मुझे मिले ऑर्डर मैं कैसे संभालूँ?', a: 'Orders टैब में हर ऑर्डर दिखता है। उसकी स्थिति (कन्फ़र्म, पैक, डिलीवर) बदलें, ग्राहक को WhatsApp पर मैसेज करें या कॉल करें — सब एक ही कार्ड से।' },
      { q: 'Premium में मुझे क्या मिलता है?', a: 'Premium “Powered by PocketLink” बैज हटाता है, AI स्टोर असिस्टेंट और AI Insights, एडवांस्ड आँकड़े, शेड्यूल्ड सेल और बहुत कुछ जोड़ता है। सभी प्लान Plans पेज पर देखें।' },
      { q: 'क्या मेरा स्टोर पहले से लाइव है?', a: 'हाँ — आपका स्टोर बनते ही लाइव हो जाता है। आपके लिंक वाला कोई भी देख और ऑर्डर कर सकता है। आपको बस इसे शेयर करना है!' },
    ],
  },

  // ─────────────────────────── मराठी (Marathi) ───────────────────────────
  mr: {
    ui: {
      subtitle:      'Pocket · तुमचा स्टोअर सहाय्यक',
      stepsProgress: '{total} पैकी {done} पायऱ्या पूर्ण — उरलेल्या पूर्ण करून तुमचं स्टोअर तयार करा.',
      doNext:        'पुढे हे करा',
      checklist:     'सेटअप चेकलिस्ट',
      allStepsDone:  'सर्व पायऱ्या पूर्ण — छान काम! ✅',
      completed:     '{n} पूर्ण झाले',
      gotQuestion:   'काही प्रश्न आहे का?',
      takeThere:     'तिथे घेऊन चला',
      seePlans:      'प्लॅन पाहा',
      allSetTitle:   'तुमचं स्टोअर पूर्णपणे तयार आहे! 🎉',
      bringCustomers:'आता ग्राहक आणा:',
      shareTips: [
        'तुमची लिंक WhatsApp स्टेटस आणि ग्रुपमध्ये शेअर करा',
        'ती Instagram आणि Google प्रोफाइलमध्ये टाका',
        'दुकानाच्या काउंटरसाठी QR पोस्टर प्रिंट करा',
      ],
      shareBtn:      'माझं स्टोअर शेअर करा',
    },
    greeting: {
      name: 'मित्रा',
      t100: 'तुमचं स्टोअर पूर्णपणे तयार आहे, {name}! 🎉 आता जास्त ऑर्डर मिळवण्याचा मार्ग पाहा.',
      t75:  'छान चाललंय, {name}! फक्त काही शेवटची कामं बाकी आहेत.',
      t40:  'चांगली सुरुवात! चला तुमचं स्टोअर पूर्ण सेट करूया.',
      t0:   'स्वागत आहे, {name}! चला तुमचं स्टोअर शेअर करण्यासाठी तयार करूया — मी पायरीपायरीने मदत करेन.',
    },
    tasks: {
      whatsapp:      { title: 'तुमचा WhatsApp नंबर जोडा', desc: 'प्रत्येक ऑर्डर इथेच येते — याशिवाय ग्राहक तुमच्यापर्यंत पोहोचू शकणार नाहीत.', cta: 'नंबर जोडा' },
      firstProduct:  { title: 'तुमचं पहिलं प्रॉडक्ट जोडा', desc: 'ग्राहकांना पाहण्यासाठी आणि खरेदी करण्यासाठी काहीतरी द्या.', cta: 'प्रॉडक्ट जोडा' },
      logo:          { title: 'तुमचा लोगो जोडा', desc: 'लोगोमुळे तुमचं स्टोअर विश्वासार्ह आणि व्यावसायिक दिसतं.', cta: 'लोगो जोडा' },
      tagline:       { title: 'एक छोटी टॅगलाइन लिहा', desc: 'तुम्ही काय विकता हे सांगणारी एक ओळ (लिंक प्रिव्ह्यूमध्येही दिसते).', cta: 'टॅगलाइन लिहा' },
      productImages: { title: 'तुमच्या प्रॉडक्टमध्ये फोटो जोडा', desc: 'स्पष्ट फोटो असलेली प्रॉडक्ट खूप जास्त विकली जातात.', cta: 'फोटो जोडा' },
      payment:       { title: 'पेमेंट सेट करा (UPI)', desc: 'तुमचा UPI दाखवा जेणेकरून ग्राहक चेकआउटला लगेच पैसे देऊ शकतील.', cta: 'UPI जोडा' },
      catalogue:     { title: 'तुमची यादी वाढवा (4+ प्रॉडक्ट)', desc: 'जास्त प्रॉडक्ट असल्यास ग्राहक जास्त ऑर्डर करतात.', cta: 'अजून जोडा' },
      cover:         { title: 'कव्हर फोटो जोडा', desc: 'बॅनर फोटोमुळे तुमचं स्टोअर पेज पूर्ण वाटतं.', cta: 'कव्हर जोडा' },
      categories:    { title: 'प्रॉडक्ट कॅटेगरीमध्ये लावा', desc: 'प्रॉडक्ट गटात ठेवा जेणेकरून ग्राहक सहज पाहू शकतील.', cta: 'कॅटेगरी जोडा' },
      address:       { title: 'तुमच्या दुकानाचा पत्ता जोडा', desc: 'जवळच्या ग्राहकांना विश्वास ठेवायला आणि शोधायला मदत होते.', cta: 'पत्ता जोडा' },
      offer:         { title: 'एक स्वागत ऑफर जोडा', desc: 'छोटी सूट किंवा घोषणा पहिल्या ऑर्डरसाठी प्रोत्साहन देते.', cta: 'ऑफर जोडा' },
    },
    faqs: [
      { q: 'ग्राहक ऑर्डर कशी करतात?', a: 'ग्राहक तुमची स्टोअर लिंक उघडतात, वस्तू कार्टमध्ये टाकतात आणि “Place Order” / “Order on WhatsApp” दाबतात. पूर्ण ऑर्डर तुमच्या WhatsApp नंबरवर येते आणि Orders टॅबमध्येही दिसते.' },
      { q: 'ग्राहक मला पैसे कसे देतात?', a: 'तुम्ही थेट पैसे घेता — UPI, कॅश ऑन डिलिव्हरी किंवा बँक ट्रान्सफर. PocketLink कोणतंही कमिशन घेत नाही. Settings मध्ये तुमचा UPI ID टाका जेणेकरून तो चेकआउटला ग्राहकांना दिसेल.' },
      { q: 'मी माझं स्टोअर कसं शेअर करू?', a: 'Settings मध्ये “Copy link”, “Share on WhatsApp” वापरा किंवा “QR Poster” प्रिंट करा. तुमची लिंक WhatsApp स्टेटस, Instagram बायो आणि Google प्रोफाइलमध्ये टाका जेणेकरून ग्राहक येतील.' },
      { q: 'मी प्रॉडक्ट कसं जोडू किंवा बदलू?', a: 'Products टॅब उघडून नाव, किंमत आणि फोटोसह प्रॉडक्ट जोडा. कोणत्याही प्रॉडक्टवर टॅप करून त्याची किंमत, फोटो, स्टॉक किंवा माहिती कधीही बदला.' },
      { q: 'मी नाव, लोगो किंवा रंग कसे बदलू?', a: 'तुमच्या स्टोअरच्या दिसण्याशी संबंधित सर्व काही — व्यवसायाचं नाव, टॅगलाइन, लोगो, कव्हर फोटो, ब्रँड रंग आणि बॅनर स्टाइल — Settings टॅबमध्ये आहे.' },
      { q: 'मी सेल किंवा ऑफर कशी चालवू?', a: 'Offers टॅबमधून घोषणा बॅनर किंवा सवलतीच्या किमतीची शेड्यूल केलेली सेल जोडा. ती तुमच्या स्टोअर पेजवर आपोआप दिसते.' },
      { q: 'मला आलेल्या ऑर्डर मी कशा हाताळू?', a: 'Orders टॅबमध्ये प्रत्येक ऑर्डर दिसते. तिची स्थिती (कन्फर्म, पॅक, डिलिव्हर) बदला, ग्राहकाला WhatsApp वर मेसेज करा किंवा कॉल करा — सर्व एकाच कार्डमधून.' },
      { q: 'Premium मध्ये मला काय मिळतं?', a: 'Premium “Powered by PocketLink” बॅज काढतं, AI स्टोअर असिस्टंट आणि AI Insights, प्रगत आकडेवारी, शेड्यूल केलेल्या सेल आणि बरंच काही जोडतं. सर्व प्लॅन Plans पेजवर पाहा.' },
      { q: 'माझं स्टोअर आधीच लाइव्ह आहे का?', a: 'हो — तुमचं स्टोअर तयार होताच लाइव्ह होतं. तुमची लिंक असलेला कोणीही पाहू आणि ऑर्डर करू शकतो. तुम्हाला फक्त ते शेअर करायचं आहे!' },
    ],
  },
};

function greetingFor(g, score, name) {
  const n = (name && String(name).trim()) ? String(name).trim() : g.name;
  const tier = score >= 100 ? g.t100 : score >= 75 ? g.t75 : score >= 40 ? g.t40 : g.t0;
  return tier.replace('{name}', n);
}

/**
 * coachText — resolve all assistant strings for a language. FAQs are merged with
 * their shared tab/link targets so the UI can offer a one-tap jump.
 */
export function coachText(lang = 'en') {
  const s = STR[lang] || STR.en;
  return {
    ui: s.ui,
    tasks: s.tasks,
    greeting: (score, name) => greetingFor(s.greeting, score, name),
    faqs: s.faqs.map((f, i) => ({ ...f, ...FAQ_META[i] })),
  };
}
