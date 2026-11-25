// "Call me back" on the landing page (/sell): name + mobile (+ business), sent
// to the sales-lead-in edge function, which puts it straight into the sales
// CRM as a hot lead (crm.pocketlink.store). Bots fill the hidden field and are
// quietly ignored; one address can send at most 5 an hour.
import { useState } from 'react';
import { PhoneCall, CheckCircle2 } from 'lucide-react';

const URL_ = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-lead-in?src=web`;

export default function CallBackForm() {
  const [f, setF] = useState({ name: '', phone: '', shop: '', hp: '' });
  const [state, setState] = useState('idle');   // idle | sending | done
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const send = async (e) => {
    e.preventDefault();
    setErr('');
    const digits = f.phone.replace(/\D/g, '');
    if (f.name.trim().length < 2) { setErr('Please enter your name.'); return; }
    if (!/^[6-9][0-9]{9}$/.test(digits.slice(-10)) || digits.length < 10) { setErr('Please enter a 10-digit mobile number.'); return; }
    setState('sending');
    try {
      const r = await fetch(URL_, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), phone: digits.slice(-10), shop: f.shop.trim(), hp: f.hp, page: 'sell' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send. Please try again.');
      setState('done');
    } catch (ex) {
      setErr(ex.message || 'Could not send. Please try again.');
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-6 py-5 text-center" role="status">
        <CheckCircle2 size={28} className="mx-auto text-emerald-600" />
        <p className="font-bold text-gray-900 mt-2">Thank you! We’ll call you soon.</p>
        <p className="text-sm text-gray-500 mt-1">Between 9:30 am and 8 pm. A request at night is called the next morning.</p>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="bg-gray-50 border border-gray-100 rounded-2xl px-5 py-5 text-left">
      <p className="font-bold text-gray-900 flex items-center gap-2"><PhoneCall size={16} className="text-emerald-600" />Want us to call you?</p>
      <p className="text-sm text-gray-500 mt-1">Leave your number. Someone from PocketLink calls you, in English, Marathi or Hindi.</p>
      <div className="grid sm:grid-cols-3 gap-2.5 mt-4">
        <input aria-label="Your name" placeholder="Your name" autoComplete="name" value={f.name} onChange={set('name')}
          className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
        <input aria-label="Mobile number" placeholder="Mobile number" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')}
          className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
        <input aria-label="Business name (optional)" placeholder="Business name (optional)" value={f.shop} onChange={set('shop')}
          className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.hp} onChange={set('hp')}
        className="absolute -left-[9999px] w-px h-px opacity-0" />
      {err && <p className="text-sm text-red-600 mt-2" role="alert">{err}</p>}
      <button type="submit" disabled={state === 'sending'}
        className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-6 h-11 rounded-xl transition-colors disabled:opacity-60">
        {state === 'sending' ? 'Sending…' : 'Call me back'}
      </button>
    </form>
  );
}
