/**
 * ManageStore — Store management dashboard
 * Route: /:businessSlug/manage
 *
 * Flow:
 *  1. Load store config from DB
 *  2. Show PIN gate
 *  3. After verified → tabs: Products | Categories | Settings
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { canAddProduct, canAddCategory, getPlanLimits, effectivePlan, trialDaysLeft, showBrandBadge } from '../utils/planLimits';
import {
  Lock, ArrowLeft, Package, Tag, Settings2, ShoppingBag, BarChart3,
  Plus, X, Pencil, ImagePlus, Link2, CheckCircle2,
  AlertCircle, ChevronDown, Copy, Check, Trash2, QrCode, Star,
  Menu, LogOut, Percent, Sparkles, Users,
} from 'lucide-react';
import { openStorePoster } from '../utils/storePoster';
import { normaliseHours, defaultHours, getStoreStatus, DAY_ORDER, DAY_FULL } from '../utils/storeHours';
import { loadBusiness }                               from '../utils/BusinessLoader';
import { updateStore, verifyPin, resetPin, deleteStore } from '../utils/storeService';
import { sendOtp }                                       from '../utils/otpService';
import { cacheStore, clearCachedStore }               from '../utils/businessStorage';
import { THEME_PRESETS, FEATURE_SUGGESTIONS }         from '../utils/buildConfig';
import { uploadConfigImages, uploadSingleImage }      from '../utils/imageStorage';
import { subcategoriesForType, ICON_EMOJIS, defaultIcon } from '../utils/businessCategories';
import { suggestProductDetails }                     from '../utils/productAi';
import LocationPicker                                 from '../components/LocationPicker';
import IconPicker                                     from '../components/IconPicker';
import OrdersTab                                       from '../components/manage/OrdersTab';
import AnalyticsTab                                    from '../components/manage/AnalyticsTab';
import ReachCard                                       from '../components/manage/ReachCard';
import ReviewsTab                                       from '../components/manage/ReviewsTab';
import OffersTab                                        from '../components/manage/OffersTab';
import AiInsightsTab                                    from '../components/manage/AiInsightsTab';
import CustomersTab                                      from '../components/manage/CustomersTab';

// ── Constants ─────────────────────────────────────────────────────────────────
const CAT_EMOJIS = ICON_EMOJIS;
const UNIT_OPTIONS = [
  'per piece','per kg','per metre','per litre',
  'pack of 2','pack of 3','pack of 6','pack of 12',
  'per box','per set','per dozen','Other…',
];
const STANDARD_UNITS = UNIT_OPTIONS.filter(u => u !== 'Other…');
const THEME_OPTIONS  = [
  { hex: '#0d9488', label: 'Teal'   },
  { hex: '#2563eb', label: 'Blue'   },
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#16a34a', label: 'Green'  },
  { hex: '#ea580c', label: 'Orange' },
  { hex: '#9333ea', label: 'Purple' },
  { hex: '#e11d48', label: 'Rose'   },
];
const EMPTY_PROD  = { name:'', category:'', price:'', mrp:'', unit:'per piece', unitCustom:'', description:'', image:'', gstRate:'', taxMode:'', variantLabel:'', variantOptions:[], attributes:[] };
const EMPTY_CAT   = { emoji:'📦', label:'' };

// ── Helpers ───────────────────────────────────────────────────────────────────
function iCls(err) {
  return [
    'w-full px-3.5 py-2.5 rounded-xl border text-sm text-gray-900',
    'placeholder-gray-400 transition focus:outline-none focus:ring-4',
    err ? 'border-red-300 focus:ring-red-100 bg-red-50/40'
        : 'border-gray-200 focus:border-gray-400 focus:ring-gray-100 bg-white',
  ].join(' ');
}

// Consistent field label + grouped section heading shared across the manage forms.
const FIELD_LABEL = 'block text-xs font-semibold text-gray-700 mb-1.5';

function FormSection({ title, action, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{title}</h4>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ── ImageUploader ─────────────────────────────────────────────────────────────
function ImageUploader({ value, onChange }) {
  const [dragOver, setDragOver] = useState(false);
  const [urlMode,  setUrlMode]  = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileRef = useRef(null);

  const isBase64 = value?.startsWith('data:');
  const hasImage = Boolean(value);

  function compressAndSet(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        onChange(canvas.toDataURL('image/jpeg', 0.82));
        setUrlMode(false); setUrlInput('');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  if (hasImage) {
    return (
      <div className="flex items-start gap-3">
        <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
          <img src={value} alt="" className="w-full h-full object-cover" onError={() => onChange('')} />
        </div>
        <div className="flex flex-col gap-1.5 pt-0.5">
          <p className="text-xs font-semibold text-gray-700">{isBase64 ? '✅ Image uploaded' : '🔗 Image URL set'}</p>
          <p className="text-[11px] text-gray-400 leading-snug max-w-[180px] truncate">
            {isBase64 ? 'Compressed & ready' : value}
          </p>
          <div className="flex gap-2 mt-0.5">
            <button type="button" onClick={() => fileRef.current?.click()}
                    className="text-xs font-medium text-teal-600 hover:text-teal-800 underline underline-offset-2">
              Change
            </button>
            <span className="text-gray-300">·</span>
            <button type="button" onClick={() => onChange('')}
                    className="text-xs font-medium text-red-400 hover:text-red-600 underline underline-offset-2">
              Remove
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
               onChange={(e) => compressAndSet(e.target.files?.[0])} />
      </div>
    );
  }

  if (urlMode) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="url" autoFocus placeholder="https://example.com/product.jpg"
                 value={urlInput}
                 onChange={(e) => setUrlInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && urlInput.trim() && (onChange(urlInput.trim()), setUrlMode(false))}
                 className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <button type="button" onClick={() => urlInput.trim() && (onChange(urlInput.trim()), setUrlMode(false))}
                  className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700">
            Set
          </button>
          <button type="button" onClick={() => { setUrlMode(false); setUrlInput(''); }}
                  className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); compressAndSet(e.dataTransfer.files?.[0]); }}
              className={[
                'w-full rounded-xl border-2 border-dashed py-4 px-4',
                'flex flex-col items-center gap-2 transition-all cursor-pointer',
                dragOver ? 'border-gray-500 bg-gray-100' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
              ].join(' ')}>
        <ImagePlus size={18} className="text-gray-400" />
        <p className="text-xs font-semibold text-gray-600">Click to upload or drag &amp; drop</p>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
             onChange={(e) => compressAndSet(e.target.files?.[0])} />
      <button type="button" onClick={() => setUrlMode(true)}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 mx-auto">
        <Link2 size={11} /> Use image URL instead
      </button>
    </div>
  );
}

// ── Save toast helper ─────────────────────────────────────────────────────────
function SaveBar({ status, error, onSave, dirty, themeColor }) {
  if (!dirty && status !== 'saved') return null;
  return (
    <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-4">
      {status === 'saved' && (
        <div className="flex items-center gap-1.5 text-green-600 text-sm font-semibold">
          <CheckCircle2 size={15} />
          Saved successfully!
        </div>
      )}
      {error && <p className="text-sm text-red-500 flex-1">{error}</p>}
      {dirty && status !== 'saved' && (
        <button onClick={onSave} disabled={status === 'saving'}
                className="ml-auto px-5 py-2.5 rounded-xl text-sm font-bold text-white
                           transition-all hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
                style={{ backgroundColor: themeColor }}>
          {status === 'saving' ? (
            <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
          ) : '💾 Save Changes'}
        </button>
      )}
    </div>
  );
}

// ── PIN Gate ─────────────────────────────────────────────────────────────────
function PinGate({ slug, onVerified }) {
  const [mode,     setMode]     = useState('login');   // 'login' | 'recover'
  const [pin,      setPin]      = useState('');
  const [error,    setError]    = useState('');
  const [checking, setChecking] = useState(false);

  // Recovery state
  const [phone,    setPhone]    = useState('');
  const [otpSent,  setOtpSent]  = useState(false);
  const [code,     setCode]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [newPin,   setNewPin]   = useState('');
  const [confPin,  setConfPin]  = useState('');
  const [success,  setSuccess]  = useState(false);

  // ── Login ──────────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    if (pin.length !== 4) { setError('Enter your 4-digit PIN'); return; }
    setChecking(true); setError('');
    const ok = await verifyPin(slug, pin);
    if (ok) {
      onVerified(pin);
    } else {
      setError('Incorrect PIN. Please try again.');
      setChecking(false);
    }
  }

  // ── Recovery: step 1 — send an OTP to the store's WhatsApp number ────────────
  async function handleSendOtp(e) {
    e.preventDefault();
    if (phone.replace(/\D/g,'').length !== 10) { setError('Enter a valid 10-digit WhatsApp number'); return; }
    setSending(true); setError('');
    try {
      await sendOtp(`91${phone.replace(/\D/g,'').slice(0,10)}`);
      setOtpSent(true);
    } catch (err) {
      setError(err.message || 'Could not send the code. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // ── Recovery: step 2 — verify the OTP + set the new PIN (checked server-side) ─
  async function handleRecover(e) {
    e.preventDefault();
    if (code.replace(/\D/g,'').length !== 6) { setError('Enter the 6-digit code from WhatsApp'); return; }
    if (newPin.length !== 4)  { setError('New PIN must be exactly 4 digits'); return; }
    if (newPin !== confPin)   { setError('PINs do not match'); return; }
    setChecking(true); setError('');
    try {
      await resetPin(slug, newPin, `91${phone.replace(/\D/g,'').slice(0,10)}`, code.replace(/\D/g,''));
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  function switchMode(m) {
    setMode(m); setError('');
    setPin(''); setPhone(''); setOtpSent(false); setCode(''); setNewPin(''); setConfPin(''); setSuccess(false);
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-white">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/70 via-white to-white" />
      <div className="absolute -z-10 top-[-8rem] right-[-6rem] w-[24rem] h-[24rem] rounded-full bg-emerald-300/25 blur-3xl animate-pl-blob" />
      <div className="absolute -z-10 bottom-[-8rem] left-[-8rem] w-[22rem] h-[22rem] rounded-full bg-teal-300/20 blur-3xl animate-pl-blob" style={{ animationDelay: '5s' }} />

      <div className="relative bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 p-8 w-full max-w-sm animate-pl-fade-up">

        {/* Icon */}
        <div className="w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100/60 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-amber-100">
          <Lock size={24} className="text-amber-600" />
        </div>

        {/* ── LOGIN MODE ───────────────────────────────────────────────────── */}
        {mode === 'login' && (
          <>
            <h1 className="text-xl font-extrabold text-gray-900 text-center mb-1">Page Management</h1>
            <p className="text-sm text-gray-500 text-center mb-6">Enter your 4-digit PIN to continue</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="number" inputMode="numeric" placeholder="• • • •"
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g,'').slice(0,4)); setError(''); }}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center
                           text-2xl font-bold tracking-widest text-gray-900 bg-white
                           focus:outline-none focus:ring-2 focus:ring-gray-300"
                autoFocus
              />
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <button type="submit" disabled={checking}
                      className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm
                                 hover:bg-gray-700 transition-colors disabled:opacity-60">
                {checking ? 'Checking…' : 'Unlock →'}
              </button>
            </form>

            <button type="button" onClick={() => switchMode('recover')}
                    className="w-full mt-4 text-sm text-amber-600 hover:text-amber-800
                               font-medium transition-colors text-center">
              Forgot PIN? Reset it →
            </button>
          </>
        )}

        {/* ── RECOVERY MODE ────────────────────────────────────────────────── */}
        {mode === 'recover' && !success && (
          <>
            <h1 className="text-xl font-extrabold text-gray-900 text-center mb-1">Reset Your PIN</h1>
            <p className="text-sm text-gray-500 text-center mb-6">
              {otpSent
                ? 'Enter the 6-digit code we sent on WhatsApp, then set a new PIN.'
                : 'We’ll send a one-time code to the WhatsApp number linked to this page.'}
            </p>

            {/* Step 1 — number → send OTP */}
            {!otpSent && (
              <form onSubmit={handleSendOtp} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    WhatsApp Number (linked to store)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">+91</span>
                    <input
                      type="tel" inputMode="numeric" placeholder="98765 43210" maxLength={10}
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value.replace(/\D/g,'').slice(0,10)); setError(''); }}
                      className="w-full pl-12 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm
                                 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                      autoFocus
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-500 text-center bg-red-50 rounded-xl px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={sending}
                        className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm
                                   hover:bg-gray-700 transition-colors disabled:opacity-60 mt-1">
                  {sending ? 'Sending code…' : 'Send code on WhatsApp →'}
                </button>
              </form>
            )}

            {/* Step 2 — OTP + new PIN */}
            {otpSent && (
              <form onSubmit={handleRecover} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">6-digit code</label>
                  <input
                    type="number" inputMode="numeric" placeholder="• • • • • •"
                    value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g,'').slice(0,6)); setError(''); }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-center
                               text-xl font-bold tracking-[0.3em] text-gray-900 bg-white
                               focus:outline-none focus:ring-2 focus:ring-gray-300"
                    autoFocus
                  />
                  <button type="button" onClick={handleSendOtp} disabled={sending}
                          className="mt-1.5 text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                    {sending ? 'Resending…' : 'Resend code'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">New PIN</label>
                  <input
                    type="number" inputMode="numeric" placeholder="• • • •"
                    value={newPin}
                    onChange={(e) => { setNewPin(e.target.value.replace(/\D/g,'').slice(0,4)); setError(''); }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-center
                               text-xl font-bold tracking-widest text-gray-900 bg-white
                               focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm New PIN</label>
                  <input
                    type="number" inputMode="numeric" placeholder="• • • •"
                    value={confPin}
                    onChange={(e) => { setConfPin(e.target.value.replace(/\D/g,'').slice(0,4)); setError(''); }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-center
                               text-xl font-bold tracking-widest text-gray-900 bg-white
                               focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-500 text-center bg-red-50 rounded-xl px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={checking}
                        className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm
                                   hover:bg-gray-700 transition-colors disabled:opacity-60 mt-1">
                  {checking ? 'Verifying…' : 'Reset PIN →'}
                </button>
              </form>
            )}

            <button type="button" onClick={() => switchMode('login')}
                    className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors text-center">
              ← Back to login
            </button>
          </>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────────────── */}
        {mode === 'recover' && success && (
          <div className="text-center space-y-4">
            <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle2 size={28} className="text-green-500" />
            </div>
            <h2 className="text-lg font-extrabold text-gray-900">PIN Reset!</h2>
            <p className="text-sm text-gray-500">Your new PIN has been saved. Use it to log in.</p>
            <button type="button" onClick={() => switchMode('login')}
                    className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm
                               hover:bg-gray-700 transition-colors">
              Login with new PIN →
            </button>
          </div>
        )}

        {/* Back to store link */}
        {!(mode === 'recover' && success) && (
          <Link to={`/${slug}`}
                className="flex items-center justify-center gap-1.5 mt-5
                           text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={14} /> Back to page
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Products Tab ─────────────────────────────────────────────────────────────
function ManageProducts({ config, onChange, onSave, saveStatus, saveError }) {
  const themeColor  = config.theme?.primary || '#0d9488';
  const userCats    = (config.categories || []).filter(c => c.id !== 'all');
  const products    = config.products || [];
  const plan        = effectivePlan(config);
  const limits      = getPlanLimits(plan);
  const atProdLimit = !canAddProduct(plan, products.length);

  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [showVariants,  setShowVariants]  = useState(false);
  const [form,          setForm]          = useState(EMPTY_PROD);
  const [editingId,     setEditingId]     = useState(null);
  const [errors,        setErrors]        = useState({});
  const [dirty,         setDirty]         = useState(false);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiNote,        setAiNote]        = useState('');

  function resetForm() { setForm(EMPTY_PROD); setEditingId(null); setErrors({}); setAiNote(''); setDrawerOpen(false); }

  // ✨ AI Auto-fill — suggest category, a priced variant axis and attributes
  // from the product name (+ image). Owner fills prices/values; never blocks.
  async function autoFill() {
    const name = form.name.trim();
    if (!name || aiLoading) return;
    setAiLoading(true); setAiNote('');
    const res = await suggestProductDetails({
      slug: config.slug, name, image: form.image || undefined,
      categories: userCats.map((c) => c.label),
    });
    setAiLoading(false);
    if (res.error) {
      setAiNote(res.error === 'AI Auto-fill is available on paid plans.'
        ? 'Auto-fill is available on a paid plan.'
        : 'Couldn’t suggest details right now — please try again.');
      return;
    }
    const match = userCats.find((c) => c.label.toLowerCase() === String(res.category || '').toLowerCase());
    const attributes = (res.attributes || []).map((a) => ({ key: a.key, label: a.label, options: a.options, value: '' }));
    if (res.variant) setShowVariants(true);
    setForm((p) => ({
      ...p,
      category: match ? match.id : p.category,
      ...(res.variant
        ? { variantLabel: res.variant.label, variantOptions: res.variant.options.map((n) => ({ name: n, price: '', mrp: '' })) }
        : {}),
      attributes,
    }));
    const parts = [];
    if (res.variant) parts.push(`${res.variant.label} options (add prices)`);
    if (attributes.length) parts.push(`${attributes.length} detail${attributes.length === 1 ? '' : 's'}`);
    setAiNote(
      (match ? `Category set to “${match.label}”. ` : res.category ? `Suggested category “${res.category}” — add it in Categories. ` : '') +
      (parts.length ? `Filled ${parts.join(' + ')}.` : 'No extra details suggested.'),
    );
  }

  function openAdd() {
    setForm(EMPTY_PROD);
    setEditingId(null);
    setErrors({});
    setShowVariants(false);
    setDrawerOpen(true);
  }

  function openEdit(product) {
    const unitIsStandard = STANDARD_UNITS.includes(product.unit);
    setForm({
      name:        product.name        || '',
      category:    product.category    || '',
      price:       product.price       || '',
      mrp:         product.mrp         || '',
      unit:        unitIsStandard ? product.unit : 'Other…',
      unitCustom:  unitIsStandard ? '' : (product.unit || ''),
      description: product.description || '',
      image:       product.image       || '',
      gstRate:     product.gstRate != null ? product.gstRate : '',
      taxMode:     product.taxInclusive === true ? 'inclusive' : product.taxInclusive === false ? 'exclusive' : '',
      variantLabel:   product.variants?.label || '',
      variantOptions: product.variants?.options ? product.variants.options.map(o => ({ name: o.name, price: o.price ?? '', mrp: o.mrp ?? '' })) : [],
      attributes:     Array.isArray(product.attributes) ? product.attributes.map(a => ({ key: a.key, label: a.label, options: a.options || [], value: a.value ?? '' })) : [],
    });
    setEditingId(product.id);
    setErrors({});
    setAiNote('');
    setShowVariants(!!(product.variants?.label && product.variants?.options?.length > 0));
    setDrawerOpen(true);
  }

  function validate() {
    const e = {};
    if (!form.name.trim())             e.name     = 'Product name is required.';
    if (!form.category)                e.category = 'Please select a category.';
    if (!form.price || Number(form.price) <= 0) e.price = 'Enter a valid price.';

    // Variants: once the seller starts adding them, each option needs a name AND
    // its own price. Otherwise a blank price silently falls back to the main
    // price, so every option (250 g, 500 g…) would show the main 1 kg price.
    const startedVariants = showVariants && (form.variantLabel.trim() || (form.variantOptions || []).some(o => String(o.name || '').trim() || (o.price !== '' && o.price != null)));
    if (startedVariants) {
      const opts = form.variantOptions || [];
      if (!form.variantLabel.trim())                       e.variants = 'Name the option type (e.g. Size, Weight).';
      else if (!opts.length)                               e.variants = 'Add at least one option, or remove variants.';
      else if (opts.some(o => !String(o.name || '').trim())) e.variants = 'Give every option a name.';
      else if (opts.some(o => o.price === '' || o.price == null || !(Number(o.price) > 0)))
        e.variants = 'Set a price for every option — otherwise they all show the main price.';
    }
    return e;
  }

  function submitProduct() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const finalUnit  = form.unit === 'Other…' ? (form.unitCustom.trim() || 'per piece') : form.unit;
    const finalImage = form.image?.trim() || '';
    const cleanOpts  = (form.variantOptions || [])
      .map(o => ({
        name:  String(o.name || '').trim(),
        price: (o.price === '' || o.price == null) ? null : Number(o.price),
        mrp:   (o.mrp === '' || o.mrp == null) ? null : Number(o.mrp),
      }))
      .filter(o => o.name);
    const variants   = (form.variantLabel.trim() && cleanOpts.length)
      ? { label: form.variantLabel.trim(), options: cleanOpts } : null;
    // Descriptive attributes (AI-suggested or manual) — only keep ones with a value.
    const attributes = (form.attributes || [])
      .filter(a => a.value != null && String(a.value).trim())
      .map(a => ({ key: a.key, label: a.label, value: String(a.value).trim() }));
    // Per-product GST: '' means "use the store default rate" → store undefined.
    const gstRate    = form.gstRate === '' || form.gstRate == null ? undefined : Number(form.gstRate);
    // Per-product inclusive/exclusive override — only meaningful alongside a
    // custom rate; '' (Same as store) and the no-custom-rate case store undefined.
    const taxInclusive = gstRate == null ? undefined
      : form.taxMode === 'inclusive' ? true
      : form.taxMode === 'exclusive' ? false
      : undefined;

    let newProducts;
    if (editingId !== null) {
      newProducts = products.map(p =>
        p.id === editingId
          ? { ...p, name:form.name.trim(), category:form.category,
              price:Number(form.price),
              mrp:form.mrp && Number(form.mrp) > Number(form.price) ? Number(form.mrp) : undefined,
              unit:finalUnit, description:form.description.trim(), image:finalImage || p.image, gstRate, taxInclusive, variants, attributes }
          : p
      );
    } else {
      const maxId = products.length ? Math.max(...products.map(p => p.id || 0)) : 0;
      newProducts = [...products, {
        id:          maxId + 1,
        name:        form.name.trim(),
        category:    form.category,
        description: form.description.trim(),
        image:       finalImage || '',
        price:       Number(form.price),
        mrp:         form.mrp && Number(form.mrp) > Number(form.price) ? Number(form.mrp) : undefined,
        unit:        finalUnit,
        gstRate,
        taxInclusive,
        variants,
        attributes,
        badge:       null,
        badgeColor:  null,
      }];
    }
    onChange({ products: newProducts });
    setDirty(true);
    resetForm();
  }

  function removeProduct(id) {
    onChange({ products: products.filter(p => p.id !== id) });
    setDirty(true);
    if (editingId === id) resetForm();
  }

  function toggleStock(id) {
    onChange({
      products: products.map(p =>
        p.id === id ? { ...p, inStock: p.inStock === false } : p
      ),
    });
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    onSave();
  }

  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-extrabold text-gray-900">Products</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{products.length}</span>
        </div>
        {atProdLimit ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
              Limit: {limits.products} products
            </span>
            <a href="/plans"
               onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
               className="text-xs font-bold text-white px-2.5 py-1.5 rounded-lg transition-colors"
               style={{ backgroundColor: themeColor }}>
              Upgrade →
            </a>
          </div>
        ) : (
          <button type="button" onClick={openAdd}
                  className="flex items-center gap-1.5 text-sm font-bold px-3.5 py-2 rounded-xl
                             text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
                  style={{ backgroundColor: themeColor }}>
            <Plus size={15} strokeWidth={2.5} /> Add Product
          </button>
        )}
      </div>

      {/* Empty state */}
      {products.length === 0 && (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-300 shadow-sm">
            <Package size={22} />
          </div>
          <p className="text-sm font-semibold text-gray-700">No products yet</p>
          <p className="text-xs text-gray-400 mt-1">Tap “Add Product” to put your first item on the page.</p>
        </div>
      )}

      <div className="space-y-2">
        {products.map(p => {
          const cat = userCats.find(c => c.id === p.category);
          const isEditing = editingId === p.id;
          return (
            <div key={p.id}
                 className={['flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors border',
                   isEditing ? '' : 'bg-white border-gray-100 hover:border-gray-200'].join(' ')}
                 style={isEditing ? { backgroundColor: `${themeColor}0d`, borderColor: `${themeColor}55` } : undefined}>
              {p.image ? (
                <img src={p.image} alt={p.name}
                     className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300">
                  <ImagePlus size={16} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                <p className="text-xs text-gray-400">
                  {cat ? `${cat.emoji} ${cat.label}` : '—'} · ₹{p.price} · {p.unit}
                </p>
              </div>
              {/* In-stock toggle */}
              <button type="button" onClick={() => toggleStock(p.id)}
                      title={p.inStock === false ? 'Mark as in stock' : 'Mark as out of stock'}
                      className={[
                        'text-[10px] font-bold px-2 py-1 rounded-lg transition-colors flex-shrink-0',
                        p.inStock === false
                          ? 'bg-red-50 text-red-500 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100',
                      ].join(' ')}>
                {p.inStock === false ? 'Out of stock' : 'In stock'}
              </button>
              <button type="button" onClick={() => openEdit(p)}
                      className="p-1.5 rounded-lg transition-colors flex-shrink-0 text-gray-300 hover:text-gray-700 hover:bg-gray-100"
                      style={isEditing ? { color: themeColor, backgroundColor: `${themeColor}1a` } : undefined}>
                <Pencil size={13} />
              </button>
              <button type="button" onClick={() => removeProduct(p.id)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Product Form Drawer ─────────────────────────────────────────────
          Portaled to <body>: the section card uses animate-pl-fade-up, whose
          `both` fill-mode leaves a transform that would otherwise trap this
          fixed-position drawer inside the card. ─────────────────────────────*/}
      {typeof document !== 'undefined' && createPortal(
        <>
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-200',
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={resetForm}
      />
      {/* Drawer panel — slides in from the right (opposite the nav menu) */}
      {drawerOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col animate-pl-slide-in-right">
          {/* Branded header */}
          <div className="flex-shrink-0 flex items-start justify-between px-5 py-4 text-white"
               style={{ background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}>
            <div className="min-w-0">
              <p className="text-lg font-extrabold leading-tight">
                {editingId !== null ? 'Edit Product' : 'New Product'}
              </p>
              <p className="text-xs text-white/75 mt-0.5">
                {editingId !== null ? 'Update the details below' : 'Add an item to your page'}
              </p>
            </div>
            <button type="button" onClick={resetForm} aria-label="Close"
                    className="p-2 -mr-1 -mt-0.5 rounded-lg text-white/90 hover:bg-white/15 transition-colors flex-shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Scrollable, sectioned form body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 bg-gray-50/40">

            <FormSection title="Basics">
              <div>
                <label className={FIELD_LABEL}>Product Name <span className="text-red-500">*</span></label>
                <input type="text" autoFocus placeholder="e.g. 65W GaN Charger"
                       value={form.name}
                       onChange={e => { setForm(p => ({...p, name:e.target.value})); setErrors(p => ({...p, name:''})); }}
                       className={iCls(errors.name)} />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
                {/* ✨ AI Auto-fill — category + variant + attributes from the name */}
                <button type="button" onClick={autoFill} disabled={!form.name.trim() || aiLoading}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 active:scale-95 transition-transform"
                  style={{ backgroundColor: themeColor }}>
                  {aiLoading
                    ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Thinking…</>
                    : <><Star size={13} /> Auto-fill details</>}
                </button>
                {aiNote && <p className="mt-1.5 text-[11px] text-gray-500 leading-snug">{aiNote}</p>}
              </div>
              <div>
                <label className={FIELD_LABEL}>Category <span className="text-red-500">*</span></label>
                <select value={form.category}
                        onChange={e => { setForm(p => ({...p, category:e.target.value})); setErrors(p => ({...p, category:''})); }}
                        className={iCls(errors.category)}>
                  <option value="">Select category…</option>
                  {userCats.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                </select>
                {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category}</p>}
              </div>
            </FormSection>

            <FormSection title="Pricing">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD_LABEL}>Price <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                    <input type="number" inputMode="numeric" min="0" placeholder="349"
                           value={form.price}
                           onChange={e => { setForm(p => ({...p, price:e.target.value})); setErrors(p => ({...p, price:''})); }}
                           className={[iCls(errors.price), 'pl-7'].join(' ')} />
                  </div>
                  {errors.price && <p className="mt-1 text-xs text-red-500">{errors.price}</p>}
                </div>
                <div>
                  <label className={FIELD_LABEL}>MRP <span className="text-gray-400 font-normal">· optional</span></label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                    <input type="number" inputMode="numeric" min="0" placeholder="499"
                           value={form.mrp}
                           onChange={e => setForm(p => ({...p, mrp:e.target.value}))}
                           className={[iCls(false), 'pl-7'].join(' ')} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD_LABEL}>Sold by</label>
                  <select value={form.unit}
                          onChange={e => setForm(p => ({...p, unit:e.target.value, unitCustom:''}))}
                          className={iCls(false)}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className={FIELD_LABEL}>GST rate</label>
                  <select value={form.gstRate}
                          onChange={e => setForm(p => ({...p, gstRate:e.target.value}))}
                          className={iCls(false)}>
                    <option value="">Store default ({Math.round((config.cart?.taxRate ?? 0.05) * 100)}%)</option>
                    <option value={0}>0% — No GST</option>
                    <option value={0.05}>5%</option>
                    <option value={0.12}>12%</option>
                    <option value={0.18}>18%</option>
                    <option value={0.28}>28%</option>
                  </select>
                </div>
              </div>
              {form.unit === 'Other…' && (
                <input type="text" placeholder="e.g. per roll, per bundle"
                       value={form.unitCustom}
                       onChange={e => setForm(p => ({...p, unitCustom:e.target.value}))}
                       className={iCls(false)} />
              )}
              {form.gstRate !== '' && (
                <div>
                  <label className={FIELD_LABEL}>This item's GST is…</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: '',          t: 'Same as store' },
                      { v: 'inclusive', t: 'Included' },
                      { v: 'exclusive', t: 'Extra' },
                    ].map(opt => {
                      const active = form.taxMode === opt.v;
                      return (
                        <button key={opt.v || 'def'} type="button"
                          onClick={() => setForm(p => ({ ...p, taxMode: opt.v }))}
                          className={['rounded-xl border px-2 py-2 text-xs font-semibold transition-all active:scale-95',
                            active ? 'text-white border-transparent shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'].join(' ')}
                          style={active ? { backgroundColor: themeColor } : undefined}>
                          {opt.t}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
                    Whether this item's price already includes its GST or has it added at checkout. “Same as store” follows your Settings.
                  </p>
                </div>
              )}
            </FormSection>

            <FormSection title="Details">
              <div>
                <label className={FIELD_LABEL}>Description <span className="text-gray-400 font-normal">· optional</span></label>
                <input type="text" placeholder="Short description"
                       value={form.description}
                       onChange={e => setForm(p => ({...p, description:e.target.value}))}
                       className={iCls(false)} />
              </div>
              <div>
                <label className={FIELD_LABEL}>Product Image <span className="text-gray-400 font-normal">· optional</span></label>
                <ImageUploader value={form.image} onChange={v => setForm(p => ({...p, image:v}))} />
              </div>
            </FormSection>

            <FormSection
              title="Variants"
              action={!showVariants && (
                <button type="button" onClick={() => setShowVariants(true)}
                  className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
                  <Plus size={12} /> Add
                </button>
              )}>
              {!showVariants ? (
                <p className="text-xs text-gray-400 -mt-1">
                  Add options like Size, Colour or Weight so customers pick one before ordering.
                </p>
              ) : (
                <div className="rounded-xl border border-gray-200 p-3.5 space-y-3 bg-white">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Variant type</p>
                    <input type="text" placeholder="e.g. Size, Colour, Weight"
                      value={form.variantLabel}
                      onChange={e => { setForm(p => ({ ...p, variantLabel: e.target.value })); setErrors(p => ({ ...p, variants: '' })); }}
                      className={iCls(false)} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Options — each with its own price &amp; MRP</p>
                    <div className="space-y-2">
                      {(form.variantOptions || []).map((o, i) => {
                        const setOpt = (patch) => { setForm(p => ({ ...p, variantOptions: p.variantOptions.map((x, idx) => idx === i ? { ...x, ...patch } : x) })); setErrors(p => ({ ...p, variants: '' })); };
                        return (
                        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5 space-y-2">
                          <div className="flex gap-2 items-center">
                            <input type="text" placeholder={`Option — e.g. ${['250 g','500 g','1 kg','2 kg'][i] || 'name'}`}
                              value={o.name}
                              onChange={e => setOpt({ name: e.target.value })}
                              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                            <button type="button" aria-label="Remove option"
                              onClick={() => setForm(p => ({ ...p, variantOptions: p.variantOptions.filter((_, idx) => idx !== i) }))}
                              className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₹</span>
                              <input type="number" inputMode="numeric" min={0} placeholder="Price *"
                                value={o.price}
                                onChange={e => setOpt({ price: e.target.value })}
                                className="w-full pl-6 pr-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                            </div>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₹</span>
                              <input type="number" inputMode="numeric" min={0} placeholder="MRP"
                                value={o.mrp}
                                onChange={e => setOpt({ mrp: e.target.value })}
                                className="w-full pl-6 pr-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, variantOptions: [...(p.variantOptions || []), { name: '', price: '', mrp: '' }] }))}
                      className="inline-flex items-center gap-1 text-xs font-bold transition-colors hover:opacity-80"
                      style={{ color: themeColor }}>
                      <Plus size={13} /> Add option
                    </button>
                    <button type="button"
                      onClick={() => { setForm(p => ({ ...p, variantLabel: '', variantOptions: [] })); setShowVariants(false); }}
                      className="text-xs font-semibold text-red-400 hover:text-red-600">
                      Remove
                    </button>
                  </div>
                  {errors.variants && (
                    <p className="text-xs text-red-500 font-medium">{errors.variants}</p>
                  )}
                  <p className="text-[11px] text-gray-400 leading-relaxed">Set a price for each option (e.g. 250 g → ₹30, 500 g → ₹55). MRP is optional — add it to show a strike-through &amp; “You save” for that size.</p>
                </div>
              )}
            </FormSection>

            {/* Attributes (AI-suggested or manual) — buyer-facing details */}
            {form.attributes.length > 0 && (
              <FormSection title="Details">
                {form.attributes.map((a, i) => {
                  const setVal = (v) => setForm(p => ({ ...p, attributes: p.attributes.map((x, idx) => idx === i ? { ...x, value: v } : x) }));
                  return (
                    <div key={`${a.key}-${i}`}>
                      <label className={FIELD_LABEL}>{a.label}</label>
                      <div className="flex gap-2">
                        {a.options?.length ? (
                          <select value={a.value} onChange={e => setVal(e.target.value)} className={iCls(false)}>
                            <option value="">Select {a.label.toLowerCase()}…</option>
                            {a.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type="text" value={a.value} onChange={e => setVal(e.target.value)} className={iCls(false)} />
                        )}
                        <button type="button" aria-label="Remove detail"
                          onClick={() => setForm(p => ({ ...p, attributes: p.attributes.filter((_, idx) => idx !== i) }))}
                          className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-red-500 flex-shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </FormSection>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 bg-white flex gap-3">
            <button type="button" onClick={resetForm}
                    className="px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={submitProduct}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 active:scale-[0.99] transition-all"
                    style={{ backgroundColor: themeColor }}>
              {editingId !== null ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </div>
      )}
        </>,
        document.body,
      )}

      <SaveBar
        status={saveStatus} error={saveError}
        onSave={handleSave} dirty={dirty}
        themeColor={themeColor}
      />
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────
function ManageCategories({ config, onChange, onSave, saveStatus, saveError }) {
  const themeColor = config.theme?.primary || '#0d9488';
  const userCats   = (config.categories || []).filter(c => c.id !== 'all');
  const plan       = effectivePlan(config);
  const limits     = getPlanLimits(plan);
  const atCatLimit = !canAddCategory(plan, userCats.length);

  const [activeForm,  setActiveForm]  = useState(null);
  const [form,        setForm]        = useState(EMPTY_CAT);
  const [editingId,   setEditingId]   = useState(null);
  const [catError,    setCatError]    = useState('');
  const [dirty,       setDirty]       = useState(false);

  function resetForm() { setForm(EMPTY_CAT); setEditingId(null); setCatError(''); setActiveForm(null); }

  function openAdd() {
    setForm(EMPTY_CAT); setEditingId(null); setCatError(''); setActiveForm('category');
  }

  function openEdit(cat) {
    setForm({ emoji: cat.emoji, label: cat.label });
    setEditingId(cat.id);
    setCatError('');
    setActiveForm('category');
  }

  function submitCategory() {
    if (!form.label.trim()) { setCatError('Category name is required.'); return; }

    let newCats;
    if (editingId !== null) {
      newCats = userCats.map(c =>
        c.id === editingId ? { ...c, label: form.label.trim(), emoji: form.emoji } : c
      );
    } else {
      const id = form.label.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9]/g,'') || `cat${Date.now()}`;
      newCats = [...userCats, { id, label: form.label.trim(), emoji: form.emoji }];
    }

    // Always keep 'all' at front
    onChange({ categories: [{ id:'all', label:'All Products', emoji:'🛒' }, ...newCats] });
    setDirty(true);
    resetForm();
  }

  function removeCategory(id) {
    const newCats = userCats.filter(c => c.id !== id);
    // Also clear category from products that were in this category
    const newProducts = (config.products || []).map(p =>
      p.category === id ? { ...p, category: '' } : p
    );
    onChange({
      categories: [{ id:'all', label:'All Products', emoji:'🛒' }, ...newCats],
      products:   newProducts,
    });
    setDirty(true);
    if (editingId === id) resetForm();
  }

  function handleSave() {
    setDirty(false);
    onSave();
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-extrabold text-gray-900">Categories</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{userCats.length}</span>
        </div>
        {activeForm !== 'category' && (
          atCatLimit ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                Limit: {limits.categories} categor{limits.categories === 1 ? 'y' : 'ies'}
              </span>
              <a href="/plans"
                 onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
                 className="text-xs font-bold text-white px-2.5 py-1.5 rounded-lg transition-colors"
                 style={{ backgroundColor: themeColor }}>
                Upgrade →
              </a>
            </div>
          ) : (
            <button type="button" onClick={openAdd}
                    className="flex items-center gap-1.5 text-sm font-bold px-3.5 py-2 rounded-xl
                               text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
                    style={{ backgroundColor: themeColor }}>
              <Plus size={15} strokeWidth={2.5} /> Add Category
            </button>
          )
        )}
      </div>

      {userCats.length === 0 && activeForm !== 'category' && (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-300 shadow-sm">
            <Tag size={22} />
          </div>
          <p className="text-sm font-semibold text-gray-700">No categories yet</p>
          <p className="text-xs text-gray-400 mt-1">Group your products so customers can browse easily.</p>
        </div>
      )}

      {/* Category list */}
      <div className="space-y-2">
        {userCats.map(cat => {
          const productCount = (config.products || []).filter(p => p.category === cat.id).length;
          const isEditing = editingId === cat.id;
          return (
            <div key={cat.id}
                 className={['flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors border',
                   isEditing ? '' : 'bg-white border-gray-100 hover:border-gray-200'].join(' ')}
                 style={isEditing ? { backgroundColor: `${themeColor}0d`, borderColor: `${themeColor}55` } : undefined}>
              <span className="text-xl flex-shrink-0">{cat.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
                <p className="text-xs text-gray-400">{productCount} product{productCount !== 1 ? 's' : ''}</p>
              </div>
              <button type="button" onClick={() => openEdit(cat)}
                      className="p-1.5 rounded-lg transition-colors flex-shrink-0 text-gray-300 hover:text-gray-700 hover:bg-gray-100"
                      style={isEditing ? { color: themeColor, backgroundColor: `${themeColor}1a` } : undefined}>
                <Pencil size={13} />
              </button>
              <button type="button" onClick={() => removeCategory(cat.id)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Inline category form */}
      {activeForm === 'category' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {editingId !== null ? 'Edit Category' : 'New Category'}
          </p>

          <div>
            <p className="text-xs text-gray-500 mb-1.5">Pick an icon</p>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 rounded-lg bg-white border border-gray-100">
              {CAT_EMOJIS.map(e => (
                <button key={e} type="button" onClick={() => setForm(p => ({...p, emoji:e}))}
                        className={[
                          'w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all',
                          form.emoji === e ? 'bg-gray-900' : 'bg-white border border-gray-200 hover:bg-gray-100',
                        ].join(' ')}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <input type="text" autoFocus placeholder="Category name (e.g. Chargers, Towels)"
                   value={form.label}
                   onChange={e => { setForm(p => ({...p, label:e.target.value})); setCatError(''); }}
                   onKeyDown={e => e.key === 'Enter' && submitCategory()}
                   className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <button type="button" onClick={submitCategory}
                    className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700">
              {editingId !== null ? 'Update' : 'Add'}
            </button>
            <button type="button" onClick={resetForm}
                    className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          {catError && <p className="text-xs text-red-500">{catError}</p>}
        </div>
      )}

      <SaveBar
        status={saveStatus} error={saveError}
        onSave={handleSave} dirty={dirty}
        themeColor={themeColor}
      />
    </div>
  );
}

// ── Business Hours editor ───────────────────────────────────────────────────
function HoursEditor({ value, onChange, themeColor }) {
  const hours = normaliseHours(value);
  const status = getStoreStatus(hours);

  function setEnabled(enabled) {
    // Seed sensible defaults the first time the owner switches hours on.
    onChange(enabled && !value ? { ...defaultHours(), enabled: true } : { ...hours, enabled });
  }

  function setDay(idx, partial) {
    onChange({ ...hours, days: { ...hours.days, [idx]: { ...hours.days[idx], ...partial } } });
  }

  function applyToAll(idx) {
    const src = hours.days[idx];
    const days = {};
    for (let i = 0; i < 7; i++) days[i] = { ...hours.days[i], open: src.open, close: src.close, closed: src.closed };
    onChange({ ...hours, days });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-gray-100" />
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Business Hours</span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>

      {/* Master toggle */}
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="text-sm font-semibold text-gray-700">
          Show open / closed status on your page
          <span className="block text-xs font-normal text-gray-400 mt-0.5">
            A live badge tells customers if you're open right now (India time).
          </span>
        </span>
        <button type="button" role="switch" aria-checked={hours.enabled}
                onClick={() => setEnabled(!hours.enabled)}
                className={['relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                  hours.enabled ? '' : 'bg-gray-200'].join(' ')}
                style={hours.enabled ? { backgroundColor: themeColor } : undefined}>
          <span className={['absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
            hours.enabled ? 'translate-x-5' : ''].join(' ')} />
        </button>
      </label>

      {hours.enabled && (
        <>
          {/* Live preview */}
          {status && (
            <div className={['mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold',
              status.open ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'].join(' ')}>
              <span className={['w-1.5 h-1.5 rounded-full', status.open ? 'bg-emerald-500' : 'bg-gray-400'].join(' ')} />
              Right now: {status.label}{status.detail ? ` · ${status.detail}` : ''}
            </div>
          )}

          {/* Per-day rows (Mon-first) */}
          <div className="mt-3 space-y-1.5">
            {DAY_ORDER.map((idx) => {
              const d = hours.days[idx];
              return (
                <div key={idx} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <span className="w-20 text-xs font-semibold text-gray-600 flex-shrink-0">{DAY_FULL[idx]}</span>
                  <button type="button" onClick={() => setDay(idx, { closed: !d.closed })}
                          className={['text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 w-20 text-center',
                            d.closed ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                     : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'].join(' ')}>
                    {d.closed ? 'Closed' : 'Open'}
                  </button>
                  {d.closed ? (
                    <span className="text-xs text-gray-300 flex-1">—</span>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input type="time" value={d.open}
                             onChange={(e) => setDay(idx, { open: e.target.value })}
                             className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <span className="text-gray-300 text-xs">to</span>
                      <input type="time" value={d.close}
                             onChange={(e) => setDay(idx, { close: e.target.value })}
                             className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <button type="button" onClick={() => applyToAll(idx)} title="Copy these times to every day"
                              className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-gray-700 px-1.5 py-1 flex-shrink-0">
                        Copy to all
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Overnight hours work too — set a closing time earlier than the opening time (e.g. 6 PM → 2 AM).</p>
        </>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function ManageSettings({ config, onChange, onSave, saveStatus, saveError, onDelete }) {
  const themeColor  = config.theme?.primary || '#0d9488';
  const [dirty, setDirty] = useState(false);

  // Copy-link state for the store URL card
  const [copied, setCopied] = useState(false);
  function copyStoreUrl() {
    const url = `${window.location.origin}/${config.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Delete confirmation state
  const [showDelete, setShowDelete]   = useState(false);
  const [deletePin,  setDeletePin]    = useState('');
  const [deleteErr,  setDeleteErr]    = useState('');
  const [deleting,   setDeleting]     = useState(false);

  async function handleDelete(e) {
    e.preventDefault();
    if (deletePin.length !== 4) { setDeleteErr('Enter your 4-digit PIN'); return; }
    setDeleting(true); setDeleteErr('');
    const ok = await verifyPin(config.slug, deletePin);
    if (!ok) { setDeleteErr('Incorrect PIN.'); setDeleting(false); return; }
    try {
      await deleteStore(config.slug);
      onDelete();   // navigate away
    } catch (err) {
      setDeleteErr(err.message || 'Delete failed. Please try again.');
      setDeleting(false);
    }
  }

  // Derive the editable 10-digit local number by stripping the stored "91"
  // country-code prefix (not slice(-10), which leaks "91" back in while editing).
  const digits = (config.whatsappNumber || '').replace(/\D/g,'').replace(/^91/, '').slice(0, 10);

  function update(partial) {
    onChange(partial);
    setDirty(true);
  }

  function updateTheme(hex) {
    const theme = THEME_PRESETS[hex] ?? THEME_PRESETS['#0d9488'];
    onChange({ theme });
    setDirty(true);
  }

  function updatePhone(val) {
    // Strip any leading 91 the user pastes, then keep the 10-digit local number.
    const d = val.replace(/\D/g,'').replace(/^91(?=\d{10})/, '').slice(0,10);
    const formatted = d.length === 10 ? `+91 ${d.slice(0,5)} ${d.slice(5)}` : (d ? `+91 ${d}` : '');
    // Store empty when cleared (don't force a bare "91"), so the field can be emptied.
    onChange({ whatsappNumber: d ? `91${d}` : '', phone: formatted });
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    onSave();
  }

  function lCls(label) {
    return 'block text-xs font-semibold text-gray-700 mb-1.5';
  }

  const bankDetails = config.bank || {};

  return (
    <div className="space-y-6">

      {/* Share-your-store hero card */}
      <div className="relative rounded-2xl p-4 text-white overflow-hidden shadow-lg"
           style={{ background: `linear-gradient(135deg, ${themeColor}, ${themeColor}d0)` }}>
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(circle, #ffffff55 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/80 mb-1.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Your page is live — share it
          </p>
          <a
            href={`/${config.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-mono font-bold truncate hover:underline mb-3"
          >
            {window.location.origin}/{config.slug}
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyStoreUrl}
              title="Copy page link"
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg
                         bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors"
            >
              {copied ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Check out my page: ${window.location.origin}/${config.slug}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg
                         bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors"
            >
              Share on WhatsApp
            </a>
            <button
              type="button"
              onClick={() => openStorePoster(config)}
              title="Open a printable QR poster"
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg
                         bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors"
            >
              <QrCode size={13} /> QR Poster
            </button>
            <a
              href={`/${config.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg
                         bg-white hover:opacity-90 transition-opacity"
              style={{ color: themeColor }}
            >
              Open →
            </a>
          </div>
        </div>
      </div>

      {/* Remove-branding upsell — shown only on the Free plan */}
      {showBrandBadge(effectivePlan(config)) && (
        <a href="/plans"
           onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
           className="block rounded-2xl border p-4 transition-opacity hover:opacity-90"
           style={{ borderColor: `${themeColor}33`, background: `${themeColor}0d` }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">✨ Make it 100% your brand</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                Remove the “Powered by PocketLink” badge — from ₹249/mo (about ₹8/day).
              </p>
            </div>
            <span className="text-xs font-bold text-white px-3 py-2 rounded-lg flex-shrink-0"
                  style={{ backgroundColor: themeColor }}>
              Upgrade →
            </span>
          </div>
        </a>
      )}

      {/* Promo banner moved to the Offers tab (Offers → Announcement banner) */}

      {/* Business Info */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Business Info</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="space-y-3">
          <div>
            <label className={lCls()}>Business Name</label>
            <input type="text" value={config.businessName || ''}
                   onChange={e => update({
                     businessName: e.target.value,
                     hero: { ...config.hero, heading: e.target.value },
                   })}
                   className={iCls(false)} />
          </div>

          <div>
            <label className={lCls()}>Tagline / Description</label>
            <textarea rows={2} maxLength={140}
                   placeholder="e.g. Fresh sweets made daily — order on WhatsApp"
                   value={config.tagline || ''}
                   onChange={e => update({ tagline: e.target.value })}
                   className={[iCls(false), 'resize-none'].join(' ')} />
            <p className="mt-1 text-xs text-gray-400">
              Shown under your business name on your page and in shared link previews. {(config.tagline || '').length}/140
            </p>
          </div>

          <div>
            <label className={lCls()}>WhatsApp Number</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">+91</span>
              <input type="tel" inputMode="numeric" maxLength={10} placeholder="98765 43210"
                     value={digits}
                     onChange={e => updatePhone(e.target.value)}
                     className={[iCls(false), 'pl-12'].join(' ')} />
            </div>
            <p className="mt-1 text-xs text-gray-400">Orders will be sent to this number.</p>
          </div>

          {/* Store icon (logoEmoji) */}
          <div>
            <label className={lCls()}>Business Icon</label>
            <IconPicker value={config.logoEmoji} onChange={(emoji) => update({ logoEmoji: emoji })} category={config.category} accent={themeColor} />
          </div>

          {/* Brand color */}
          <div>
            <label className={lCls()}>Brand Color</label>
            <div className="flex flex-wrap gap-3">
              {THEME_OPTIONS.map(({ hex, label }) => (
                <button key={hex} type="button" title={label}
                        onClick={() => updateTheme(hex)}
                        className={[
                          'w-9 h-9 rounded-full transition-all flex items-center justify-center',
                          config.theme?.primary === hex
                            ? 'ring-2 ring-offset-2 ring-gray-700 scale-110'
                            : 'hover:scale-105 opacity-80 hover:opacity-100',
                        ].join(' ')}
                        style={{ backgroundColor: hex }}>
                  {config.theme?.primary === hex && (
                    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-white" fill="none">
                      <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Logo & Cover */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Logo &amp; Cover</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={lCls()}>Logo Image <span className="text-gray-400 font-normal">(replaces the icon)</span></label>
            <ImageUploader value={config.logo || ''} onChange={v => update({ logo: v })} />
          </div>
          <div>
            <label className={lCls()}>Cover Photo</label>
            <ImageUploader value={config.coverImage || ''} onChange={v => update({ coverImage: v })} />
          </div>
        </div>
      </div>

      {/* Highlights (trust badges) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Highlights</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <p className="text-xs text-gray-400 mb-2.5">Trust badges shown on your page — tap to add or remove.</p>
        <div className="flex flex-wrap gap-2">
          {(FEATURE_SUGGESTIONS[config.businessType] ?? FEATURE_SUGGESTIONS.product).map(f => {
            const on = (config.features || []).some(x => x.title === f.title);
            return (
              <button key={f.title} type="button"
                onClick={() => {
                  const cur = config.features || [];
                  update({ features: on ? cur.filter(x => x.title !== f.title) : [...cur, f] });
                }}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all active:scale-95',
                  on ? 'text-white border-transparent shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                ].join(' ')}
                style={on ? { backgroundColor: themeColor } : {}}>
                <span className="text-base leading-none">{f.emoji}</span>
                {f.title}
                {on && <Check size={13} strokeWidth={3} className="ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Business Hours */}
      <HoursEditor value={config.hours} onChange={(hours) => update({ hours })} themeColor={themeColor} />

      {/* Location & Category */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Location &amp; Category</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <LocationPicker
          values={{ pincode: config.pincode, city: config.city, state: config.state, area: config.area, address: config.address }}
          onChange={update}
          accent={themeColor}
        />
        <div className="mt-3">
          <label className={lCls()}>Marketplace Category</label>
          <select value={config.category || ''}
            onChange={e => {
              const cat = e.target.value;
              update({ category: cat, ...((cat && (!config.logoEmoji || config.logoEmoji === '🏪')) ? { logoEmoji: defaultIcon(cat) } : {}) });
            }}
            className={iCls(false)}>
            <option value="">Auto (by business type)</option>
            {subcategoriesForType(config.businessType).map(({ id, emoji }) => (
              <option key={id} value={id}>{emoji} {id}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">How your business is filed on the marketplace.</p>
        </div>
      </div>

      {/* Pricing */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Pricing &amp; Delivery</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="space-y-3">
          <div>
            <label className={lCls()}>GST Rate</label>
            <select value={config.cart?.taxRate ?? 0.05}
                    onChange={e => update({ cart: { ...config.cart, taxRate: Number(e.target.value) } })}
                    className={iCls(false)}>
              <option value={0}>0% — No GST</option>
              <option value={0.05}>5% GST</option>
              <option value={0.12}>12% GST</option>
              <option value={0.18}>18% GST</option>
              <option value={0.28}>28% GST</option>
            </select>
          </div>

          {/* Inclusive vs exclusive — only relevant once a GST rate is set */}
          {(config.cart?.taxRate ?? 0.05) > 0 && (
            <div>
              <label className={lCls()}>Your listed prices…</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: true,  t: 'Include GST', d: 'Price is final' },
                  { v: false, t: 'GST extra',   d: 'Added at checkout' },
                ].map(opt => {
                  const active = !!config.cart?.taxInclusive === opt.v;
                  return (
                    <button key={String(opt.v)} type="button"
                      onClick={() => update({ cart: { ...config.cart, taxInclusive: opt.v } })}
                      className={['rounded-xl border px-3 py-2.5 text-left transition-all active:scale-[0.98]',
                        active ? 'text-white border-transparent shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'].join(' ')}
                      style={active ? { backgroundColor: themeColor } : undefined}>
                      <span className="block text-sm font-bold">{opt.t}</span>
                      <span className={['block text-[11px]', active ? 'text-white/80' : 'text-gray-400'].join(' ')}>{opt.d}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                <strong className="text-gray-500">Include GST</strong> — the listed price is the final price; GST is shown as already included.
                <strong className="text-gray-500"> GST extra</strong> — {Math.round((config.cart?.taxRate ?? 0.05) * 100)}% is added on top at checkout.
              </p>
            </div>
          )}

          <div>
            <label className={lCls()}>GST Number <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" placeholder="33XXXXX1234Z1Z5" maxLength={15}
                   value={config.gst || ''}
                   onChange={e => update({ gst: e.target.value.toUpperCase() })}
                   className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lCls()}>Delivery Charge (₹)</label>
              <input type="number" inputMode="numeric" min={0} placeholder="49"
                     value={config.cart?.shippingCharge ?? 49}
                     onChange={e => update({ cart: { ...config.cart, shippingCharge: Number(e.target.value) || 0 } })}
                     className={iCls(false)} />
            </div>
            <div>
              <label className={lCls()}>Free Delivery Above (₹)</label>
              <input type="number" inputMode="numeric" min={0} placeholder="999"
                     value={config.cart?.freeShippingAbove ?? 999}
                     onChange={e => update({ cart: { ...config.cart, freeShippingAbove: Number(e.target.value) || 0 } })}
                     className={iCls(false)} />
            </div>
          </div>
        </div>
      </div>

      {/* Payments */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Payment Details</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="space-y-3">
          <div>
            <label className={lCls()}>UPI ID <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" placeholder="yourname@upi"
                   value={config.upi || ''}
                   onChange={e => update({ upi: e.target.value.trim() })}
                   className={iCls(false)} />
          </div>

          <div>
            <label className={lCls()}>Bank Account Name</label>
            <input type="text" placeholder="Account Holder Name"
                   value={bankDetails.accountName || ''}
                   onChange={e => update({ bank: { ...bankDetails, accountName: e.target.value } })}
                   className={iCls(false)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lCls()}>Account Number</label>
              <input type="text" inputMode="numeric" placeholder="Account Number"
                     value={bankDetails.accountNumber || ''}
                     onChange={e => update({ bank: { ...bankDetails, accountNumber: e.target.value.replace(/\D/g,'') } })}
                     className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className={lCls()}>IFSC Code</label>
              <input type="text" placeholder="HDFC0001234" maxLength={11}
                     value={bankDetails.ifsc || ''}
                     onChange={e => update({ bank: { ...bankDetails, ifsc: e.target.value.toUpperCase().replace(/\s/g,'') } })}
                     className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
          </div>

          <div>
            <label className={lCls()}>Bank Name</label>
            <input type="text" placeholder="HDFC Bank, SBI…"
                   value={bankDetails.bankName || ''}
                   onChange={e => update({ bank: { ...bankDetails, bankName: e.target.value } })}
                   className={iCls(false)} />
          </div>
        </div>
      </div>

      <SaveBar
        status={saveStatus} error={saveError}
        onSave={handleSave} dirty={dirty}
        themeColor={themeColor}
      />

      {/* ── Danger Zone ───────────────────────────────────────────────────── */}
      <div className="border-t border-red-100 pt-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-red-100" />
          <span className="text-[10px] font-semibold text-red-400 uppercase tracking-widest">Danger Zone</span>
          <div className="h-px flex-1 bg-red-100" />
        </div>

        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 text-sm font-semibold text-red-500
                       hover:text-red-700 border border-red-200 hover:border-red-400
                       hover:bg-red-50 px-4 py-2.5 rounded-xl transition-all"
          >
            <Trash2 size={14} />
            Delete this page
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-red-800">⚠️ This action is permanent</p>
            <p className="text-xs text-red-600 leading-relaxed">
              Deleting your page will remove all products, categories, and settings from our database.
              This cannot be undone. Enter your PIN to confirm.
            </p>
            <form onSubmit={handleDelete} className="space-y-2">
              <input
                type="number" inputMode="numeric" placeholder="4-digit PIN"
                value={deletePin}
                onChange={e => { setDeletePin(e.target.value.replace(/\D/g,'').slice(0,4)); setDeleteErr(''); }}
                className="w-full px-3 py-2 border border-red-200 rounded-xl text-sm text-center
                           font-bold tracking-widest bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
                autoFocus
              />
              {deleteErr && <p className="text-xs text-red-600 text-center">{deleteErr}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowDelete(false); setDeletePin(''); setDeleteErr(''); }}
                        className="flex-1 py-2 rounded-xl border border-gray-200 text-sm font-semibold
                                   text-gray-500 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={deleting}
                        className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700
                                   text-white text-sm font-bold transition-colors disabled:opacity-60
                                   flex items-center justify-center gap-1.5">
                  {deleting ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Deleting…</>
                  ) : (
                    <><Trash2 size={13} /> Delete Page</>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ManageStore Page ─────────────────────────────────────────────────────
export default function ManageStore() {
  const { businessSlug }  = useParams();
  const navigate          = useNavigate();
  const [loading,     setLoading]     = useState(true);
  const [notFound,    setNotFound]    = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [storePin,    setStorePin]    = useState('');
  const [config,      setConfig]      = useState(null);
  const [tab,         setTab]         = useState('orders');
  const [menuOpen,    setMenuOpen]    = useState(false);   // left slide-out nav drawer
  const [saveStatus,  setSaveStatus]  = useState('idle');  // idle | saving | saved | error
  const [saveError,   setSaveError]   = useState('');
  const saveTimerRef = useRef(null);

  // Load store
  useEffect(() => {
    setLoading(true);
    loadBusiness(businessSlug).then(cfg => {
      if (cfg) setConfig(cfg);
      else     setNotFound(true);
      setLoading(false);
    });
  }, [businessSlug]);

  // The PIN→dashboard hand-off and tab switches happen on the same route, so the
  // global ScrollToTop never fires for them. On mobile the PIN field's autofocus
  // scrolls the page down, and that offset would otherwise carry into the
  // dashboard (top hidden until you scroll up). Reset to the top each time.
  useEffect(() => {
    if (pinVerified) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pinVerified, tab]);

  // Merge partial config updates
  function handleChange(partial) {
    setConfig(prev => ({ ...prev, ...partial }));
  }

  // After store is deleted — clear cache and go to homepage
  function handleStoreDeleted() {
    clearCachedStore(businessSlug);
    navigate('/');
  }

  // Save to Supabase (uploads any new base64 images first)
  async function handleSave() {
    setSaveStatus('saving');
    setSaveError('');
    try {
      // Upload any base64 images added during this session (products + logo + cover)
      const [uploadedProducts, uploadedLogo, uploadedCover] = await Promise.all([
        uploadConfigImages(config.products, businessSlug),
        uploadSingleImage(config.logo, businessSlug, 'logo'),
        uploadSingleImage(config.coverImage, businessSlug, 'cover'),
      ]);
      const finalConfig = { ...config, products: uploadedProducts, logo: uploadedLogo, coverImage: uploadedCover };

      await updateStore(businessSlug, finalConfig, storePin);
      setConfig(finalConfig);      // update state with Storage URLs
      cacheStore(finalConfig);
      setSaveStatus('saved');
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save. Please try again.');
      setSaveStatus('error');
    }
  }

  // ── Loading / not found ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/50 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-[3px] border-gray-200 border-t-gray-800 rounded-full animate-spin" />
        <p className="text-sm font-medium text-gray-400">Loading your page…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-white">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/60 via-white to-white" />
        <div className="absolute -z-10 top-[-6rem] right-[-6rem] w-96 h-96 rounded-full bg-emerald-300/20 blur-3xl animate-pl-blob" />
        <div className="text-center space-y-3 animate-pl-fade-up">
          <p className="text-5xl">🔍</p>
          <p className="text-xl font-extrabold text-gray-900">Page not found</p>
          <p className="text-sm text-gray-500">No page with slug “{businessSlug}” exists.</p>
          <Link to="/" className="inline-flex items-center gap-1.5 mt-3 bg-gray-900 hover:bg-gray-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors">
            <ArrowLeft size={14} /> Back to home
          </Link>
        </div>
      </div>
    );
  }

  // ── PIN Gate ───────────────────────────────────────────────────────────────
  if (!pinVerified) {
    return <PinGate slug={businessSlug} onVerified={(pin) => { setStorePin(pin); setPinVerified(true); }} />;
  }

  // ── Management Dashboard ──────────────────────────────────────────────────
  const themeColor = config.theme?.primary || '#0d9488';

  // Free-trial / renewal state (coupon-granted plans expire; see effectivePlan)
  const rawPlan    = config.plan || 'free';
  const daysLeft   = trialDaysLeft(config);
  const onTrial    = rawPlan !== 'free' && daysLeft !== null && daysLeft > 0;
  const trialEnded = rawPlan !== 'free' && config.planExpiresAt && effectivePlan(config) === 'free';
  const planName   = getPlanLimits(rawPlan).name;

  const analyticsEnabled  = !!getPlanLimits(effectivePlan(config)).analytics;
  const analyticsAdvanced = getPlanLimits(effectivePlan(config)).analytics === 'full';
  const aiInsightsEnabled = !!getPlanLimits(effectivePlan(config)).aiEmployee;
  const TABS = [
    { key: 'orders',     label: 'Orders',      icon: ShoppingBag },
    { key: 'customers',  label: 'Customers',   icon: Users },
    { key: 'analytics',  label: 'Stats',       icon: BarChart3 },
    { key: 'insights',   label: 'AI Insights', icon: Sparkles  },
    { key: 'reviews',    label: 'Reviews',     icon: Star      },
    { key: 'products',   label: 'Products',    icon: Package  },
    { key: 'categories', label: 'Categories',  icon: Tag      },
    { key: 'offers',     label: 'Offers',      icon: Percent  },
    { key: 'settings',   label: 'Settings',    icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/40">

      {/* ── Top bar (hamburger + current section title) ─────────────────────── */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center gap-3">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu"
                  className="p-2 -ml-2 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0">
            <Menu size={22} />
          </button>
          <p className="text-base font-extrabold text-gray-900 truncate flex-1">
            {TABS.find(t => t.key === tab)?.label || 'Manage'}
          </p>
          <Link to={`/${businessSlug}`}
                className="flex items-center gap-1.5 text-xs font-bold text-white
                           transition-all flex-shrink-0 rounded-lg px-3 py-2
                           hover:opacity-90 active:scale-95 shadow-sm"
                style={{ backgroundColor: themeColor }}>
            <ArrowLeft size={12} />
            View page
          </Link>
        </div>
      </header>

      {/* ── Free-trial / renewal banner ─────────────────────────────────────── */}
      {onTrial && (
        <div className="bg-emerald-600 text-white text-center text-xs font-semibold px-4 py-2">
          🎁 Free {planName} trial — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left.{' '}
          <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))} className="underline underline-offset-2">Subscribe to keep it →</a>
        </div>
      )}
      {trialEnded && (
        <div className="bg-amber-500 text-white text-center text-xs font-semibold px-4 py-2">
          Your free {planName} trial ended — page is on Free now.{' '}
          <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))} className="underline underline-offset-2">Renew {planName} →</a>
        </div>
      )}

      {/* ── Slide-out left nav drawer ───────────────────────────────────────── */}
      <div
        className={[
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-200',
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[82%] flex flex-col text-white shadow-2xl',
          'transition-transform duration-300 ease-out',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ background: `linear-gradient(180deg, ${themeColor}, ${themeColor}e0)` }}
      >
        {/* Profile header */}
        <div className="px-5 pt-7 pb-5">
          <div className="flex items-center gap-3">
            {config.logo ? (
              <img src={config.logo} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-white/50 flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl bg-white/15 ring-2 ring-white/40 flex-shrink-0">
                {config.logoEmoji || '🏪'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold leading-tight truncate">{config.businessName}</p>
              <p className="text-xs text-white/70 truncate">pocketlink.store/{businessSlug}</p>
            </div>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu"
                    className="p-1.5 rounded-lg text-white/80 hover:bg-white/15 transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="h-px bg-white/15 mx-5" />

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setMenuOpen(false); }}
                className={[
                  'w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-[15px] font-semibold transition-colors',
                  active ? 'bg-white/20 text-white' : 'text-white/85 hover:bg-white/10',
                ].join(' ')}>
                <Icon size={19} className="flex-shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>

        {/* Footer — lock the panel (re-asks for PIN) */}
        <div className="px-3 pb-6 pt-2 border-t border-white/15 mx-2">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setPinVerified(false); setStorePin(''); }}
            className="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-[15px] font-semibold text-white/85 hover:bg-white/10 transition-colors">
            <LogOut size={19} className="flex-shrink-0" />
            Lock & Exit
          </button>
        </div>
      </aside>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Reach hook — only on the Orders tab (the default landing). Settings has
            its own "share your page" hero and Stats has its own views number, so
            showing it everywhere would stack duplicate share cards. */}
        {tab === 'orders' && (
          <ReachCard slug={businessSlug} themeColor={themeColor} businessName={config.businessName}
                     upgrade={!analyticsEnabled} phone={config.whatsappNumber} />
        )}
        {tab === 'orders' ? (
          <div className="animate-pl-fade-up">
            <OrdersTab slug={businessSlug} pin={storePin} themeColor={themeColor} storeName={config.businessName} />
          </div>
        ) : tab === 'customers' ? (
          <div className="animate-pl-fade-up">
            <CustomersTab slug={businessSlug} pin={storePin} themeColor={themeColor} businessName={config.businessName} />
          </div>
        ) : tab === 'analytics' ? (
          <div className="animate-pl-fade-up">
            <AnalyticsTab slug={businessSlug} pin={storePin} themeColor={themeColor} enabled={analyticsEnabled} advanced={analyticsAdvanced} />
          </div>
        ) : tab === 'reviews' ? (
          <div className="animate-pl-fade-up">
            <ReviewsTab slug={businessSlug} pin={storePin} themeColor={themeColor} />
          </div>
        ) : tab === 'insights' ? (
          <div className="animate-pl-fade-up">
            <AiInsightsTab slug={businessSlug} pin={storePin} themeColor={themeColor}
                           enabled={aiInsightsEnabled} businessName={config.businessName} />
          </div>
        ) : (
        <div key={tab} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pl-fade-up">
          {tab === 'products' && (
            <ManageProducts
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
            />
          )}
          {tab === 'categories' && (
            <ManageCategories
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
            />
          )}
          {tab === 'offers' && (
            <OffersTab
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
            />
          )}
          {tab === 'settings' && (
            <ManageSettings
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
              onDelete={handleStoreDeleted}
            />
          )}
        </div>
        )}
      </main>
    </div>
  );
}
