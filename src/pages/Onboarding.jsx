import { useState, useEffect, Fragment } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import StepBusinessType from '../components/onboarding/StepBusinessType';
import StepBusiness     from '../components/onboarding/StepBusiness';
import StepProducts     from '../components/onboarding/StepProducts';
import StepPublish      from '../components/onboarding/StepPublish';
import { buildBusinessConfig } from '../utils/buildConfig';
import { saveBusiness, cacheStore } from '../utils/businessStorage';
import { sendWelcome }              from '../utils/otpService';
import { listSlugs }           from '../utils/BusinessLoader';
import { slugExists, clearPendingSignup, updateStore } from '../utils/storeService';
import { supabase }                from '../lib/supabase';
import { uploadConfigImages, uploadSingleImage, isBase64Image } from '../utils/imageStorage';
import { defaultIcon, DEFAULT_CATEGORY } from '../utils/businessCategories';
import { useI18n } from '../i18n/I18nContext';
import LanguageSwitcher from '../components/ui/LanguageSwitcher';

// ── Pay-to-publish helpers (Razorpay) ───────────────────────────────────────
function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Paid term length before the next auto-charge (+grace). Webhook renews it.
function termExpiry(period) {
  const days = period === 'yearly' ? 368 : 33;
  return new Date(Date.now() + days * 86400000).toISOString();
}

// Take payment for the store's plan, returning { subId, expires } on success or
// null if the customer dismissed the checkout. Razorpay opens as a modal, so the
// built store (component state) is preserved while paying.
async function payToPublish(planKey, period, phone) {
  const ok = await loadRazorpay();
  if (!ok) throw new Error('Could not load the payment SDK. Check your connection.');

  const { data: subData } = await supabase.functions.invoke('create-razorpay-subscription', {
    body: { plan: planKey, period, phone },
  });
  if (subData?.error || !subData?.subscription_id) {
    throw new Error(subData?.error ?? 'Could not start the subscription.');
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key:             subData.key_id,
      subscription_id: subData.subscription_id,
      name:            'PocketLink',
      description:     'Publish your store · auto-renews · cancel anytime',
      prefill:         { contact: String(phone).replace(/^91/, '') },
      theme:           { color: '#0d9488' },
      modal:           { ondismiss: () => resolve(null) },
      handler: async (response) => {
        try {
          const { data: v } = await supabase.functions.invoke('verify-razorpay-payment', {
            body: {
              razorpay_payment_id:      response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature:       response.razorpay_signature,
            },
          });
          if (v?.verified) resolve({ subId: subData.subscription_id, expires: termExpiry(period) });
          else reject(new Error(v?.error ?? 'Payment verification failed.'));
        } catch (e) { reject(e); }
      },
    });
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description ?? 'Payment failed. Please try again.')));
    rzp.open();
  });
}

const INITIAL = {
  businessType:      '',
  category:          '',
  businessName:      '',
  tagline:           '',
  address:           '',
  state:             '',
  city:              '',
  pincode:           '',
  area:              '',
  features:          [],
  logo:              '',
  coverImage:        '',
  whatsappNumber:    '',
  logoEmoji:         '🏪',
  themeColor:        '#0d9488',
  gstRate:           0,
  gstNumber:         '',
  deliveryCharge:    0,
  freeDeliveryAbove: 0,
  upiId:             '',
  bankAccountName:   '',
  bankAccountNumber: '',
  bankIfsc:          '',
  bankName:          '',
  pin:               '',
  categories:        [],
  products:          [],
};

const STEP_LABELS = ['Type', 'Details', 'Items', 'Launch'];
const STEP_ICONS  = ['🧭', '📝', '📦', '🚀'];

// Each business type gets its own accent so stores aren't all the same colour.
// (Owners can change it later in Manage → Settings.)
const THEME_BY_TYPE = { product: '#0d9488', service: '#9333ea' };

// Premium dark stepper shown across all onboarding steps.
function Stepper({ labels, icons, current }) {
  return (
    <div className="flex items-start justify-between max-w-md mx-auto">
      {labels.map((label, i) => {
        const done = i < current, active = i === current;
        return (
          <Fragment key={label}>
            <div className="flex flex-col items-center gap-2 w-16 flex-shrink-0">
              <div className={[
                'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300',
                done ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40'
                  : active ? 'bg-white text-gray-900 ring-4 ring-emerald-400/30'
                  : 'bg-white/10 text-white/40 border border-white/15',
              ].join(' ')}>
                {done ? <Check size={16} strokeWidth={3} /> : <span className="text-base leading-none">{icons[i]}</span>}
              </div>
              <span className={[
                'text-[10px] font-semibold text-center leading-tight transition-colors hidden sm:block',
                active ? 'text-white' : done ? 'text-emerald-300' : 'text-white/40',
              ].join(' ')}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-0.5 mt-5 rounded-full bg-white/10 min-w-[0.75rem] overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: done ? '100%' : '0%' }} />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// Labels shown in StepProducts based on business type
const PRODUCT_MODE = {
  product: 'product',
  service: 'service',
};

// â"€â"€ Launch Success Screen â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function LaunchSuccess({ slug, pin, themeColor }) {
  const { t } = useI18n();
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
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden"
         style={{ background: 'linear-gradient(170deg, #061310 0%, #0a2a20 48%, #05110d 100%)' }}>

      {/* Background aurora */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-[-6rem] left-1/2 -translate-x-1/2 w-[40rem] h-80 rounded-full blur-[110px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.32), transparent 65%)' }} />
      </div>

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
            <h1 className="text-2xl font-extrabold mt-4 tracking-tight">{t('ok.title')}</h1>
            <p className="text-sm text-white/80 mt-1">{t('ok.sub')}</p>
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
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-widest mb-1">{t('ok.link')}</p>
                <p className="font-mono text-sm font-bold text-gray-800 break-all leading-snug mb-2.5">
                  {storeUrl}
                </p>
                <button
                  onClick={copyUrl}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
                             text-xs font-bold transition-all duration-150 active:scale-[0.98]"
                  style={{ backgroundColor: copied ? '#16a34a' : themeColor, color: '#fff' }}
                >
                  {copied ? t('ok.copied') : t('ok.copy')}
                </button>
              </div>
            </div>
            {!qrError && (
              <p className="text-[11px] text-gray-400 text-center mt-2.5">
                {t('ok.scan')}
              </p>
            )}
          </div>

          {/* Primary actions */}
          <div className="space-y-2.5">
            <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer"
               className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold
                          text-white bg-[#25D366] hover:bg-[#1ebe5d] transition-colors active:scale-[0.98] shadow-sm">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              {t('ok.share')}
            </a>

            <div className="grid grid-cols-2 gap-2.5">
              <a href={storeUrl} target="_blank" rel="noopener noreferrer"
                 className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold
                            text-white transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
                 style={{ backgroundColor: themeColor }}>
                {t('ok.visit')}
              </a>
              <Link to={`/${slug}/manage`}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold
                               text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors active:scale-[0.98]">
                {t('ok.manage')}
              </Link>
            </div>
          </div>

          {/* Manage link + PIN reminder */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <p className="text-[11px] text-amber-700 font-semibold mb-0.5">{t('ok.saveLink')}</p>
            <p className="font-mono text-xs text-amber-800 font-semibold break-all">{manageUrl}</p>
            <p className="text-[11px] text-amber-600 mt-1">
              {t('ok.pinIs')}: <strong>{pin || t('ok.pinDefault')}</strong>
            </p>
          </div>

          {/* Make-it-yours nudge — all the optional polish now lives in Manage */}
          <p className="text-center text-[11px] text-gray-400 leading-relaxed px-2">
            {t('ok.nudge')}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const stepLabels = [t('onb.s.type'), t('onb.s.details'), t('onb.s.items'), t('onb.s.launch')];

  const [step,          setStep]          = useState(0);
  const [data,          setData]          = useState(INITIAL);
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState('');
  const [launched,      setLaunched]      = useState(false);
  const [launchedSlug,  setLaunchedSlug]  = useState('');
  const [ownerPhone,    setOwnerPhone]    = useState('');
  const [plan,          setPlan]          = useState('starter');
  const [planExpiresAt, setPlanExpiresAt] = useState(null);

  // Gate: require phone from /start → redirect if missing
  useEffect(() => {
    const phone = sessionStorage.getItem('pocketlink_verified_phone');
    if (!phone) { navigate('/start', { replace: true }); return; }
    setOwnerPhone(phone);
    // Prefill the WhatsApp number from the just-verified phone — no need to ask again.
    setData(d => ({ ...d, whatsappNumber: d.whatsappNumber || phone.replace(/\D/g, '').slice(-10) }));
    setPlan(sessionStorage.getItem('pocketlink_plan') || 'starter');
    setPlanExpiresAt(sessionStorage.getItem('pocketlink_plan_expires') || null);
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
      // New free signups get a free 7-day Pro trial (Verified badge + analytics +
      // no branding). It reverts to Free after 7 days unless they subscribe.
      // effectivePlan() treats an expired paid plan as 'free', so no cleanup needed.
      let trialPlan = plan, trialExpires = planExpiresAt;
      if (trialPlan === 'free' && !trialExpires) {
        trialPlan = 'pro';
        trialExpires = new Date(Date.now() + 7 * 86400000).toISOString();
      }
      let config = { ...getConfig(), businessType: data.businessType || 'product', plan: trialPlan, planExpiresAt: trialExpires };
      const subId = sessionStorage.getItem('pocketlink_subscription_id');
      if (subId) config.razorpaySubscriptionId = subId;
      const pin  = data.pin.trim() || data.whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';

      // â"€â"€ Ensure slug is unique in DB â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      let slug    = config.slug;
      let attempt = 2;
      while (await slugExists(slug)) {
        slug = `${config.slug}${attempt++}`;
      }
      config = { ...config, slug };

      // ── Build free, pay to publish ──────────────────────────────────────────
      // If this store has no paid term yet (e.g. the Starter build-first flow),
      // take payment now. Prepaid plans (Pro/Business via /checkout) already have
      // planExpiresAt set and skip this. Cancelling leaves the build intact.
      if (!config.planExpiresAt) {
        let paid;
        try {
          paid = await payToPublish(config.plan || 'starter', 'monthly', ownerPhone);
        } catch (err) {
          setSaveError(err.message || 'Payment failed. Please try again.');
          setSaving(false);
          return;
        }
        if (!paid) { setSaving(false); return; }   // customer dismissed checkout
        config = { ...config, planExpiresAt: paid.expires, razorpaySubscriptionId: paid.subId };
      }

      // Save the page immediately with photos kept as-is, so "Launch" feels
      // instant even on a slow field connection (one insert, no image upload
      // wait). The success screen shows right away; photos then move to Storage
      // in the background (uploadImagesInBackground) and swap in their CDN URLs.
      await saveBusiness(config, pin, ownerPhone);

      // Best-effort: WhatsApp the owner their store link + QR + "Manage" button.
      // Never blocks the launch — a failed send must not break onboarding.
      sendWelcome(ownerPhone, config.businessName, slug).catch(() => {});

      sessionStorage.removeItem('pocketlink_verified_phone');
      sessionStorage.removeItem('pocketlink_plan');
      sessionStorage.removeItem('pocketlink_plan_expires');
      sessionStorage.removeItem('pocketlink_subscription_id');

      setLaunchedSlug(slug);
      setLaunched(true);          // show success screen instead of navigating away

      // Non-blocking: detach the pending signup + move photos to Storage.
      clearPendingSignup(ownerPhone).catch(() => {});
      uploadImagesInBackground(config, slug, pin);
    } catch (err) {
      setSaveError(err.message || 'Failed to save your page. Please try again.');
      setSaving(false);
    }
  }

  // After the page is live, swap any base64 photos for Supabase Storage URLs.
  // Failure is harmless — the base64 version is already saved and renders fine.
  async function uploadImagesInBackground(config, slug, pin) {
    try {
      const needsUpload =
        isBase64Image(config.logo) ||
        isBase64Image(config.coverImage) ||
        (config.products || []).some(p => isBase64Image(p.image));
      if (!needsUpload) return;
      const [products, logo, coverImage] = await Promise.all([
        uploadConfigImages(config.products, slug),
        uploadSingleImage(config.logo, slug, 'logo'),
        uploadSingleImage(config.coverImage, slug, 'cover'),
      ]);
      const updated = { ...config, products, logo, coverImage };
      await updateStore(slug, updated, pin);
      cacheStore(updated);
    } catch {
      /* base64 already saved & working — nothing to do */
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

  return (
    <div className="relative min-h-screen overflow-hidden"
         style={{ background: 'linear-gradient(170deg, #061310 0%, #0a2a20 48%, #05110d 100%)' }}>

      {/* aurora + grid */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-[-8rem] left-1/2 -translate-x-1/2 w-[42rem] h-[26rem] rounded-full blur-[120px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.30), transparent 65%)' }} />
        <div className="absolute inset-0 opacity-[0.05]"
             style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '46px 46px', maskImage: 'radial-gradient(ellipse 80% 45% at 50% 12%, #000, transparent 75%)' }} />
      </div>

      {/* Top bar */}
      <header className="relative z-10">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto brightness-0 invert" />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="dark" />
            <span className="text-xs text-white/45 font-medium hidden sm:inline">
              {t('onb.step', { n: step + 1, total: stepLabels.length })}
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-lg mx-auto px-4 pb-12">

        {/* eyebrow */}
        <div className="text-center mb-6 mt-1">
          <span className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                           text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
            {t('onb.eyebrow')}
          </span>
        </div>

        {/* Stepper */}
        <div className="mb-8 px-2">
          <Stepper labels={stepLabels} icons={STEP_ICONS} current={step} />
        </div>

        {/* Step content — light "work surface" floating on the dark frame */}
        <div key={step} className="bg-white rounded-3xl shadow-2xl shadow-black/40 p-6 sm:p-8 animate-pl-fade-up">
          {step === 0 && (
            <StepBusinessType
              selected={data.businessType}
              onSelect={(type) => update({
                businessType: type,
                themeColor: THEME_BY_TYPE[type] || '#0d9488',
                logoEmoji: defaultIcon(DEFAULT_CATEGORY[type] || 'Other Retail'),
              })}
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

        {/* reassurance */}
        <p className="text-center text-xs text-white/35 mt-5">
          {t('onb.reassure')}
        </p>
      </main>
    </div>
  );
}
