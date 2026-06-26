import { useState } from 'react';
import {
  Plus, X, Pencil, Trash2, Percent, Ticket, Megaphone, Copy, Check,
  Sparkles, CheckCircle2, Lock,
} from 'lucide-react';
import { effectivePlan, hasFeature } from '../../utils/planLimits';
import {
  isOfferLive, isCouponLive, describeDiscount, describeSchedule, describeCoupon,
} from '../../utils/offers';

// ── Shared field styles (kept local so this tab is self-contained) ───────────
const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition';
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1.5';

const EMPTY_SALE = {
  name: '', discountType: 'percent', discountValue: '',
  appliesTo: 'all', categoryId: '',
  schedule: { type: 'always', start: '', end: '', from: '', to: '' },
  active: true,
};
const EMPTY_COUPON = {
  code: '', discountType: 'percent', discountValue: '',
  minOrder: '', expiresAt: '', active: true,
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── Save bar (mirrors the one used by the other manage tabs) ─────────────────
function SaveBar({ status, error, onSave, dirty, themeColor }) {
  if (!dirty && status !== 'saved') return null;
  return (
    <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-4">
      {status === 'saved' && (
        <div className="flex items-center gap-1.5 text-green-600 text-sm font-semibold">
          <CheckCircle2 size={15} /> Saved successfully!
        </div>
      )}
      {error && <p className="text-sm text-red-500 flex-1">{error}</p>}
      {dirty && status !== 'saved' && (
        <button onClick={onSave} disabled={status === 'saving'}
                className="ml-auto px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
                style={{ backgroundColor: themeColor }}>
          {status === 'saving'
            ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
            : '💾 Save Changes'}
        </button>
      )}
    </div>
  );
}

function Toggle({ on, onClick, themeColor }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: on ? themeColor : '#d1d5db' }}>
      <span className={['absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5'].join(' ')} />
    </button>
  );
}

export default function OffersTab({ config, onChange, onSave, saveStatus, saveError }) {
  const themeColor = config.theme?.primary || '#0d9488';
  const isPremium  = hasFeature(effectivePlan(config), 'offersEngine');
  const cats       = (config.categories || []).filter((c) => c.id !== 'all');
  const offers     = config.offers  || [];
  const coupons    = config.coupons || [];

  const [dirty, setDirty] = useState(false);

  // Sale + coupon edit state
  const [saleForm,     setSaleForm]     = useState(null);   // null | EMPTY_SALE-shaped
  const [saleEditId,   setSaleEditId]   = useState(null);   // null | id | 'new'
  const [couponForm,   setCouponForm]   = useState(null);
  const [couponEditId, setCouponEditId] = useState(null);
  const [copiedCode,   setCopiedCode]   = useState('');

  function update(partial) { onChange(partial); setDirty(true); }
  function handleSave()     { setDirty(false); onSave(); }

  // ── Promo banner preview parts ─────────────────────────────────────────────
  const promo = config.promoText || '';
  const promoEmoji   = promo.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u)?.[0] ?? null;
  const promoNoEmoji = promo.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '').trim();
  const promoParts   = promoNoEmoji.split(/\s*[·•\-–]\s*/);

  // ── Sales CRUD ──────────────────────────────────────────────────────────────
  function openAddSale()  { setSaleForm({ ...EMPTY_SALE }); setSaleEditId('new'); }
  function openEditSale(o) {
    setSaleForm({ ...EMPTY_SALE, ...o, schedule: { ...EMPTY_SALE.schedule, ...(o.schedule || {}) } });
    setSaleEditId(o.id);
  }
  function cancelSale() { setSaleForm(null); setSaleEditId(null); }
  function saveSale() {
    if (!saleForm.name.trim() || !(Number(saleForm.discountValue) > 0)) return;
    const clean = {
      id: saleEditId === 'new' ? newId() : saleEditId,
      name: saleForm.name.trim(),
      discountType: saleForm.discountType,
      discountValue: Number(saleForm.discountValue),
      appliesTo: saleForm.appliesTo,
      categoryId: saleForm.appliesTo === 'category' ? saleForm.categoryId : '',
      schedule: saleForm.schedule,
      active: saleForm.active !== false,
    };
    const next = saleEditId === 'new' ? [...offers, clean] : offers.map((o) => (o.id === saleEditId ? clean : o));
    update({ offers: next });
    cancelSale();
  }
  function deleteSale(id)  { update({ offers: offers.filter((o) => o.id !== id) }); if (saleEditId === id) cancelSale(); }
  function toggleSale(id)  { update({ offers: offers.map((o) => (o.id === id ? { ...o, active: o.active === false } : o)) }); }

  // ── Coupons CRUD ──────────────────────────────────────────────────────────
  function openAddCoupon()  { setCouponForm({ ...EMPTY_COUPON }); setCouponEditId('new'); }
  function openEditCoupon(c) { setCouponForm({ ...EMPTY_COUPON, ...c }); setCouponEditId(c.id); }
  function cancelCoupon()   { setCouponForm(null); setCouponEditId(null); }
  function saveCoupon() {
    const code = couponForm.code.trim().toUpperCase().replace(/\s+/g, '');
    if (!code || !(Number(couponForm.discountValue) > 0)) return;
    const clean = {
      id: couponEditId === 'new' ? newId() : couponEditId,
      code,
      discountType: couponForm.discountType,
      discountValue: Number(couponForm.discountValue),
      minOrder: couponForm.minOrder === '' ? '' : Number(couponForm.minOrder),
      expiresAt: couponForm.expiresAt || '',
      active: couponForm.active !== false,
    };
    const next = couponEditId === 'new' ? [...coupons, clean] : coupons.map((c) => (c.id === couponEditId ? clean : c));
    update({ coupons: next });
    cancelCoupon();
  }
  function deleteCoupon(id) { update({ coupons: coupons.filter((c) => c.id !== id) }); if (couponEditId === id) cancelCoupon(); }
  function toggleCoupon(id) { update({ coupons: coupons.map((c) => (c.id === id ? { ...c, active: c.active === false } : c)) }); }
  function copyCode(code)   { navigator.clipboard?.writeText(code).then(() => { setCopiedCode(code); setTimeout(() => setCopiedCode(''), 1500); }); }

  return (
    <div className="space-y-7">

      {/* ════════════ Announcement banner (all plans) ════════════ */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Megaphone size={16} style={{ color: themeColor }} />
          <h3 className="text-base font-extrabold text-gray-900">Announcement banner</h3>
        </div>
        <label className={labelCls}>Promo message <span className="text-gray-400 font-normal ml-1">(optional)</span></label>
        <input type="text" maxLength={100}
          placeholder="e.g. 🎉 Free delivery this week! · 10% off above ₹500"
          value={promo}
          onChange={(e) => update({ promoText: e.target.value })}
          className={inputCls} />
        <p className="mt-1 text-xs text-gray-400">
          Start with an emoji 🚚 then your heading · optional subtitle. Use <strong className="text-gray-500">·</strong> to separate them.
        </p>
        {promo && (
          <div className="mt-3 rounded-2xl overflow-hidden relative" style={{ backgroundColor: `${themeColor}18` }}>
            <div className="absolute inset-0 opacity-20 pointer-events-none"
                 style={{ backgroundImage: `radial-gradient(circle, ${themeColor}40 1px, transparent 1px)`, backgroundSize: '18px 18px' }} />
            <div className="relative flex items-stretch min-h-[80px]">
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 px-4 py-3">
                <p className="font-extrabold text-sm text-gray-900 leading-tight">{promoParts[0] ?? ''}</p>
                {promoParts[1] && <p className="text-xs text-gray-500">{promoParts[1]}</p>}
                <span className="mt-1 self-start text-[10px] font-bold text-white px-2.5 py-1 rounded-lg" style={{ backgroundColor: themeColor }}>
                  Order Now →
                </span>
              </div>
              <div className="flex-shrink-0 w-20 flex items-end justify-center pb-1 pr-1 pt-2 relative">
                <div className="absolute bottom-1 right-0 w-16 h-16 rounded-full" style={{ backgroundColor: `${themeColor}20` }} />
                <span className="relative text-4xl leading-none select-none">{promoEmoji ?? '🎉'}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="h-px bg-gray-100" />

      {/* ════════════ Premium gate for the engine ════════════ */}
      {!isPremium ? (
        <PremiumTeaser themeColor={themeColor} whatsappNumber={config.whatsappNumber} />
      ) : (
        <>
          {/* ════════════ Scheduled sales ════════════ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Percent size={16} style={{ color: themeColor }} />
                <h3 className="text-base font-extrabold text-gray-900">Scheduled sales</h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{offers.length}</span>
              </div>
              {saleEditId === null && (
                <button type="button" onClick={openAddSale}
                  className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl text-white shadow-sm hover:opacity-90 active:scale-95 transition-all"
                  style={{ backgroundColor: themeColor }}>
                  <Plus size={15} strokeWidth={2.5} /> Add
                </button>
              )}
            </div>

            {offers.length === 0 && saleEditId === null && (
              <EmptyHint icon={<Percent size={20} />} title="No sales yet"
                text="Schedule a flash, weekend or happy-hours sale — it turns on and off by itself." />
            )}

            <div className="space-y-2">
              {offers.map((o) => {
                const live = isOfferLive(o);
                return (
                  <div key={o.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{o.name}</p>
                        {o.active !== false && live && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {describeDiscount(o)} · {o.appliesTo === 'category' ? (cats.find((c) => c.id === o.categoryId)?.label || 'A category') : 'All products'} · {describeSchedule(o)}
                      </p>
                    </div>
                    <Toggle on={o.active !== false} onClick={() => toggleSale(o.id)} themeColor={themeColor} />
                    <button type="button" onClick={() => openEditSale(o)} className="p-1.5 rounded-lg text-gray-300 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"><Pencil size={13} /></button>
                    <button type="button" onClick={() => deleteSale(o.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex-shrink-0"><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>

            {saleEditId !== null && saleForm && (
              <SaleForm form={saleForm} setForm={setSaleForm} cats={cats} themeColor={themeColor}
                isNew={saleEditId === 'new'} onSave={saveSale} onCancel={cancelSale} />
            )}
          </section>

          <div className="h-px bg-gray-100" />

          {/* ════════════ Coupon codes ════════════ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Ticket size={16} style={{ color: themeColor }} />
                <h3 className="text-base font-extrabold text-gray-900">Coupon codes</h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{coupons.length}</span>
              </div>
              {couponEditId === null && (
                <button type="button" onClick={openAddCoupon}
                  className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl text-white shadow-sm hover:opacity-90 active:scale-95 transition-all"
                  style={{ backgroundColor: themeColor }}>
                  <Plus size={15} strokeWidth={2.5} /> Add
                </button>
              )}
            </div>

            {coupons.length === 0 && couponEditId === null && (
              <EmptyHint icon={<Ticket size={20} />} title="No coupons yet"
                text="Create codes like FIRST10 that customers enter at checkout for a discount." />
            )}

            <div className="space-y-2">
              {coupons.map((c) => {
                const live = isCouponLive(c);
                return (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-gray-900 tracking-wide">{c.code}</span>
                        <button type="button" onClick={() => copyCode(c.code)} className="text-gray-300 hover:text-gray-600 flex-shrink-0">
                          {copiedCode === c.code ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        </button>
                        {c.active !== false && live && (
                          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Active</span>
                        )}
                        {c.expiresAt && !live && (
                          <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Expired</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{describeCoupon(c)}</p>
                    </div>
                    <Toggle on={c.active !== false} onClick={() => toggleCoupon(c.id)} themeColor={themeColor} />
                    <button type="button" onClick={() => openEditCoupon(c)} className="p-1.5 rounded-lg text-gray-300 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"><Pencil size={13} /></button>
                    <button type="button" onClick={() => deleteCoupon(c.id)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex-shrink-0"><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>

            {couponEditId !== null && couponForm && (
              <CouponForm form={couponForm} setForm={setCouponForm} themeColor={themeColor}
                isNew={couponEditId === 'new'} onSave={saveCoupon} onCancel={cancelCoupon} />
            )}
          </section>
        </>
      )}

      <SaveBar status={saveStatus} error={saveError} onSave={handleSave} dirty={dirty} themeColor={themeColor} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function EmptyHint({ icon, title, text }) {
  return (
    <div className="text-center py-8 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
      <div className="w-11 h-11 mx-auto mb-2.5 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-300 shadow-sm">{icon}</div>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">{text}</p>
    </div>
  );
}

function PremiumTeaser({ themeColor, whatsappNumber }) {
  return (
    <div className="rounded-2xl border-2 border-dashed p-6 text-center" style={{ borderColor: `${themeColor}44`, background: `${themeColor}08` }}>
      <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: themeColor }}>
        <Sparkles size={22} />
      </div>
      <h3 className="text-base font-extrabold text-gray-900">Unlock the Offers Engine</h3>
      <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
        Run automatic <strong className="text-gray-700">flash, weekend &amp; happy-hours sales</strong> and create <strong className="text-gray-700">coupon codes</strong> — they switch on and off by themselves. A Premium feature.
      </p>
      <a href="/plans"
        onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(whatsappNumber || '').replace(/\D/g, ''))}
        className="inline-flex items-center gap-1.5 mt-4 text-sm font-bold text-white px-5 py-2.5 rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all"
        style={{ backgroundColor: themeColor }}>
        <Lock size={14} /> Upgrade to Premium →
      </a>
    </div>
  );
}

function FormShell({ title, isNew, onSave, onCancel, themeColor, children, canSave = true }) {
  return (
    <div className="mt-3 rounded-2xl border p-4 space-y-3.5" style={{ borderColor: `${themeColor}40`, background: `${themeColor}06` }}>
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{isNew ? title.new : title.edit}</p>
      {children}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
        <button type="button" onClick={onSave} disabled={!canSave}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 active:scale-[0.99] disabled:opacity-40 transition-all"
          style={{ backgroundColor: themeColor }}>
          {isNew ? 'Add' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange, themeColor }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={['rounded-xl border px-2 py-2 text-xs font-semibold transition-all active:scale-95', active ? 'text-white border-transparent shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'].join(' ')}
            style={active ? { backgroundColor: themeColor } : undefined}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SaleForm({ form, setForm, cats, themeColor, isNew, onSave, onCancel }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setSch = (patch) => setForm((f) => ({ ...f, schedule: { ...f.schedule, ...patch } }));
  const canSave = form.name.trim() && Number(form.discountValue) > 0 && (form.appliesTo !== 'category' || form.categoryId);

  return (
    <FormShell title={{ new: 'New sale', edit: 'Edit sale' }} isNew={isNew} onSave={onSave} onCancel={onCancel} themeColor={themeColor} canSave={canSave}>
      <div>
        <label className={labelCls}>Sale name</label>
        <input type="text" autoFocus placeholder="e.g. Weekend Flash Sale" value={form.name}
          onChange={(e) => set({ name: e.target.value })} className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Discount</label>
          <Segmented themeColor={themeColor} value={form.discountType}
            onChange={(v) => set({ discountType: v })}
            options={[{ value: 'percent', label: '% off' }, { value: 'flat', label: '₹ off' }]} />
        </div>
        <div>
          <label className={labelCls}>{form.discountType === 'flat' ? 'Amount (₹)' : 'Percent (%)'}</label>
          <input type="number" inputMode="numeric" min="1" placeholder={form.discountType === 'flat' ? '100' : '20'}
            value={form.discountValue} onChange={(e) => set({ discountValue: e.target.value })} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Applies to</label>
        <Segmented themeColor={themeColor} value={form.appliesTo}
          onChange={(v) => set({ appliesTo: v })}
          options={[{ value: 'all', label: 'All products' }, { value: 'category', label: 'A category' }]} />
        {form.appliesTo === 'category' && (
          <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className={`${inputCls} mt-2`}>
            <option value="">Select category…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
        )}
      </div>

      <div>
        <label className={labelCls}>When</label>
        <Segmented themeColor={themeColor} value={form.schedule.type}
          onChange={(v) => setSch({ type: v })}
          options={[
            { value: 'always',     label: 'Always' },
            { value: 'range',      label: 'Dates' },
            { value: 'weekend',    label: 'Weekend' },
            { value: 'happyHours', label: 'Hours' },
          ]} />

        {form.schedule.type === 'range' && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">Start</label>
              <input type="date" value={form.schedule.start} onChange={(e) => setSch({ start: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">End</label>
              <input type="date" value={form.schedule.end} onChange={(e) => setSch({ end: e.target.value })} className={inputCls} />
            </div>
          </div>
        )}
        {form.schedule.type === 'happyHours' && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">From</label>
              <input type="time" value={form.schedule.from} onChange={(e) => setSch({ from: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">To</label>
              <input type="time" value={form.schedule.to} onChange={(e) => setSch({ to: e.target.value })} className={inputCls} />
            </div>
          </div>
        )}
        {form.schedule.type === 'weekend' && (
          <p className="text-[11px] text-gray-400 mt-2">Runs automatically every Saturday &amp; Sunday.</p>
        )}
        {form.schedule.type === 'always' && (
          <p className="text-[11px] text-gray-400 mt-2">Runs whenever the sale is switched on.</p>
        )}
      </div>
    </FormShell>
  );
}

function CouponForm({ form, setForm, themeColor, isNew, onSave, onCancel }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const canSave = form.code.trim() && Number(form.discountValue) > 0;

  return (
    <FormShell title={{ new: 'New coupon', edit: 'Edit coupon' }} isNew={isNew} onSave={onSave} onCancel={onCancel} themeColor={themeColor} canSave={canSave}>
      <div>
        <label className={labelCls}>Code</label>
        <input type="text" autoFocus placeholder="e.g. FIRST10" value={form.code}
          onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
          className={`${inputCls} font-mono tracking-wide uppercase`} maxLength={20} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Discount</label>
          <Segmented themeColor={themeColor} value={form.discountType}
            onChange={(v) => set({ discountType: v })}
            options={[{ value: 'percent', label: '% off' }, { value: 'flat', label: '₹ off' }]} />
        </div>
        <div>
          <label className={labelCls}>{form.discountType === 'flat' ? 'Amount (₹)' : 'Percent (%)'}</label>
          <input type="number" inputMode="numeric" min="1" placeholder={form.discountType === 'flat' ? '100' : '10'}
            value={form.discountValue} onChange={(e) => set({ discountValue: e.target.value })} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Min order <span className="text-gray-400 font-normal">· optional</span></label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
            <input type="number" inputMode="numeric" min="0" placeholder="999" value={form.minOrder}
              onChange={(e) => set({ minOrder: e.target.value })} className={`${inputCls} pl-7`} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Expires <span className="text-gray-400 font-normal">· optional</span></label>
          <input type="date" value={form.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} className={inputCls} />
        </div>
      </div>
    </FormShell>
  );
}
