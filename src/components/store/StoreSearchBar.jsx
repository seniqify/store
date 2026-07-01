import { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, Search, X, MessageCircle, ArrowRight, Store } from 'lucide-react';
import { formatINR } from '../../utils/currency';
import { similarProducts } from '../../utils/similar';

/**
 * StoreSearchBar — the hero "ask or search" bar under the store header.
 *
 * • On EVERY store: instant, local product search (name / category / description).
 *   Results drop down Google-style; tap to jump to products or add to the cart.
 * • On PREMIUM stores (aiEnabled): the customer can ask a natural-language
 *   question and get an answer grounded in the shop's own catalogue, served by
 *   /api/ai-chat. The answer card sits above the product matches.
 *
 * Self-contained: it renders its own results dropdown and never touches the
 * ProductGrid's internal state, so it works regardless of how products render.
 */
export default function StoreSearchBar({
  products = [], primary = '#0d9488', onAddToCart, slug, businessName = 'this shop', waLink,
  aiEnabled = false, referrals = true,
}) {
  const [query,     setQuery]     = useState('');
  const [focused,   setFocused]   = useState(false);
  const [aiAnswer,  setAiAnswer]  = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [askedFor,  setAskedFor]  = useState('');
  const boxRef   = useRef(null);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();

  // Local product matches — name, category and description, capped for speed.
  const matches = useMemo(() => {
    if (!q) return [];
    return products
      .filter((p) => {
        const hay = `${p.name || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 6);
  }, [q, products]);

  // Products the AI answer actually names — so the shopper sees a real, tappable
  // card (with Add) under a written answer like "we have Protinex Junior…".
  const aiMatches = useMemo(
    () => (aiAnswer ? referencedProducts(aiAnswer, products) : []),
    [aiAnswer, products],
  );

  // What the dropdown lists: literal search hits first, then anything the AI
  // mentioned that wasn't already shown. De-duped by id, capped.
  const displayMatches = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of [...matches, ...aiMatches]) {
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out.slice(0, 6);
  }, [matches, aiMatches]);

  // True when the listed products came purely from the AI answer (not a typed
  // search hit) — lets us label them "Recommended" instead of "N matches".
  const fromAi = matches.length === 0 && aiMatches.length > 0;

  // When nothing in this store matches, surface the closest things it DOES sell
  // (instead of a dead end). Skipped while the AI is still thinking.
  const similar = useMemo(() => {
    if (!q || aiLoading || displayMatches.length > 0) return [];
    return similarProducts(query, products, { limit: 4 });
  }, [q, aiLoading, displayMatches, query, products]);

  // A few tappable example prompts shown while the bar is empty.
  const examples = useMemo(() => {
    if (aiEnabled) return ['What’s your bestseller?', 'Anything under ₹200?', 'Is delivery free?'];
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].slice(0, 3);
    if (cats.length) return cats;
    return products.slice(0, 3).map((p) => p.name).filter(Boolean);
  }, [aiEnabled, products]);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false); }
    function onKey(e)  { if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur(); } }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  function onChange(v) {
    setQuery(v);
    // A fresh edit invalidates the previous AI answer.
    if (aiAnswer || askedFor) { setAiAnswer(''); setAskedFor(''); }
  }

  function clear() {
    setQuery(''); setAiAnswer(''); setAskedFor('');
    inputRef.current?.focus();
  }

  function jumpToProducts() {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFocused(false);
  }

  async function ask(text) {
    const question = (text ?? query).trim();
    if (!question || !aiEnabled || aiLoading) return;
    setAiLoading(true);
    setAiAnswer('');
    setAskedFor(question);
    try {
      const r = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, messages: [{ role: 'user', content: question }] }),
      });
      const data = await r.json().catch(() => ({}));
      setAiAnswer(data?.reply || '');
    } catch {
      setAiAnswer('');
    } finally {
      setAiLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (aiEnabled) ask();
    else jumpToProducts();
  }

  function pickExample(ex) {
    setQuery(ex);
    setFocused(true);
    inputRef.current?.focus();
    if (aiEnabled) ask(ex);
  }

  const placeholder = aiEnabled ? `Ask anything or search ${businessName}…` : 'Search products…';
  const showPanel   = focused && q.length > 0;
  const hasAi       = aiEnabled && (aiLoading || aiAnswer || askedFor);

  return (
    <div className="w-full px-3 sm:px-4 mt-5">
      <div ref={boxRef} className="max-w-2xl mx-auto relative">
        <form onSubmit={onSubmit}>
          {/* Input row */}
          <div
            className="flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-3 sm:px-4 py-2.5 transition-shadow"
            style={
              focused
                ? { boxShadow: `0 0 0 3px ${primary}30, 0 14px 34px rgba(0,0,0,0.07)` }
                : { boxShadow: '0 8px 24px rgba(0,0,0,0.05)' }
            }
          >
            <span className="flex-shrink-0" style={{ color: aiEnabled ? primary : '#9ca3af' }}>
              {aiEnabled ? <Sparkles size={18} /> : <Search size={18} />}
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setFocused(true)}
              placeholder={placeholder}
              maxLength={300}
              className="flex-1 min-w-0 bg-transparent text-sm sm:text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none"
            />
            {query && (
              <button type="button" onClick={clear} aria-label="Clear"
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={16} />
              </button>
            )}
            {aiEnabled && (
              <button
                type="submit"
                disabled={!q || aiLoading}
                className="flex-shrink-0 inline-flex items-center gap-1.5 text-white text-xs sm:text-sm font-bold
                           pl-3 pr-3.5 py-2 rounded-xl disabled:opacity-40 active:scale-95 transition-transform"
                style={{ backgroundColor: primary }}
              >
                <Sparkles size={14} /> Ask
              </button>
            )}
          </div>
        </form>

        {/* Example chips while empty */}
        {!showPanel && examples.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
            {aiEnabled && <span className="text-[11px] text-gray-400">Try:</span>}
            {examples.map((ex) => (
              <button key={ex} type="button" onClick={() => pickExample(ex)}
                className="text-[11px] sm:text-xs font-medium text-gray-600 bg-white border border-gray-200
                           rounded-full px-3 py-1.5 shadow-sm hover:border-gray-300 active:scale-95 transition-all">
                {aiEnabled ? `“${ex}”` : ex}
              </button>
            ))}
          </div>
        )}

        {/* Results dropdown */}
        {showPanel && (
          <div className="absolute left-0 right-0 mt-2 z-40 bg-white rounded-2xl border border-gray-100 shadow-2xl overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto p-2">

              {/* AI answer card (Premium) */}
              {hasAi && (
                <div className="m-1 mb-2 rounded-xl p-3" style={{ background: `${primary}0d`, border: `1px solid ${primary}22` }}>
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: primary }}>
                    <Sparkles size={12} /> Answer
                  </p>
                  {aiLoading ? (
                    <span className="flex gap-1 py-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  ) : aiAnswer ? (
                    <p className="text-[13px] leading-snug text-gray-700 whitespace-pre-wrap">{aiAnswer}</p>
                  ) : (
                    <p className="text-[13px] leading-snug text-gray-500">
                      Couldn’t answer that one.{' '}
                      {waLink && <a href={waLink} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: primary }}>Ask on WhatsApp →</a>}
                    </p>
                  )}
                </div>
              )}

              {/* Product matches (literal search hits + anything the AI named) */}
              {displayMatches.length > 0 ? (
                <>
                  <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    {fromAi
                      ? 'Recommended'
                      : `${displayMatches.length} ${displayMatches.length === 1 ? 'match' : 'matches'}`}
                  </p>
                  {displayMatches.map((p) => (
                    <ProductRow key={p.id} product={p} primary={primary} onAdd={onAddToCart} onJump={jumpToProducts} />
                  ))}
                </>
              ) : !aiLoading && (
                similar.length > 0 ? (
                  /* In the store's range — keep it in-store, never refer out.
                     Show the closest things this shop actually sells. */
                  <>
                    <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      Not an exact match — you might like
                    </p>
                    {similar.map((p) => (
                      <ProductRow key={p.id} product={p} primary={primary} onAdd={onAddToCart} onJump={jumpToProducts} />
                    ))}
                    {!hasAi && waLink && <WhatsAppRow waLink={waLink} />}
                  </>
                ) : (
                  /* Out of the store's range (nothing similar). Only here do we
                     offer the marketplace — and only if the owner left local
                     referrals on. The merchant is never referred out for their
                     own categories, so no competitor ever shows on their page. */
                  <>
                    {!hasAi && (
                      <p className="px-3 pt-4 pb-1 text-center text-sm text-gray-500">
                        We don’t stock “{query.trim()}” here.
                      </p>
                    )}

                    {referrals && (
                      <a href={`/marketplace?q=${encodeURIComponent(query.trim())}`}
                         className="mt-1.5 mx-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-colors"
                         style={{ border: `1px dashed ${primary}55` }}>
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: `${primary}14`, color: primary }}>
                          <Store size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-gray-800 leading-tight">Can’t find it here?</span>
                          <span className="block text-[11px] text-gray-500 leading-tight">Search nearby shops on PocketLink</span>
                        </span>
                        <ArrowRight size={15} className="flex-shrink-0" style={{ color: primary }} />
                      </a>
                    )}

                    {!hasAi && waLink && <WhatsAppRow waLink={waLink} />}
                  </>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Find catalogue products the AI answer actually names, so we can show the real
// product card (with Add) beneath a written answer. Matches on the product's
// *core* name — size/variant/pack suffixes stripped — appearing in the reply, so
// "Protinex Junior - 400 g (Chocolate)" is found in "…we have Protinex Junior…".
const UNIT_TOKEN = /^(\d+(g|gm|gms|kgs?|ml|l|ltr|litre|liter)?|gm|gms|kgs?|ml|ltr|litre|liter|pcs?|pack|x)$/i;
function referencedProducts(reply, products) {
  const text = String(reply || '').toLowerCase();
  if (!text) return [];
  const out = [];
  for (const p of products) {
    const raw = String(p.name || '').trim();
    if (!raw) continue;
    // Cut at the first size/variant separator ( -, –, —, |, /, (, comma ).
    let core = raw.split(/\s[-–—|/(]|,/)[0].trim();
    // Drop trailing size/qty tokens ("Whey Protein 1kg" -> "Whey Protein").
    const toks = core.split(/\s+/);
    while (toks.length > 1 && UNIT_TOKEN.test(toks[toks.length - 1])) toks.pop();
    core = toks.join(' ').toLowerCase();
    if (core.length >= 3 && text.includes(core)) out.push(p);
  }
  return out.slice(0, 6);
}

// "Ask on WhatsApp" fallback row — shown when the shop can't answer/stock it.
function WhatsAppRow({ waLink }) {
  return (
    <a href={waLink} target="_blank" rel="noopener noreferrer"
       className="mt-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-semibold text-[#1ebe5d]">
      <MessageCircle size={13} /> Ask on WhatsApp
    </a>
  );
}

// One product result row. Tapping the row jumps to the grid; "Add" adds simple
// products straight to the cart (products with variants send the shopper to the
// grid to pick an option).
function ProductRow({ product: p, primary, onAdd, onJump }) {
  const img = p.image || (Array.isArray(p.images) && p.images[0]) || null;
  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
  const soldOut = p.inStock === false;

  const price = (() => {
    if (hasVariants) {
      const prices = p.variants.map((v) => Number(v.price)).filter((n) => !Number.isNaN(n));
      if (prices.length) return `from ${formatINR(Math.min(...prices))}`;
    }
    if (p.price != null) return formatINR(p.price);
    return 'Price on request';
  })();

  return (
    <div onClick={onJump}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
      {img ? (
        <img src={img} alt={p.name} className="w-11 h-11 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
      ) : (
        <span className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">🛍️</span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{p.name}</p>
        <p className="text-xs text-gray-500 truncate">
          {price}{p.category ? ` · ${p.category}` : ''}{soldOut ? ' · Out of stock' : ''}
        </p>
      </div>
      {soldOut ? (
        <span className="flex-shrink-0 text-[11px] font-semibold text-gray-400">—</span>
      ) : hasVariants ? (
        <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg"
              style={{ color: primary, background: `${primary}14` }}>
          Choose <ArrowRight size={12} />
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAdd?.(p, 1); }}
          className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg text-white active:scale-95 transition-transform"
          style={{ backgroundColor: primary }}
        >
          Add
        </button>
      )}
    </div>
  );
}
