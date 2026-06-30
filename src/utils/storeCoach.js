/**
 * storeCoach — the brain behind the Manage "Assistant" tab.
 *
 * Pure, dependency-free, language-independent logic that reads a store's own
 * config and works out:
 *   • a weighted setup checklist (each task's id + done state),
 *   • a 0–100 "store health" score,
 *   • the single highest-impact next step.
 *
 * Display text (titles, descriptions, FAQs, greeting) lives in coachI18n.js and
 * is matched to these tasks by `id` — so the same logic powers every language.
 *
 * No network, no AI, no cost — it just grades the config the dashboard already
 * has in memory, so the bot answers instantly for every owner (Free included).
 */

// Count digits in a stored WhatsApp number ("91XXXXXXXXXX" or raw 10-digit).
function waDigits(config) {
  return String(config?.whatsappNumber || '').replace(/\D/g, '');
}

// Real, owner-created categories (the universal "All" filter doesn't count).
function realCategories(config) {
  return (config?.categories || []).filter((c) => c && c.id !== 'all');
}

const nonEmpty = (v) => !!(v && String(v).trim());

/**
 * buildTasks — the full ordered checklist, each task resolved to done/not.
 * Higher `weight` = more important to a working, sellable store. Display text
 * for each `id` lives in coachI18n.js (per language).
 *
 * @param {object} config — the store's business config
 * @returns {Array<{id,tab,weight,done}>}
 */
export function buildTasks(config = {}) {
  const products = config.products || [];
  const withImg  = products.filter((p) => nonEmpty(p?.image));
  const imgRatio = products.length ? withImg.length / products.length : 0;

  return [
    { id: 'whatsapp',      weight: 3, tab: 'settings',   done: waDigits(config).length >= 10 },
    { id: 'firstProduct',  weight: 3, tab: 'products',   done: products.length >= 1 },
    { id: 'logo',          weight: 2, tab: 'settings',   done: nonEmpty(config.logo) },
    { id: 'tagline',       weight: 2, tab: 'settings',   done: nonEmpty(config.tagline) },
    { id: 'productImages', weight: 2, tab: 'products',   done: products.length > 0 && imgRatio >= 0.7 },
    { id: 'payment',       weight: 2, tab: 'settings',   done: nonEmpty(config.upi) || nonEmpty(config.bank?.accountNumber) },
    { id: 'catalogue',     weight: 1, tab: 'products',   done: products.length >= 4 },
    { id: 'cover',         weight: 1, tab: 'settings',   done: nonEmpty(config.coverImage) },
    { id: 'categories',    weight: 1, tab: 'categories', done: realCategories(config).length >= 2 },
    { id: 'address',       weight: 1, tab: 'settings',   done: nonEmpty(config.address) || nonEmpty(config.city) },
    { id: 'offer',         weight: 1, tab: 'offers',     done: nonEmpty(config.promoText) || (config.offers || []).length > 0 },
  ];
}

/**
 * buildCoach — the whole assistant state in one call.
 * @returns {{tasks, todo, done, doneCount, total, score, nextTask}}
 */
export function buildCoach(config = {}) {
  const tasks = buildTasks(config);
  const total = tasks.length;
  const doneTasks = tasks.filter((t) => t.done);
  const todo = tasks.filter((t) => !t.done);

  const totalWeight = tasks.reduce((s, t) => s + t.weight, 0);
  const doneWeight  = doneTasks.reduce((s, t) => s + t.weight, 0);
  const score = totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0;

  // Highest-impact incomplete step (ties broken by checklist order).
  const nextTask = todo.slice().sort((a, b) => b.weight - a.weight)[0] || null;

  return {
    tasks,
    todo,
    done: doneTasks,
    doneCount: doneTasks.length,
    total,
    score,
    nextTask,
  };
}
