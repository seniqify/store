import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import StepBusinessType from '../components/onboarding/StepBusinessType';
import StepBusiness     from '../components/onboarding/StepBusiness';
import StepProducts     from '../components/onboarding/StepProducts';
import StepPublish      from '../components/onboarding/StepPublish';
import { buildBusinessConfig } from '../utils/buildConfig';
import { saveBusiness }        from '../utils/businessStorage';
import { listSlugs }           from '../utils/BusinessLoader';
import { slugExists }          from '../utils/storeService';
import { uploadConfigImages, uploadSingleImage } from '../utils/imageStorage';

const INITIAL = {
  businessType:      '',
  businessName:      '',
  logo:              '',
  coverImage:        '',
  whatsappNumber:    '',
  logoEmoji:         '🏪',
  themeColor:        '#0d9488',
  gstRate:           0.05,
  gstNumber:         '',
  deliveryCharge:    49,
  freeDeliveryAbove: 999,
  upiId:             '',
  bankAccountName:   '',
  bankAccountNumber: '',
  bankIfsc:          '',
  bankName:          '',
  pin:               '',
  categories:        [],
  products:          [],
};

const STEP_LABELS = ['Business Type', 'Your Business', 'Your Products', 'Preview & Launch'];

// Labels shown in StepProducts based on business type
const PRODUCT_MODE = {
  product:    'product',
  restaurant: 'menuitem',
  service:    'service',
  hotel:      'room',
  portfolio:  'service',
};

// â"€â"€ Launch Success Screen â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function LaunchSuccess({ slug, pin, themeColor }) {
  const [copied,  setCopied]  = useState(false);
  const [qrError, setQrError] = useState(false);
  const storeUrl  = `${window.location.origin}/${slug}`;
  const manageUrl = `${window.location.origin}/${slug}/manage`;
  const waText    = encodeURIComponent(
    `🎉 My new business page is live!\n\nBrowse & order here:\n${storeUrl}`
  );
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(storeUrl)}`;

  function copyUrl() {
    navigator.clipboard.writeText(storeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Confetti burst — auto-disabled under prefers-reduced-motion (see index.css)
  const confetti = [
    { l: '6%',  d: '0s',    t: '3.2s', c: themeColor, s: 9,  r: true  },
    { l: '14%', d: '0.3s',  t: '3.8s', c: '#f59e0b',  s: 7,  r: false },
    { l: '23%', d: '0.1s',  t: '3.0s', c: '#25D366',  s: 8,  r: true  },
    { l: '32%', d: '0.5s',  t: '4.0s', c: '#ec4899',  s: 6,  r: false },
    { l: '41%', d: '0.2s',  t: '3.5s', c: themeColor, s: 10, r: true  },
    { l: '50%', d: '0.6s',  t: '3.1s', c: '#0ea5e9',  s: 7,  r: false },
    { l: '59%', d: '0.15s', t: '3.9s', c: '#f59e0b',  s: 9,  r: true  },
    { l: '68%', d: '0.45s', t: '3.3s', c: '#25D366',  s: 6,  r: false },
    { l: '77%', d: '0.05s', t: '3.7s', c: themeColor, s: 8,  r: true  },
    { l: '86%', d: '0.35s', t: '3.2s', c: '#ec4899',  s: 7,  r: false },
    { l: '94%', d: '0.55s', t: '4.0s', c: '#0ea5e9',  s: 9,  r: true  },
    { l: '38%', d: '0.8s',  t: '3.6s', c: '#f59e0b',  s: 6,  r: false },
    { l: '63%', d: '0.9s',  t: '3.4s', c: themeColor, s: 8,  r: true  },
  ];

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden bg-white">

      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/60 via-white to-white" />
      <div className="absolute -z-10 top-[-6rem] left-1/2 -translate-x-1/2 w-[34rem] h-80 rounded-full bg-emerald-200/30 blur-3xl" />

      {/* Confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {confetti.map((p, i) => (
          <span key={i}
            className="absolute top-0 animate-pl-confetti"
            style={{
              left: p.l,
              width: p.s, height: p.s,
              backgroundColor: p.c,
              borderRadius: p.r ? '9999px' : '2px',
              animationDelay: p.d,
              animationDuration: p.t,
            }} />
        ))}
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl shadow-gray-300/40
                      border border-gray-100 overflow-hidden animate-pl-fade-up">

        {/* Celebration header */}
        <div className="relative px-6 pt-8 pb-7 text-center text-white overflow-hidden"
             style={{ background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}>
          <div className="absolute inset-0 opacity-20 pointer-events-none"
               style={{ backgroundImage: 'radial-gradient(circle, #ffffff66 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
          <div className="relative">
            <div className="w-20 h-20 mx-auto rounded-full bg-white flex items-center justify-center text-4xl shadow-lg animate-pl-pop">
              🎉
            </div>
            <h1 className="text-2xl font-extrabold mt-4 tracking-tight">Your page is live!</h1>
            <p className="text-sm text-white/80 mt-1">Congratulations — you're open for business.</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">

          {/* Store link + QR */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex gap-4 items-center">
              {!qrError && (
                <div className="flex-shrink-0 p-1.5 bg-white rounded-xl border border-gray-100 shadow-sm">
                  <img src={qrUrl} alt="Page QR code" width={80} height={80}
                       className="w-20 h-20 rounded-md block"
                       onError={() => setQrError(true)} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-widest mb-1">Your page link</p>
                <p className="font-mono text-sm font-bold text-gray-800 break-all leading-snug mb-2.5">
                  {storeUrl}
                </p>
                <button
                  onClick={copyUrl}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                             text-xs font-bold transition-all duration-150 active:scale-[0.98]"
                  style={{ backgroundColor: copied ? '#16a34a' : themeColor, color: '#fff' }}
                >
                  {copied ? '✓ Copied!' : 'Copy link'}
                </button>
              </div>
            </div>
            {!qrError && (
              <p className="text-[11px] text-gray-400 text-center mt-2.5">
                📷 Customers can scan this — print it for your shop counter
              </p>
            )}
          </div>

          {/* Primary actions */}
          <div className="space-y-2.5">
            <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer"
               className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold
                          text-white bg-[#25D366] hover:bg-[#1ebe5d] transition-colors active:scale-[0.98] shadow-sm">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Share on WhatsApp
            </a>

            <div className="grid grid-cols-2 gap-2.5">
              <a href={storeUrl} target="_blank" rel="noopener noreferrer"
                 className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold
                            text-white transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
                 style={{ backgroundColor: themeColor }}>
                🛍️ Visit page
              </a>
              <Link to={`/${slug}/manage`}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold
                               text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors active:scale-[0.98]">
                ⚙️ Manage
              </Link>
            </div>
          </div>

          {/* Manage link + PIN reminder */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <p className="text-[11px] text-amber-700 font-semibold mb-0.5">📋 Save your management link</p>
            <p className="font-mono text-xs text-amber-800 font-semibold break-all">{manageUrl}</p>
            <p className="text-[11px] text-amber-600 mt-1">
              PIN: <strong>{pin || 'last 4 digits of your WhatsApp number'}</strong>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();

  const [step,          setStep]          = useState(0);
  const [data,          setData]          = useState(INITIAL);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState('');
  const [launched,      setLaunched]      = useState(false);
  const [launchedSlug,  setLaunchedSlug]  = useState('');
  const [ownerPhone,    setOwnerPhone]    = useState('');
  const [plan,          setPlan]          = useState('free');

  // Gate: require phone from /start → redirect if missing
  useEffect(() => {
    const phone = sessionStorage.getItem('pocketlink_verified_phone');
    if (!phone) { navigate('/start', { replace: true }); return; }
    setOwnerPhone(phone);
    setPlan(sessionStorage.getItem('pocketlink_plan') || 'free');
  }, [navigate]);

  function update(partial) {
    setData(prev => ({ ...prev, ...partial }));
  }

  function getConfig() {
    return buildBusinessConfig(data, listSlugs());
  }

  async function handlePublish() {
    setSaving(true);
    setSaveError('');
    try {
      let config = { ...getConfig(), businessType: data.businessType || 'product' };
      const pin  = data.pin.trim() || data.whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';

      // â"€â"€ Ensure slug is unique in DB â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      let slug    = config.slug;
      let attempt = 2;
      while (await slugExists(slug)) {
        slug = `${config.slug}${attempt++}`;
      }
      config = { ...config, slug };

      // â"€â"€ Upload base64 product images to Supabase Storage â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const [uploadedProducts, uploadedLogo, uploadedCover] = await Promise.all([
        uploadConfigImages(config.products, slug),
        uploadSingleImage(config.logo, slug, 'logo'),
        uploadSingleImage(config.coverImage, slug, 'cover'),
      ]);
      config = { ...config, products: uploadedProducts, logo: uploadedLogo, coverImage: uploadedCover };

      await saveBusiness(config, pin, ownerPhone);
      sessionStorage.removeItem('pocketlink_verified_phone');
      sessionStorage.removeItem('pocketlink_plan');
      setLaunchedSlug(slug);
      setLaunched(true);          // show success screen instead of navigating away
    } catch (err) {
      setSaveError(err.message || 'Failed to save your page. Please try again.');
      setSaving(false);
    }
  }

  // â"€â"€ Show success screen after launch â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (launched) {
    return (
      <LaunchSuccess
        slug={launchedSlug}
        pin={data.pin.trim() || data.whatsappNumber.replace(/\D/g, '').slice(-4) || '1234'}
        themeColor={data.themeColor || '#0d9488'}
      />
    );
  }

  const progress = ((step + 1) / STEP_LABELS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* â"€â"€ Top bar â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center transition-opacity hover:opacity-80">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
          </Link>
          <span className="text-xs text-gray-400 font-medium">
            Step {step + 1} of {STEP_LABELS.length}
          </span>
        </div>
      </header>

      {/* â"€â"€ Progress bar â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500 ease-out"
             style={{ width: `${progress}%` }} />
      </div>

      {/* â"€â"€ Step pills â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-2 sm:px-4 flex">
          {STEP_LABELS.map((label, i) => {
            const done   = i < step;
            const active = i === step;
            return (
              <div key={label}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-3 border-b-2 transition-colors',
                  active ? 'border-emerald-500' : done ? 'border-emerald-200' : 'border-transparent',
                ].join(' ')}>
                <span className={[
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-colors',
                  done   ? 'bg-emerald-500 text-white'
                  : active ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-400',
                ].join(' ')}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={[
                  'text-[11px] font-semibold hidden sm:block',
                  active ? 'text-gray-900' : done ? 'text-emerald-600' : 'text-gray-400',
                ].join(' ')}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* â"€â"€ Step content â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <main className="max-w-lg mx-auto px-4 py-8">
        <div key={step} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 animate-pl-fade-up">
          {step === 0 && (
            <StepBusinessType
              selected={data.businessType}
              onSelect={(type) => update({ businessType: type })}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <StepBusiness data={data} onChange={update} onNext={() => setStep(2)} onBack={() => setStep(0)} />
          )}
          {step === 2 && (
            <StepProducts data={data} onChange={update} themeColor={data.themeColor}
              plan={plan}
              mode={PRODUCT_MODE[data.businessType] ?? 'product'}
              onNext={() => setStep(3)} onBack={() => setStep(1)} />
          )}
          {step === 3 && (
            <StepPublish
              data={data}
              config={getConfig()}
              saving={saving}
              saveError={saveError}
              onBack={() => setStep(2)}
              onPublish={handlePublish}
              onPinChange={(pin) => update({ pin })}
            />
          )}
        </div>
      </main>
    </div>
  );
}
