import { useState, useEffect, useRef } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { openHotelBooking } from '../utils/whatsappEngine';
import PromoBanner from '../components/PromoBanner';

const today    = () => new Date().toISOString().split('T')[0];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };
const INITIAL  = { name: '', phone: '', checkin: today(), checkout: tomorrow(), guests: '1', roomType: '', requests: '' };

// Luxury serif — loaded on mount, Georgia fallback keeps it elegant before it arrives.
const serif = { fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif" };
const GOLD  = '#c39a3e';

const fmtDate = (s) => {
  const d = new Date(s);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// ── Tiny inline icons (stroke = currentColor) ──────────────────────────────────
const Cal   = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>);
const Users = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const Pin   = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);
const Moon  = (p) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>);
const Bed   = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 9v11M2 13h20v7M22 13v-2a4 4 0 0 0-4-4H8M2 9a2 2 0 0 1 2-2h2"/><circle cx="6" cy="11" r="0.5"/></svg>);
const Wa    = (p) => (<svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" {...p}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>);

// Shared input styling (warm, understated)
const fieldCls = 'w-full border rounded-xl px-3 py-2.5 text-sm text-amber-950 focus:outline-none focus:ring-2 focus:border-transparent transition-all bg-white/90';
const fieldStyle = { borderColor: '#e7d8c4', '--tw-ring-color': GOLD };

export default function HotelTemplate({ onCartCountChange }) {
  const [form,     setForm]     = useState(INITIAL);
  const [selected, setSelected] = useState(null);
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const formRef  = useRef(null);
  const roomsRef = useRef(null);

  const config = useBusinessConfig();
  const { products: rooms = [], features = [], businessName, tagline, logo, logoEmoji, coverImage, address } = config;

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);

  useEffect(() => {
    document.title = `${businessName} — Book a Room`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  // Load the display serif once (scoped to hotel pages).
  useEffect(() => {
    const id = 'pl-playfair-font';
    if (!document.getElementById(id)) {
      const l = document.createElement('link');
      l.id = id; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
  }, []);

  // ── Derived booking info ────────────────────────────────────────────────────
  const nights = (() => {
    const d = Math.round((new Date(form.checkout) - new Date(form.checkin)) / 86400000);
    return d > 0 ? d : 1;
  })();
  const selectedRoom = rooms.find(r => (r.id ?? r.name) === selected) || null;
  const fromPrice    = rooms.filter(r => r.price > 0).reduce((m, r) => Math.min(m, r.price), Infinity);
  const startingRate = fromPrice !== Infinity ? fromPrice : 0;
  const estimate     = selectedRoom && selectedRoom.price > 0 ? selectedRoom.price * nights : 0;

  function selectRoom(room) {
    setSelected(room.id ?? room.name);
    setForm(f => ({ ...f, roomType: room.name }));
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function checkAvailability() {
    (roomsRef.current || formRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    openHotelBooking(form, config);
    setSent(true);
    setSending(false);
  }

  const isValid = form.name && form.phone.length === 10 && form.checkin && form.checkout && form.guests;

  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: '#f6efe4' }}>

      <PromoBanner maxWidth="max-w-6xl" />

      {/* ══ Cinematic hero ══════════════════════════════════════════════════════ */}
      <section className="relative isolate flex flex-col justify-end overflow-hidden
                          min-h-[82vh] sm:min-h-[88vh]">
        {/* Cover image / fallback gradient */}
        <div className="absolute inset-0 -z-20 bg-center bg-cover"
             style={coverImage
               ? { backgroundImage: `url(${coverImage})` }
               : { background: 'linear-gradient(135deg, #20100a 0%, #432414 45%, #20100a 100%)' }} />
        {/* Legibility overlay */}
        <div className="absolute inset-0 -z-10"
             style={{ background: 'linear-gradient(to top, rgba(18,11,6,0.94) 4%, rgba(18,11,6,0.35) 42%, rgba(18,11,6,0.72) 100%)' }} />
        {/* Faint gold star dust */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none select-none">
          {['top-10 left-[8%]','top-16 right-[14%]','top-7 left-1/3','top-24 right-1/3','top-12 left-2/3','top-28 left-[18%]'].map((pos, i) => (
            <span key={i} className={`absolute text-amber-200/25 text-xs ${pos}`}>✦</span>
          ))}
        </div>

        <div className="relative max-w-5xl mx-auto w-full px-5 pt-24 pb-28 sm:pb-32 text-center">
          {/* Brand mark */}
          <div className="mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center overflow-hidden
                          border border-amber-200/40 backdrop-blur-sm"
               style={{ backgroundColor: 'rgba(255,210,120,0.10)', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}>
            {logo
              ? <img src={logo} alt={businessName} className="w-full h-full object-cover" />
              : <span className="text-3xl">{logoEmoji ?? '🏨'}</span>}
          </div>

          {/* Star row */}
          <div className="flex items-center justify-center gap-1.5 mb-3 text-amber-300/90 text-sm tracking-[0.3em]">
            ★★★★★
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold text-amber-50 leading-tight tracking-tight"
              style={{ ...serif, textShadow: '0 2px 30px rgba(0,0,0,0.4)' }}>
            {businessName}
          </h1>

          {/* Gold divider */}
          <div className="flex items-center justify-center gap-3 my-5">
            <span className="h-px w-10 sm:w-16" style={{ backgroundColor: GOLD, opacity: 0.7 }} />
            <span className="text-amber-300/80 text-xs">✦</span>
            <span className="h-px w-10 sm:w-16" style={{ backgroundColor: GOLD, opacity: 0.7 }} />
          </div>

          <p className="text-amber-100/80 text-sm sm:text-base max-w-xl mx-auto leading-relaxed font-light">
            {tagline || 'A restful escape, thoughtfully designed for an unforgettable stay.'}
          </p>

          {address && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-amber-200/70 text-xs">
              <Pin width="13" height="13" /> {address}
            </p>
          )}
        </div>
      </section>

      {/* ══ Floating booking bar (overlaps hero) ════════════════════════════════ */}
      <div className="relative z-20 max-w-5xl mx-auto px-4 -mt-16 sm:-mt-14">
        <div className="rounded-3xl bg-white shadow-2xl shadow-black/15 border border-amber-100/70
                        p-3 sm:p-4 grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          <BookingField label="Check-in" icon={<Cal width="14" height="14" />}>
            <input type="date" value={form.checkin} min={today()}
              onChange={e => setForm(f => ({ ...f, checkin: e.target.value, checkout: e.target.value >= f.checkout ? tomorrow() : f.checkout }))}
              className="w-full bg-transparent text-sm font-semibold text-amber-950 focus:outline-none" />
          </BookingField>
          <BookingField label="Check-out" icon={<Cal width="14" height="14" />}>
            <input type="date" value={form.checkout} min={form.checkin || today()}
              onChange={e => setForm(f => ({ ...f, checkout: e.target.value }))}
              className="w-full bg-transparent text-sm font-semibold text-amber-950 focus:outline-none" />
          </BookingField>
          <BookingField label="Guests" icon={<Users width="14" height="14" />}>
            <select value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
              className="w-full bg-transparent text-sm font-semibold text-amber-950 focus:outline-none cursor-pointer">
              {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>)}
            </select>
          </BookingField>
          <button onClick={checkAvailability}
            className="col-span-2 md:col-span-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl
                       text-sm font-bold text-white transition-all hover:opacity-95 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2a1810, #6b3f1d)' }}>
            <Moon width="14" height="14" /> Check Availability
          </button>
        </div>
        {startingRate > 0 && (
          <p className="text-center text-xs text-amber-700/70 mt-3">
            Rooms from <span className="font-bold text-amber-800">₹{startingRate.toLocaleString('en-IN')}</span> / night · {nights} {nights === 1 ? 'night' : 'nights'} selected
          </p>
        )}
      </div>

      {/* ══ Amenities ════════════════════════════════════════════════════════════ */}
      {features.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 pt-16 pb-2">
          <SectionLabel kicker="Comforts" title="Everything for a perfect stay" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            {features.slice(0, 8).map(f => (
              <div key={f.title}
                className="rounded-2xl bg-white border border-amber-100 p-5 text-center
                           hover:shadow-lg hover:shadow-amber-100/60 transition-all">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-xl"
                     style={{ backgroundColor: 'rgba(195,154,62,0.12)' }}>
                  {f.emoji}
                </div>
                <p className="font-bold text-amber-900 text-sm" style={serif}>{f.title}</p>
                {f.desc && <p className="text-xs text-amber-700/60 mt-1 leading-relaxed">{f.desc}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══ Rooms & Suites ═══════════════════════════════════════════════════════ */}
      {rooms.length > 0 && (
        <section ref={roomsRef} className="max-w-5xl mx-auto px-4 pt-16 scroll-mt-4">
          <SectionLabel kicker="Stay" title="Rooms & Suites" />
          <p className="text-center text-sm text-amber-700/60 mt-3 mb-9">Choose your space — we’ll hold it while you confirm on WhatsApp.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {rooms.map(room => {
              const isSelected = selected === (room.id ?? room.name);
              return (
                <div key={room.id ?? room.name}
                  className={[
                    'group rounded-3xl overflow-hidden bg-white transition-all duration-200 flex flex-col',
                    isSelected
                      ? 'ring-2 shadow-2xl shadow-amber-500/15'
                      : 'border border-amber-100 hover:shadow-xl hover:shadow-amber-100/70 hover:-translate-y-0.5',
                  ].join(' ')}
                  style={isSelected ? { '--tw-ring-color': GOLD } : undefined}>

                  {/* Image */}
                  <div className="relative w-full h-56 overflow-hidden" style={{ backgroundColor: '#efe1cd' }}>
                    {room.image ? (
                      <img src={room.image} alt={room.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-amber-300">
                        <Bed width="56" height="56" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-60" />
                    {room.price > 0 && (
                      <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full text-xs font-bold text-white backdrop-blur-sm"
                           style={{ backgroundColor: 'rgba(42,24,16,0.7)' }}>
                        From <span style={{ color: '#f0c66b' }}>₹{room.price.toLocaleString('en-IN')}</span> / night
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md"
                           style={{ backgroundColor: GOLD }}>✓</div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-5 flex flex-col flex-1">
                    <h3 className="text-lg font-bold text-amber-900 leading-snug" style={serif}>{room.name}</h3>
                    {room.description && (
                      <p className="text-sm text-amber-700/65 leading-relaxed mt-1.5 line-clamp-2">{room.description}</p>
                    )}
                    <div className="h-px my-4" style={{ backgroundColor: '#ecdcc6' }} />
                    <button onClick={() => selectRoom(room)}
                      className={[
                        'mt-auto w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98]',
                        isSelected ? 'text-white' : 'text-amber-900 hover:text-white',
                      ].join(' ')}
                      style={isSelected
                        ? { background: 'linear-gradient(135deg, #2a1810, #6b3f1d)' }
                        : { backgroundColor: 'rgba(195,154,62,0.14)' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'linear-gradient(135deg, #2a1810, #6b3f1d)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(195,154,62,0.14)'; }}>
                      {isSelected ? '✓ Selected — scroll to book' : 'Reserve this room'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══ Experience band ══════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden mt-16">
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(135deg, #20100a, #4a2a16 50%, #20100a)' }} />
        <div className="absolute inset-0 opacity-20"
             style={coverImage ? { backgroundImage: `url(${coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
        <div className="absolute inset-0" style={{ background: 'rgba(18,11,6,0.6)' }} />
        <div className="relative max-w-3xl mx-auto px-5 py-16 text-center">
          <span className="text-amber-300/80 text-xs">✦</span>
          <p className="mt-4 text-2xl sm:text-3xl text-amber-50 leading-snug font-light" style={serif}>
            “Your room is ready. The only thing left to pack is anticipation.”
          </p>
          <button onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="mt-8 inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-sm font-bold
                       text-amber-950 transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #e9c876, #c39a3e)' }}>
            Reserve Your Stay
          </button>
        </div>
      </section>

      {/* ══ Reservation ══════════════════════════════════════════════════════════ */}
      <section ref={formRef} className="max-w-5xl mx-auto px-4 py-16 scroll-mt-4">
        <SectionLabel kicker="Reservation" title="Request your booking" />

        {sent ? (
          <div className="rounded-3xl p-10 text-center max-w-md mx-auto bg-white border border-amber-100 mt-8 shadow-lg shadow-amber-100/50">
            <p className="text-4xl mb-3">🌙</p>
            <p className="font-bold text-amber-900 text-xl" style={serif}>Booking request sent!</p>
            <p className="text-sm text-amber-700/60 mt-2 leading-relaxed">We’ll confirm your stay and final tariff on WhatsApp shortly.</p>
            <button onClick={() => { setSent(false); setForm(INITIAL); setSelected(null); }}
              className="mt-6 text-sm font-semibold text-amber-700 underline underline-offset-4">
              Make another booking
            </button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_20rem] gap-6 mt-8 items-start">

            {/* Form */}
            <form onSubmit={handleSubmit}
              className="rounded-3xl border bg-white p-6 sm:p-8 space-y-5"
              style={{ borderColor: '#ecdcc6' }}>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Guest Name *">
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your name" required className={fieldCls} style={fieldStyle} />
                </Field>
                <Field label="Phone *">
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit number" inputMode="numeric" required className={fieldCls} style={fieldStyle} />
                </Field>
                <Field label="Check-in *">
                  <input type="date" value={form.checkin} min={today()} required
                    onChange={e => setForm(f => ({ ...f, checkin: e.target.value }))}
                    className={fieldCls} style={fieldStyle} />
                </Field>
                <Field label="Check-out *">
                  <input type="date" value={form.checkout} min={form.checkin || today()} required
                    onChange={e => setForm(f => ({ ...f, checkout: e.target.value }))}
                    className={fieldCls} style={fieldStyle} />
                </Field>
                <Field label="Guests *">
                  <select value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
                    className={fieldCls} style={fieldStyle}>
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>)}
                  </select>
                </Field>
                <Field label="Room Type">
                  <input value={form.roomType} onChange={e => setForm(f => ({ ...f, roomType: e.target.value }))}
                    placeholder="e.g. Deluxe" className={fieldCls} style={fieldStyle} />
                </Field>
              </div>

              <Field label={<>Special Requests <span className="font-normal text-amber-400">(optional)</span></>}>
                <textarea value={form.requests} onChange={e => setForm(f => ({ ...f, requests: e.target.value }))}
                  placeholder="Early check-in, anniversary setup, dietary preferences…" rows={2}
                  className={`${fieldCls} resize-none`} style={fieldStyle} />
              </Field>

              <button type="submit" disabled={!isValid || sending}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#25D366' }}>
                <Wa /> Request to Book on WhatsApp
              </button>
              <p className="text-[11px] text-amber-700/50 text-center">No payment now — availability & tariff confirmed on WhatsApp.</p>
            </form>

            {/* Live summary */}
            <aside className="rounded-3xl p-6 text-amber-50 lg:sticky lg:top-4"
                   style={{ background: 'linear-gradient(160deg, #2a1810, #4a2a16)' }}>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300/70 mb-4">Your stay</p>
              <SummaryRow icon={<Bed width="15" height="15" />} label="Room"
                value={selectedRoom ? selectedRoom.name : (form.roomType || 'Any available')} />
              <SummaryRow icon={<Cal width="15" height="15" />} label="Check-in"  value={fmtDate(form.checkin)} />
              <SummaryRow icon={<Cal width="15" height="15" />} label="Check-out" value={fmtDate(form.checkout)} />
              <SummaryRow icon={<Moon width="15" height="15" />} label="Nights"   value={`${nights}`} />
              <SummaryRow icon={<Users width="15" height="15" />} label="Guests"  value={form.guests} />

              <div className="h-px my-4" style={{ backgroundColor: 'rgba(195,154,62,0.3)' }} />
              {estimate > 0 ? (
                <div className="flex items-end justify-between">
                  <span className="text-xs text-amber-200/70">Estimated total</span>
                  <span className="text-2xl font-bold" style={{ ...serif, color: '#f0c66b' }}>
                    ₹{estimate.toLocaleString('en-IN')}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-amber-200/70 leading-relaxed">
                  Select a room to see an estimate. Final tariff is confirmed on WhatsApp.
                </p>
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────────
function BookingField({ label, icon, children }) {
  return (
    <div className="rounded-2xl border px-3.5 py-2" style={{ borderColor: '#eaddc9', backgroundColor: '#fffdf9' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700/60 mb-0.5">
        <span style={{ color: GOLD }}>{icon}</span> {label}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-amber-800 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ kicker, title }) {
  return (
    <div className="text-center">
      <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>{kicker}</p>
      <h2 className="text-2xl sm:text-3xl font-bold text-amber-900 mt-2" style={serif}>{title}</h2>
    </div>
  );
}

function SummaryRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="inline-flex items-center gap-2 text-xs text-amber-200/70">
        <span style={{ color: '#e9c876' }}>{icon}</span> {label}
      </span>
      <span className="text-sm font-semibold text-amber-50 text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
