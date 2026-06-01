import { useState, useEffect, useRef } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { openHotelBooking } from '../utils/whatsappEngine';
import PromoBanner from '../components/PromoBanner';

const today    = () => new Date().toISOString().split('T')[0];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };
const INITIAL  = { name: '', phone: '', checkin: today(), checkout: tomorrow(), guests: '1', roomType: '', requests: '' };

export default function HotelTemplate({ onCartCountChange }) {
  const [form,     setForm]     = useState(INITIAL);
  const [selected, setSelected] = useState(null);
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const formRef = useRef(null);

  const config = useBusinessConfig();
  const { products: rooms = [], features = [], businessName, tagline, logoEmoji, theme } = config;
  const primary = theme?.primary ?? '#92400e';

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);
  useEffect(() => {
    document.title = `${businessName} — Book a Room`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function selectRoom(room) {
    setSelected(room.id ?? room.name);
    setForm(f => ({ ...f, roomType: room.name }));
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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
    <div className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: '#fdf8f3' }}>

      <PromoBanner maxWidth="max-w-5xl" />

      {/* ── Romantic hero ── */}
      <div className="relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1c0a00 0%, #3d1a00 40%, #1c0a00 100%)' }}>
        {/* Decorative stars */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
          {['top-4 left-8', 'top-8 right-16', 'top-2 left-1/3', 'top-6 right-1/3', 'top-3 left-2/3'].map((pos, i) => (
            <span key={i} className={`absolute text-amber-300/30 text-xs ${pos}`}>✦</span>
          ))}
        </div>

        <div className="relative max-w-5xl mx-auto px-4 py-12 sm:py-16 text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl border-2 border-amber-400/40"
               style={{ backgroundColor: 'rgba(255,190,50,0.1)' }}>
            {logoEmoji ?? '🏨'}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-amber-50 tracking-wide mb-2"
              style={{ textShadow: '0 2px 20px rgba(255,190,50,0.3)' }}>
            {businessName}
          </h1>
          {tagline && <p className="text-amber-300/70 text-sm max-w-md mx-auto leading-relaxed">{tagline}</p>}

          {features.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {features.map(f => (
                <span key={f.title} className="inline-flex items-center gap-1.5 text-xs font-semibold
                                               px-3 py-1.5 rounded-full text-amber-200/80 border border-amber-400/20"
                      style={{ backgroundColor: 'rgba(255,190,50,0.08)' }}>
                  {f.emoji} {f.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">

        {/* Room cards */}
        {rooms.length > 0 && (
          <div>
            <h2 className="text-xl font-extrabold text-amber-900 mb-2">Our Rooms</h2>
            <p className="text-sm text-amber-700/60 mb-6">Select a room to fill in your booking details.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {rooms.map(room => {
                const isSelected = selected === (room.id ?? room.name);
                return (
                  <button key={room.id ?? room.name} onClick={() => selectRoom(room)}
                    className={[
                      'text-left rounded-3xl overflow-hidden transition-all duration-200 group',
                      isSelected
                        ? 'ring-2 ring-amber-500 shadow-xl shadow-amber-500/20'
                        : 'bg-white border border-amber-100 hover:shadow-lg hover:shadow-amber-100 hover:-translate-y-0.5',
                    ].join(' ')}>

                    {/* Room image */}
                    <div className="w-full h-48 overflow-hidden relative"
                         style={{ backgroundColor: '#f5e6d0' }}>
                      {room.image ? (
                        <img src={room.image} alt={room.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-5xl opacity-30">🛏️</span>
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold shadow-md">✓</div>
                      )}
                    </div>

                    <div className="p-4" style={{ backgroundColor: isSelected ? '#fffbf0' : 'white' }}>
                      <p className="font-bold text-amber-900 text-sm leading-tight mb-1">{room.name}</p>
                      {room.description && (
                        <p className="text-xs text-amber-700/60 leading-relaxed mb-3">{room.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        {room.price > 0 ? (
                          <div>
                            <span className="text-lg font-extrabold text-amber-700">
                              ₹{room.price.toLocaleString('en-IN')}
                            </span>
                            <span className="text-xs text-amber-500/70 ml-1">/ night</span>
                          </div>
                        ) : <div />}
                        <span className={[
                          'text-xs font-bold px-3 py-1 rounded-full transition-all',
                          isSelected ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700',
                        ].join(' ')}>
                          {isSelected ? '✓ Selected' : 'Book →'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Booking form */}
        <div ref={formRef}>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1" style={{ backgroundColor: '#e8d5c0' }} />
            <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">Complete Your Booking</span>
            <div className="h-px flex-1" style={{ backgroundColor: '#e8d5c0' }} />
          </div>

          {sent ? (
            <div className="rounded-3xl p-10 text-center max-w-md mx-auto border border-amber-100"
                 style={{ backgroundColor: '#fffbf0' }}>
              <p className="text-4xl mb-3">🌙</p>
              <p className="font-bold text-amber-900 text-lg">Booking request sent!</p>
              <p className="text-sm text-amber-700/60 mt-1 leading-relaxed">We'll confirm your stay on WhatsApp shortly.</p>
              <button onClick={() => { setSent(false); setForm(INITIAL); setSelected(null); }}
                className="mt-5 text-sm font-semibold text-amber-700 underline underline-offset-2">
                Make another booking
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}
              className="rounded-3xl border p-6 sm:p-8 space-y-5 max-w-lg"
              style={{ backgroundColor: '#fffcf7', borderColor: '#e8d5c0' }}>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Guest Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your name" required
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0', '--tw-ring-color': '#d97706' }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit number" inputMode="numeric" required
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0' }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Check-in *</label>
                  <input type="date" value={form.checkin} min={today()} required
                    onChange={e => setForm(f => ({ ...f, checkin: e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0' }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Check-out *</label>
                  <input type="date" value={form.checkout} min={form.checkin || today()} required
                    onChange={e => setForm(f => ({ ...f, checkout: e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0' }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Guests *</label>
                  <select value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0' }}>
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Room Type</label>
                  <input value={form.roomType} onChange={e => setForm(f => ({ ...f, roomType: e.target.value }))}
                    placeholder="e.g. Deluxe"
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all bg-white"
                    style={{ borderColor: '#e8d5c0' }} />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-amber-800 mb-1.5 block">Special Requests <span className="font-normal text-amber-400">(optional)</span></label>
                <textarea value={form.requests} onChange={e => setForm(f => ({ ...f, requests: e.target.value }))}
                  placeholder="Early check-in, anniversary setup, dietary preferences…" rows={2}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all resize-none bg-white"
                  style={{ borderColor: '#e8d5c0' }} />
              </div>

              <button type="submit" disabled={!isValid || sending}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #92400e, #b45309)' }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Send Booking Request on WhatsApp
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
