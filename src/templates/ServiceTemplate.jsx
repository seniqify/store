import { useState, useEffect, useRef } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { openServiceInquiry } from '../utils/whatsappEngine';

const INITIAL_FORM = { name: '', phone: '', services: [], budget: '', notes: '' };

export default function ServiceTemplate({ onCartCountChange }) {
  const [form,    setForm]    = useState(INITIAL_FORM);
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const formRef = useRef(null);

  const config = useBusinessConfig();
  const { products: services = [], categories = [], features = [], businessName, tagline, theme } = config;

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);
  useEffect(() => {
    document.title = `${businessName} — Request a Quote`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function toggleService(name) {
    setForm(f => {
      const next = f.services.includes(name)
        ? f.services.filter(s => s !== name)
        : [...f.services, name];
      if (next.length === 1 && !f.services.includes(name)) {
        setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }
      return { ...f, services: next };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    openServiceInquiry(form, config);
    setSent(true);
    setSending(false);
  }

  const isValid = form.name && form.phone.length === 10 && form.services.length > 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] w-full overflow-x-hidden">

      {/* Trust strip */}
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

        {/* Services grid */}
        <div>
          <h2 className="font-bold text-gray-900 text-lg mb-4">Our Services</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map(service => {
              const selected = form.services.includes(service.name);
              return (
                <button
                  key={service.id ?? service.name}
                  onClick={() => toggleService(service.name)}
                  className={[
                    'text-left p-4 rounded-2xl border-2 transition-all duration-150 active:scale-[0.99]',
                    selected ? 'border-teal-500 bg-teal-50' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm',
                  ].join(' ')}
                >
                  {service.image && (
                    <img src={service.image} alt={service.name}
                      className="w-full h-36 object-cover rounded-xl mb-3 bg-gray-100" />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`font-bold text-sm leading-tight ${selected ? 'text-teal-700' : 'text-gray-900'}`}>
                        {service.name}
                      </p>
                      {service.description && (
                        <p className="text-xs text-gray-400 mt-1 leading-snug line-clamp-2">{service.description}</p>
                      )}
                      {service.price > 0 && (
                        <p className="text-sm font-bold mt-2" style={{ color: theme?.primary ?? '#0d9488' }}>
                          Starting ₹{service.price.toLocaleString('en-IN')}
                        </p>
                      )}
                    </div>
                    {selected && (
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">✓</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {form.services.length > 0 && (
            <p className="text-xs text-teal-600 font-semibold mt-3">
              ✓ {form.services.length} service{form.services.length > 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        {/* Inquiry form */}
        <div ref={formRef}>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Request a Quote</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {sent ? (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-8 text-center">
              <p className="text-3xl mb-3">🎉</p>
              <p className="font-bold text-green-800">Your request has been sent!</p>
              <p className="text-sm text-green-600 mt-1">We'll get back to you on WhatsApp shortly.</p>
              <button onClick={() => { setSent(false); setForm(INITIAL_FORM); }}
                className="mt-4 text-sm font-semibold text-green-700 underline underline-offset-2">
                Send another request
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 space-y-4 max-w-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Your Name *</label>
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
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Budget <span className="text-gray-300">(optional)</span></label>
                <input value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                  placeholder="e.g. 5000" inputMode="numeric"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Requirements <span className="text-gray-300">(optional)</span></label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Describe what you need…" rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all resize-none" />
              </div>
              <button type="submit" disabled={!isValid || sending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: theme?.primary ?? '#0d9488' }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Send Quotation Request
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
