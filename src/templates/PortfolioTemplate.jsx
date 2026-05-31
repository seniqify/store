import { useState, useEffect } from 'react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { openLeadInquiry } from '../utils/whatsappEngine';

const INITIAL = { name: '', phone: '', email: '', service: '', message: '' };

export default function PortfolioTemplate({ onCartCountChange }) {
  const [form,   setForm]   = useState(INITIAL);
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  const config = useBusinessConfig();
  const { products: items = [], categories = [], features = [], businessName, tagline, theme } = config;

  // Split items into services (no image needed) and gallery items (with images)
  const services = items.slice(0, 6);
  const gallery  = items.filter(i => i.image).slice(0, 9);

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);
  useEffect(() => {
    document.title = `${businessName} — Portfolio`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    openLeadInquiry(form, config);
    setSent(true);
    setSending(false);
  }

  const isValid = form.name && form.phone.length === 10;
  const primary = theme?.primary ?? '#0d9488';

  return (
    <div className="min-h-screen bg-[#f8fafc] w-full overflow-x-hidden">

      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-5 shadow-sm"
               style={{ backgroundColor: `${primary}18` }}>
            {config.logoEmoji ?? '💼'}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">{businessName}</h1>
          {tagline && <p className="text-gray-500 text-base max-w-md mx-auto leading-relaxed">{tagline}</p>}

          {features.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              {features.map(f => (
                <span key={f.title} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-100
                                               text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <span>{f.emoji}</span> {f.title}
                </span>
              ))}
            </div>
          )}

          <a href="#contact"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundColor: primary }}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Get in Touch
          </a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-12">

        {/* Services */}
        {services.length > 0 && (
          <section>
            <h2 className="font-extrabold text-gray-900 text-xl mb-5">What I Do</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map(item => (
                <div key={item.id ?? item.name}
                  className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
                  {item.image && (
                    <img src={item.image} alt={item.name} className="w-full h-36 object-cover rounded-xl mb-3 bg-gray-100" />
                  )}
                  {!item.image && (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3"
                         style={{ backgroundColor: `${primary}18` }}>
                      {item.emoji ?? '⭐'}
                    </div>
                  )}
                  <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{item.description}</p>
                  )}
                  {item.price > 0 && (
                    <p className="text-sm font-bold mt-2" style={{ color: primary }}>
                      ₹{item.price.toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <section>
            <h2 className="font-extrabold text-gray-900 text-xl mb-5">Work Gallery</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((item, i) => (
                <div key={i} className="rounded-2xl overflow-hidden bg-gray-100 aspect-square">
                  <img src={item.image} alt={item.name}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Lead form */}
        <section id="contact">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Get in Touch</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {sent ? (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-8 text-center max-w-lg mx-auto">
              <p className="text-3xl mb-3">🎉</p>
              <p className="font-bold text-green-800">Message sent on WhatsApp!</p>
              <p className="text-sm text-green-600 mt-1">I'll get back to you shortly.</p>
              <button onClick={() => { setSent(false); setForm(INITIAL); }}
                className="mt-4 text-sm font-semibold text-green-700 underline underline-offset-2">
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 space-y-4 max-w-lg mx-auto">
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
                <label className="text-xs font-medium text-gray-500 mb-1 block">Email <span className="text-gray-300">(optional)</span></label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="you@email.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Interested In <span className="text-gray-300">(optional)</span></label>
                <select value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all bg-white">
                  <option value="">Select a service…</option>
                  {services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Message <span className="text-gray-300">(optional)</span></label>
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Tell me about your project or requirement…" rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all resize-none" />
              </div>
              <button type="submit" disabled={!isValid || sending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: primary }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Send Inquiry on WhatsApp
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
