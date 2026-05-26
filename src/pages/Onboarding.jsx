import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import StepBusiness from '../components/onboarding/StepBusiness';
import StepProducts from '../components/onboarding/StepProducts';
import StepPublish  from '../components/onboarding/StepPublish';
import { buildBusinessConfig } from '../utils/buildConfig';
import { saveBusiness }        from '../utils/businessStorage';
import { listSlugs }           from '../utils/BusinessLoader';
import { slugExists }          from '../utils/storeService';
import { uploadConfigImages }  from '../utils/imageStorage';

const INITIAL = {
  businessName:      '',
  whatsappNumber:    '',
  logoEmoji:         'ðŸª',
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
  pin:               '',   // 4-digit store management PIN
  categories:        [],
  products:          [],
};

const STEP_LABELS = ['Your Business', 'Your Products', 'Preview & Launch'];

// â”€â”€ Launch Success Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LaunchSuccess({ slug, pin, themeColor }) {
  const [copied, setCopied]     = useState(false);
  const storeUrl  = `${window.location.origin}/${slug}`;
  const manageUrl = `${window.location.origin}/${slug}/manage`;
  const waText    = encodeURIComponent(
    `ðŸŽ‰ My new WhatsApp store is live!\n\nBrowse & order here:\n${storeUrl}`
  );

  function copyUrl() {
    navigator.clipboard.writeText(storeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7 w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">ðŸŽ‰</div>
          <h1 className="text-2xl font-extrabold text-gray-900">Your store is live!</h1>
          <p className="text-sm text-gray-500 mt-1">Share the link below with your customers.</p>
        </div>

        {/* Store URL â€” big copyable box */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-[11px] text-gray-400 font-medium mb-1">Your store link</p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm font-bold text-gray-800 flex-1 break-all leading-snug">
              {storeUrl}
            </p>
            <button
              onClick={copyUrl}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold
                         transition-all duration-150"
              style={{
                backgroundColor: copied ? '#16a34a' : themeColor,
                color: '#fff',
              }}
            >
              {copied ? 'âœ“ Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Manage URL */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-[11px] text-amber-600 font-medium mb-0.5">ðŸ“‹ Save this â€” your management link</p>
          <p className="font-mono text-xs text-amber-800 font-semibold break-all">{manageUrl}</p>
          <p className="text-[11px] text-amber-500 mt-1">
            PIN: <strong>{pin || 'last 4 digits of your WhatsApp number'}</strong>
          </p>
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                       text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ backgroundColor: themeColor }}
          >
            ðŸ›ï¸ Visit My Store
          </a>

          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                       text-sm font-bold text-white bg-[#25D366] hover:bg-[#1ebe5d] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Share on WhatsApp
          </a>

          <Link
            to={`/${slug}/manage`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                       text-sm font-semibold text-gray-600 border border-gray-200
                       hover:bg-gray-50 transition-colors"
          >
            âš™ï¸ Go to Manage Store
          </Link>
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

  // Gate: use verified phone if available (OTP flow), otherwise proceed directly
  // OTP gate is re-enabled once the Supabase send-otp edge function is deployed
  useEffect(() => {
    const phone = sessionStorage.getItem('pocketlink_verified_phone');
    if (phone) setOwnerPhone(phone);
  }, []);

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
      let config = getConfig();
      const pin  = data.pin.trim() || data.whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';

      // â”€â”€ Ensure slug is unique in DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let slug    = config.slug;
      let attempt = 2;
      while (await slugExists(slug)) {
        slug = `${config.slug}${attempt++}`;
      }
      config = { ...config, slug };

      // â”€â”€ Upload base64 product images to Supabase Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const uploadedProducts = await uploadConfigImages(config.products, slug);
      config = { ...config, products: uploadedProducts };

      await saveBusiness(config, pin, ownerPhone);
      sessionStorage.removeItem('pocketlink_verified_phone'); // consumed
      setLaunchedSlug(slug);
      setLaunched(true);          // show success screen instead of navigating away
    } catch (err) {
      setSaveError(err.message || 'Failed to save store. Please try again.');
      setSaving(false);
    }
  }

  // â”€â”€ Show success screen after launch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      {/* â”€â”€ Top bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-40 w-auto" />
          </Link>
          <span className="text-xs text-gray-400 font-medium">
            Step {step + 1} of {STEP_LABELS.length}
          </span>
        </div>
      </header>

      {/* â”€â”€ Progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="h-0.5 bg-gray-200">
        <div className="h-full bg-[#25D366] transition-all duration-500 ease-out"
             style={{ width: `${progress}%` }} />
      </div>

      {/* â”€â”€ Step pills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 flex">
          {STEP_LABELS.map((label, i) => (
            <div key={label}
              className={[
                'flex-1 py-2.5 text-center text-xs font-semibold border-b-2 transition-colors',
                i === step
                  ? 'border-gray-900 text-gray-900'
                  : i < step
                  ? 'border-green-400 text-green-600'
                  : 'border-transparent text-gray-400',
              ].join(' ')}>
              {i < step ? 'âœ“ ' : ''}{label}
            </div>
          ))}
        </div>
      </div>

      {/* â”€â”€ Step content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
          {step === 0 && (
            <StepBusiness data={data} onChange={update} onNext={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepProducts data={data} onChange={update} themeColor={data.themeColor}
              plan="free"
              onNext={() => setStep(2)} onBack={() => setStep(0)} />
          )}
          {step === 2 && (
            <StepPublish
              data={data}
              config={getConfig()}
              saving={saving}
              saveError={saveError}
              onBack={() => setStep(1)}
              onPublish={handlePublish}
              onPinChange={(pin) => update({ pin })}
            />
          )}
        </div>
      </main>
    </div>
  );
}
