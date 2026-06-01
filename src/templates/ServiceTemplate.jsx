import { useState, useEffect, useRef } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { whatsappLink } from '../utils/theme';
import { openServiceInquiry } from '../utils/whatsappEngine';
import PromoBanner from '../components/PromoBanner';

const INITIAL_FORM = { name: '', phone: '', services: [], budget: '', notes: '' };

const Wa = (p) => (<svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" {...p}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>);

export default function ServiceTemplate({ onCartCountChange }) {
  const [form,    setForm]    = useState(INITIAL_FORM);
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const formRef     = useRef(null);
  const servicesRef = useRef(null);

  const config = useBusinessConfig();
  const { products: services = [], features = [], businessName, tagline, logo, logoEmoji, coverImage, whatsappNumber, theme } = config;
  const primary     = theme?.primary ?? '#6366f1';
  const waLink      = whatsappLink(whatsappNumber, businessName);

  useEffect(() => { onCartCountChange?.(0); }, [onCartCountChange]);
  useEffect(() => {
    document.title = `${businessName} — Services`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function toggleService(name) {
    setForm(f => {
      const next = f.services.includes(name)
        ? f.services.filter(s => s !== name)
        : [...f.services, name];
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
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: '#f7f8fb' }}>

      <PromoBanner maxWidth="max-w-5xl" />

      {/* ══ Dark elevated hero ══════════════════════════════════════════════════ */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0b1220 0%, #1e293b 55%, #0b1220 100%)' }} />
        {coverImage && (
          <div className="absolute inset-0 opacity-25"
               style={{ backgroundImage: `url(${coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(11,18,32,0.85), rgba(15,23,42,0.7))' }} />
        {/* accent glow */}
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full"
             style={{ background: primary, opacity: 0.35, filter: 'blur(90px)' }} />

        <div className="relative max-w-5xl mx-auto px-4 py-14 sm:py-20">
          <div className="flex items-center gap-4 mb-5">
            {logo ? (
              <img src={logo} alt={businessName}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover ring-2 ring-white/15 flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl flex-shrink-0"
                   style={{ backgroundColor: `${primary}33`, border: `1px solid ${primary}66` }}>
                {logoEmoji ?? '🔧'}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">{businessName}</h1>
              {tagline && <p className="text-slate-300 text-sm sm:text-base mt-1">{tagline}</p>}
            </div>
          </div>

          {features.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-7">
              {features.map(f => (
                <span key={f.title} className="inline-flex items-center gap-1.5 text-xs font-semibold
                                               px-3 py-1.5 rounded-full text-slate-200 border border-white/10 backdrop-blur-sm"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <span>{f.emoji}</span> {f.title}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button onClick={() => scrollTo(servicesRef)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white
                         shadow-lg transition-all active:scale-95"
              style={{ backgroundColor: primary, boxShadow: `0 10px 30px ${primary}40` }}>
              Get a Free Quote <ArrowRight size={15} />
            </button>
            <a href={waLink} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white
                          border border-white/20 hover:bg-white/10 transition-all active:scale-95">
              <Wa /> Message on WhatsApp
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">

        {/* ══ Services ══════════════════════════════════════════════════════════ */}
        <section ref={servicesRef} className="scroll-mt-4">
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2.5">
              <span className="w-1.5 h-6 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: primary }} />
              What we offer
            </h2>
            {form.services.length > 0 && (
              <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white"
                    style={{ backgroundColor: primary }}>
                {form.services.length} selected · tap to add more
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map(service => {
              const selected = form.services.includes(service.name);
              return (
                <button key={service.id ?? service.name} onClick={() => toggleService(service.name)}
                  className={[
                    'group text-left rounded-2xl overflow-hidden transition-all duration-200 flex flex-col bg-white',
                    selected
                      ? 'shadow-xl -translate-y-0.5'
                      : 'border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5',
                  ].join(' ')}
                  style={selected ? { boxShadow: `0 0 0 2px ${primary}, 0 18px 40px ${primary}1f` } : {}}>

                  {service.image && (
                    <div className="relative w-full h-44 overflow-hidden">
                      <img src={service.image} alt={service.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-60" />
                      {selected && (
                        <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white shadow-md"
                             style={{ backgroundColor: primary }}>
                          <Check size={15} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-gray-900 text-[15px] leading-tight">{service.name}</p>
                      {!service.image && (
                        <span className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
                              style={selected ? { backgroundColor: primary, borderColor: primary } : { borderColor: '#e5e7eb' }}>
                          {selected && <Check size={11} strokeWidth={3} className="text-white" />}
                        </span>
                      )}
                    </div>

                    {service.description && (
                      <p className="text-xs text-gray-500 leading-relaxed mt-1.5 line-clamp-3">{service.description}</p>
                    )}

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                      {service.price > 0 ? (
                        <div className="leading-tight">
                          <span className="text-[10px] text-gray-400 block">Starting from</span>
                          <span className="text-base font-extrabold" style={{ color: primary }}>
                            ₹{service.price.toLocaleString('en-IN')}
                          </span>
                        </div>
                      ) : <span className="text-xs text-gray-400">Custom quote</span>}
                      <span className="text-xs font-bold transition-colors"
                            style={{ color: selected ? primary : '#9ca3af' }}>
                        {selected ? '✓ Added' : 'Select →'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ══ Inquiry form ══════════════════════════════════════════════════════ */}
        <section ref={formRef} className="scroll-mt-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Request a Quote</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {sent ? (
            <div className="rounded-3xl p-10 text-center max-w-md mx-auto bg-white border border-gray-100 shadow-lg">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-bold text-gray-900 text-xl">Request sent!</p>
              <p className="text-sm text-gray-500 mt-2">We’ll get back to you on WhatsApp shortly.</p>
              <button onClick={() => { setSent(false); setForm(INITIAL_FORM); }}
                className="mt-6 text-sm font-semibold underline underline-offset-4" style={{ color: primary }}>
                Send another request
              </button>
            </div>
          ) : (
            <div className="max-w-lg">
              <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">

                {/* Selected services summary */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Services you’re interested in *</label>
                  {form.services.length === 0 ? (
                    <button type="button" onClick={() => scrollTo(servicesRef)}
                      className="w-full text-left text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl px-3 py-2.5 hover:border-gray-300 transition-colors">
                      ↑ Pick one or more services above to get started
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {form.services.map(s => (
                        <span key={s} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-2.5 py-1 rounded-full"
                              style={{ backgroundColor: primary }}>
                          {s}
                          <button type="button" onClick={() => toggleService(s)} aria-label={`Remove ${s}`} className="hover:opacity-80">
                            <X size={11} strokeWidth={3} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Your Name *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Full name" required
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                      style={{ '--tw-ring-color': `${primary}50` }} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Phone *</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                      placeholder="10-digit number" inputMode="numeric" required
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                      style={{ '--tw-ring-color': `${primary}50` }} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Budget <span className="font-normal text-gray-300">(optional)</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                    <input value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                      placeholder="Your approximate budget" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                      style={{ '--tw-ring-color': `${primary}50` }} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Requirements <span className="font-normal text-gray-300">(optional)</span></label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Describe your project or requirements…" rows={3}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all resize-none"
                    style={{ '--tw-ring-color': `${primary}50` }} />
                </div>

                <button type="submit" disabled={!isValid || sending}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                  style={{ backgroundColor: '#25D366' }}>
                  <Wa /> Send Quotation Request
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
