import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import StepBusiness from '../components/onboarding/StepBusiness';
import StepProducts from '../components/onboarding/StepProducts';
import StepPublish  from '../components/onboarding/StepPublish';
import { buildBusinessConfig } from '../utils/buildConfig';
import { saveBusiness }        from '../utils/businessStorage';
import { listSlugs }           from '../utils/BusinessLoader';

const INITIAL = {
  businessName:      '',
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
  pin:               '',   // 4-digit store management PIN
  categories:        [],
  products:          [],
};

const STEP_LABELS = ['Your Business', 'Your Products', 'Preview & Launch'];

export default function Onboarding() {
  const [step,      setStep]      = useState(0);
  const [data,      setData]      = useState(INITIAL);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState('');
  const navigate = useNavigate();

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
      const config = getConfig();
      // Default PIN = last 4 digits of WhatsApp number
      const pin = data.pin.trim() || data.whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';
      await saveBusiness(config, pin);
      navigate(`/${config.slug}`);
    } catch (err) {
      setSaveError(err.message || 'Failed to save store. Please try again.');
      setSaving(false);
    }
  }

  const progress = ((step + 1) / STEP_LABELS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <img src="/seniqify-logo.png" alt="Seniqify" className="h-9 w-auto" />
            <span className="text-[13px] font-semibold tracking-[0.12em] uppercase
                             bg-gradient-to-r from-[#25D366] to-teal-400
                             bg-clip-text text-transparent hidden sm:block"
                  style={{ fontFamily: "'Poppins', sans-serif" }}>
              WhatsApp Store
            </span>
          </Link>
          <span className="text-xs text-gray-400 font-medium">
            Step {step + 1} of {STEP_LABELS.length}
          </span>
        </div>
      </header>

      {/* ── Progress bar ─────────────────────────────────────────────── */}
      <div className="h-0.5 bg-gray-200">
        <div className="h-full bg-[#25D366] transition-all duration-500 ease-out"
             style={{ width: `${progress}%` }} />
      </div>

      {/* ── Step pills ───────────────────────────────────────────────── */}
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
              {i < step ? '✓ ' : ''}{label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step content ─────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
          {step === 0 && (
            <StepBusiness data={data} onChange={update} onNext={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepProducts data={data} onChange={update} themeColor={data.themeColor}
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
