import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/**
 * AI Insights — owner-side analysis of storefront AI Search Bar queries.
 *  • fetchAiSearches  — owner-only read of this store's searches (PIN-checked RPC).
 *  • analyzeSearches  — pure aggregation into dashboard-ready insights.
 *  • generateRecommendations — asks /api/ai-insights for plain-language advice.
 */

/** Owner-only: list this store's AI searches (PIN-checked server-side). */
export async function fetchAiSearches(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_ai_searches', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Words too generic to be useful as product keywords — English, Hinglish (Roman
// Hindi/Marathi) and Devanagari (Hindi + Marathi), so insights work whatever
// language the customer types in.
const STOPWORDS = new Set([
  // English
  'the','an','is','are','am','do','does','you','your','have','has','any','can','could','would',
  'my','me','we','our','for','of','to','in','on','at','and','or','with','what','which','how',
  'much','many','this','that','it','its','please','want','need','get','got','there','here','near',
  'available','availability','stock','sell','carry','show','tell','give','about','some','also','from',
  'price','prices','cost','costs','rate','rates','inr','under','below','above','over','than','less',
  'more','cheap','cheaper','budget','best','good','quality','buy','order','delivery','deliver','charge',
  'charges','shipping','time','today','open','closed','number','contact','hello','hey','okay',
  'yes','thanks','thank','pls','plz','sir','madam','bro',
  // Hinglish (roman)
  'hai','hain','kya','kaise','kaisa','kitne','kitna','kitni','milega','milegi','milta','mujhe','muje',
  'chahiye','chaiye','aapke','aapka','aap','paas','accha','achha','sasta','saste','daam','bhav','kimat',
  'kimmat','rupay','rupaye','paisa','paise','aur','hua','hoga','karo','karna','dena','do','ho','hu','hu',
  'mai','main','mera','meri','mere','koi','konsa','kaunsa','wala','wali','batao','dikha','dikhao',
  // Devanagari (Hindi + Marathi)
  'है','हैं','क्या','कैसे','आप','आपके','आपका','पास','मुझे','चाहिए','का','की','के','को','से','में','और',
  'यह','वह','कितने','कितना','कैसा','मिलेगा','मिलेगी','अच्छा','दाम','भाव','कोई','कौन','कौनसा','हो','कर',
  'दिखाओ','बताओ','सस्ता','रुपये','पैसे','कीमत',
  'आहे','मला','पाहिजे','किती','कसे','कसा','मिळेल','आणि','हे','ते','चा','ची','चे','ला','मध्ये','पण','का',
]);

const hasDevanagari = (w) => /[ऀ-ॿ]/.test(w);

function tokenize(q) {
  return String(q || '')
    .toLowerCase()                       // no-op for Devanagari, lowercases Latin
    .split(/[^\p{L}\p{N}\p{M}₹]+/u)      // keep letters, numbers & combining marks (Devanagari matras)
    .filter((w) => (w.length >= 3 || hasDevanagari(w)) && !STOPWORDS.has(w) && !/^₹?[\d,]+$/.test(w));
}

function topN(countMap, n) {
  return Object.entries(countMap)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

const INTENT_LABELS = {
  budget:       'Budget / price',
  category:     'Category browsing',
  availability: 'Availability check',
  delivery:     'Delivery & charges',
  feature:      'Feature / specific',
};

/** Aggregate raw search rows into everything the dashboard needs. Pure. */
export function analyzeSearches(rows = []) {
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const DAY = 86400000;

  const total = { today: 0, week: 0, month: 0, all: rows.length };
  const kw = {};          // keyword frequency (all)
  const notFoundKw = {};  // keyword frequency among unmatched (missed opportunities)
  const questionFreq = {};// exact-ish repeated questions (FAQ)
  const intents = {};
  const unansweredSeen = new Set();
  const unanswered = [];
  const kwRecent = {};    // last 7 days
  const kwPrior = {};     // 7–14 days ago

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t >= startToday.getTime()) total.today++;
    if (t >= now - 7 * DAY) total.week++;
    if (t >= now - 30 * DAY) total.month++;

    const toks = tokenize(r.question);
    for (const w of toks) {
      kw[w] = (kw[w] || 0) + 1;
      if (r.matched === false) notFoundKw[w] = (notFoundKw[w] || 0) + 1;
      if (t >= now - 7 * DAY)            kwRecent[w] = (kwRecent[w] || 0) + 1;
      else if (t >= now - 14 * DAY)      kwPrior[w]  = (kwPrior[w]  || 0) + 1;
    }

    const qn = String(r.question || '').trim().toLowerCase();
    if (qn) questionFreq[qn] = (questionFreq[qn] || 0) + 1;

    const intent = r.intent || 'feature';
    intents[intent] = (intents[intent] || 0) + 1;

    if (r.answered === false) {
      const key = qn.slice(0, 80);
      if (key && !unansweredSeen.has(key)) { unansweredSeen.add(key); unanswered.push(r.question); }
    }
  }

  // Trending: keywords up vs the previous week (need a couple of hits to count).
  const trending = Object.keys(kwRecent)
    .map((w) => ({ term: w, count: kwRecent[w], delta: kwRecent[w] - (kwPrior[w] || 0) }))
    .filter((x) => x.count >= 2 && x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);

  const intentList = Object.entries(intents)
    .map(([k, count]) => ({ key: k, label: INTENT_LABELS[k] || k, count }))
    .sort((a, b) => b.count - a.count);

  // FAQ = questions asked more than once (true repeats), newest-weighted by count.
  const faqs = Object.entries(questionFreq)
    .filter(([, c]) => c >= 2)
    .map(([q, count]) => ({ q, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    total,
    topKeywords:  topN(kw, 12),
    notFound:     topN(notFoundKw, 10),
    intentList,
    intentTotal:  rows.length,
    trending,
    faqs,
    unanswered:   unanswered.slice(0, 12),
  };
}

/** Compact summary for the recommendations endpoint (keeps tokens + PII low). */
export function buildInsightSummary(insights, period = 'last 30 days') {
  return {
    period,
    total: insights.total.month || insights.total.all,
    topSearches: insights.topKeywords.slice(0, 10),
    notFound:    insights.notFound.slice(0, 8),
    unanswered:  insights.unanswered.slice(0, 8),
    intents:     insights.intentList.map((x) => ({ label: x.label, count: x.count })),
  };
}

/** Ask the server for plain-language, sales-focused recommendations. */
export async function generateRecommendations(slug, summary) {
  try {
    const r = await fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, summary }),
    });
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data?.recommendations) ? data.recommendations : [];
  } catch {
    return [];
  }
}
