import { useState, useEffect } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { openHotelBooking } from '../utils/whatsappEngine';

const today     = () => new Date().toISOString().split('T')[0];
const tomorrow  = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };
const INITIAL   = { name: '', phone: '', checkin: today(), checkout: tomorrow(), guests: '1', roomType: '', requests: '' };

export default function HotelTemplate({ onCartCountChange }) {
  const [form,      setForm]      = useState(INITIAL);
  const [selected,  setSelected]  = useState(null);
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);

  const config = useBusinessConfig();
  const { products: rooms = [], features = [], businessName, tagline, theme } = config;

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);
  useEffect(() => {
    document.title = `${businessName} — Book a Room`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function selectRoom(room) {
    setSelected(room.id ?? room.name);
    setForm(f => ({ ...f, roomType: room.name }));
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
    <div className="min-h-screen bg-[#f8fafc] w-full overflow-x-hidden">

      {features.length > 0 && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-5xl mx-auto px-4">
            <div className="flex items-center gap-5 overflow-x-auto scrollbar-hide py-2.5">
              {features.map(f => (
                <div key={f.title} className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-base">{f.emoji}</span>
                  <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{f.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Hero */}
        <div className="text-center py-4">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900">{businessName}</h1>
          {tagline && <p className="text-gray-500 text-sm mt-2">{tagline}</p>}
        </div>

        {/* Room cards */}
        {rooms.length > 0 && (
          <div>
            <h2 className="font-bold text-gray-900 text-lg mb-4">Available Rooms</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.map(room => {
                const isSelected = selected === (room.id ?? room.name);
                return (
                  <button key={room.id ?? room.name} onClick={() => selectRoom(room)}
                    className={[
                      'text-left rounded-2xl border-2 overflow-hidden transition-all duration-150 active:scale-[0.99]',
                      isSelected ? 'border-teal-500 shadow-lg shadow-teal-500/10' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm',
                    ].join(' ')}>
                    {room.image && (
                      <img src={room.image} alt={room.name} className="w-full h-40 object-cover bg-gray-100" />
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-bold text-sm ${isSelected ? 'text-teal-700' : 'text-gray-900'}`}>{room.name}</p>
                        {isSelected && (
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">✓</span>
                        )}
                      </div>
                      {room.description && <p className="text-xs text-gray-400 mt-1 leading-snug line-clamp-2">{room.description}</p>}
                      {room.price > 0 && (
                        <p className="text-sm font-bold mt-2" style={{ color: theme?.primary ?? '#0d9488' }}>
                          ₹{room.price.toLocaleString('en-IN')} <span className="text-xs font-normal text-gray-400">/ night</span>
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Booking form */}
        <div>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Book via WhatsApp</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {sent ? (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-8 text-center">
              <p className="text-3xl mb-3">🏨</p>
              <p className="font-bold text-green-800">Booking request sent!</p>
              <p className="text-sm text-green-600 mt-1">We'll confirm your booking on WhatsApp shortly.</p>
              <button onClick={() => { setSent(false); setForm(INITIAL); setSelected(null); }}
                className="mt-4 text-sm font-semibold text-green-700 underline underline-offset-2">
                Make another booking
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 space-y-4 max-w-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Guest Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Full name" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit number" inputMode="numeric" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Check-in *</label>
                  <input type="date" value={form.checkin} min={today()} onChange={e => setForm(f => ({ ...f, checkin: e.target.value }))}
                    required className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Check-out *</label>
                  <input type="date" value={form.checkout} min={form.checkin || today()} onChange={e => setForm(f => ({ ...f, checkout: e.target.value }))}
                    required className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Guests *</label>
                  <select value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all bg-white">
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Room Type</label>
                  <input value={form.roomType} onChange={e => setForm(f => ({ ...f, roomType: e.target.value }))}
                    placeholder="e.g. Deluxe"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Special Requests <span className="text-gray-300">(optional)</span></label>
                <textarea value={form.requests} onChange={e => setForm(f => ({ ...f, requests: e.target.value }))}
                  placeholder="Early check-in, extra bed, dietary needs…" rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all resize-none" />
              </div>
              <button type="submit" disabled={!isValid || sending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: theme?.primary ?? '#0d9488' }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Send Booking Request
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
