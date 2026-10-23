import { useRef, useState } from 'react';
import { ChevronLeft, Camera, Keyboard, Loader2, ScanText, Info } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { EXPENSE_CATEGORIES, CATEGORY_LABEL, dayLabel } from '../../../utils/hisaabMetrics';
import { compressImageFile } from '../../../utils/imageCompress';

/**
 * Payments → Hisaab → Add an expense. Snap the bill (AI reads the total, the
 * date and who was paid, the owner checks it) or type it. Saving is the
 * parent's job; this screen only collects.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const BILL_MAX_DIM = 1600;

const READ_ERROR = {
  plan: 'Reading bills is on paid plans. Type it in below.',
  unreadable: 'Couldn’t read that bill. Try a sharper photo, or type it in below.',
};

export default function AddExpense({
  today, recent = [], packagingCost = 0, themeColor = '#0d9488', saving = false,
  onBack, onSave, onReadBill,
}) {
  const [mode, setMode] = useState('snap');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today);
  const [paidWith, setPaidWith] = useState('cash');
  const [repeats, setRepeats] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState(null);       // { vendor, date } | { error }
  const fileRef = useRef(null);

  const value = Number(String(amount).replace(/[^\d.]/g, ''));
  const ready = value > 0 && category && day && day <= today;

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true); setRead(null);
    try {
      const image = await compressImageFile(file, { maxDim: BILL_MAX_DIM, quality: 0.8 });
      const r = await onReadBill(image);
      if (r.error) { setRead({ error: READ_ERROR[r.error] || 'Couldn’t read the bill right now. Type it in below.' }); return; }
      if (r.amount) setAmount(String(r.amount));
      if (r.category) setCategory(r.category);
      if (r.vendor) setNote(r.vendor);
      if (r.date) setDay(r.date);
      setRead({ vendor: r.vendor, date: r.date, amount: r.amount });
    } catch {
      setRead({ error: 'That file isn’t a photo we can read. Type it in below.' });
    } finally {
      setReading(false);
    }
  }

  const again = (e) => {
    setAmount(String(Number(e.amount))); setCategory(e.category); setNote(e.note || '');
    setPaidWith(e.paid_with === 'bank' ? 'bank' : 'cash'); setRepeats(false); setDay(today);
  };

  const chip = (active) => ['min-h-[40px] px-3.5 rounded-full text-[13px] border transition',
    active ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'bg-white border-gray-200 text-gray-700 font-semibold'].join(' ');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Hisaab"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Add an expense</h2>
      </div>

      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="How">
        {[['snap', 'Snap the bill', Camera], ['type', 'Type it', Keyboard]].map(([k, label, Icon]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
                  className={`min-h-[44px] rounded-lg text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition ${mode === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {mode === 'snap' && (
        <section>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={reading}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-gray-300 bg-white text-left disabled:opacity-70">
            <span className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
              {reading ? <Loader2 size={22} className="animate-spin" /> : read && !read.error ? <ScanText size={22} /> : <Camera size={22} />}
            </span>
            <span className="min-w-0">
              {reading ? (
                <span className="block text-sm font-bold text-gray-900">Reading your bill…</span>
              ) : read && !read.error ? (
                <>
                  <span className="block text-[11px] font-bold uppercase tracking-widest text-emerald-700">Read from your bill</span>
                  <span className="block text-sm font-extrabold text-gray-900 truncate">{read.vendor || (read.amount ? rs(read.amount) : 'Bill')}</span>
                  <span className="block text-xs text-gray-500">{read.date ? `${dayLabel(read.date)} · ` : ''}check it below and save</span>
                </>
              ) : (
                <>
                  <span className="block text-sm font-bold text-gray-900">Take a photo of the bill</span>
                  <span className="block text-xs text-gray-500">The amount, date and shop fill in for you. The photo isn&rsquo;t saved.</span>
                </>
              )}
            </span>
          </button>
          {read?.error && <p className="text-xs font-semibold text-amber-800 mt-2" role="status">{read.error}</p>}
        </section>
      )}

      <label className="block">
        <span className="block text-sm font-bold text-gray-900">Amount</span>
        <span className="mt-2 flex items-center gap-2 rounded-xl border-[1.5px] border-gray-200 bg-white px-3 focus-within:border-gray-900">
          <span className="text-xl font-extrabold text-gray-500">₹</span>
          <input type="text" inputMode="decimal" value={amount} placeholder="0"
                 onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, '').slice(0, 10))}
                 className="w-full min-h-[52px] text-xl font-extrabold text-gray-900 outline-none bg-transparent" />
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-bold text-gray-900">What for</legend>
        <div className="flex flex-wrap gap-2 mt-2">
          {EXPENSE_CATEGORIES.map((c) => (
            <button key={c.key} type="button" aria-pressed={category === c.key} onClick={() => setCategory(c.key)} className={chip(category === c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        {category === 'packing' && Number(packagingCost) > 0 && (
          <p className="text-[11px] text-gray-500 mt-2 flex gap-1.5"><Info size={13} className="flex-shrink-0 mt-px" />
            Hisaab already counts {rs(packagingCost)} packing on every order (your costs in Delivery settings). Add boxes here only if that isn&rsquo;t set.</p>
        )}
        {category === 'transport' && (
          <p className="text-[11px] text-gray-500 mt-2 flex gap-1.5"><Info size={13} className="flex-shrink-0 mt-px" />
            Courier charges for parcels booked in PocketLink are counted for you. Add other transport here.</p>
        )}
      </fieldset>

      <label className="block">
        <span className="block text-sm font-bold text-gray-900">What was it? <span className="font-medium text-gray-400">(optional)</span></span>
        <input type="text" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)}
               placeholder={category ? `e.g. ${category === 'rent' ? 'Shop rent' : category === 'ads' ? 'Instagram ads' : category === 'packing' ? 'Tape and boxes' : CATEGORY_LABEL[category]}` : 'e.g. Tape and boxes'}
               className="mt-2 w-full min-h-[48px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-gray-900" />
      </label>

      <div className="space-y-4">
        <label className="block">
          <span className="block text-sm font-bold text-gray-900">Date</span>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)}
                 className="mt-2 w-full min-h-[48px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-gray-900" />
        </label>
        <fieldset>
          <legend className="text-sm font-bold text-gray-900">Paid with</legend>
          <div className="flex gap-2 mt-2">
            {[['cash', 'Cash'], ['bank', 'UPI / bank']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={paidWith === k} onClick={() => setPaidWith(k)} className={`${chip(paidWith === k)} min-h-[44px] flex-1`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-gray-100 bg-white">
        <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)}
               className="mt-0.5 w-5 h-5 accent-emerald-600 flex-shrink-0" />
        <span>
          <span className="block text-sm font-bold text-gray-900">Repeats every month</span>
          <span className="block text-xs text-gray-500">Like rent or salary. It counts again on the same date each month until you stop it.</span>
        </span>
      </label>

      {recent.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500">Or add again</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {recent.map((e) => (
              <button key={e.id} type="button" onClick={() => again(e)}
                      className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-xs font-bold text-gray-800">
                {e.note || CATEGORY_LABEL[e.category] || 'Expense'} · {rs(e.amount)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" disabled={!ready || saving}
              onClick={() => onSave({ spentOn: day, amount: value, category, note: note.trim(), paidWith, repeats })}
              className="w-full min-h-[52px] rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-50 active:scale-[0.98]"
              style={{ backgroundColor: themeColor }}>
        {saving ? 'Saving…' : value > 0 ? `Save ${rs(value)}` : 'Save'}
      </button>
    </div>
  );
}
