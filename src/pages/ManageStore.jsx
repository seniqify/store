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
import { useParams, Link, useNavigate } from 'react-router-dom';
import { canAddProduct, canAddCategory, getPlanLimits, effectivePlan, trialDaysLeft } from '../utils/planLimits';
import {
  Lock, ArrowLeft, Package, Tag, Settings2,
  Plus, X, Pencil, ImagePlus, Link2, CheckCircle2,
  AlertCircle, ChevronDown, Copy, Check, Trash2,
} from 'lucide-react';
import { loadBusiness }                               from '../utils/BusinessLoader';
import { updateStore, verifyPin, resetPin, deleteStore } from '../utils/storeService';
import { cacheStore, clearCachedStore }               from '../utils/businessStorage';
import { THEME_PRESETS }                              from '../utils/buildConfig';
import { uploadConfigImages }                         from '../utils/imageStorage';

// ── Constants ─────────────────────────────────────────────────────────────────
const CAT_EMOJIS = [
  '📦','🔌','🧵','🍽️','⚙️','📱',
  '🏠','🎯','💻','🔧','🚗','👕',
  '🌿','💎','🎸','🛒','🔩','🌾',
];
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
const EMPTY_PROD  = { name:'', category:'', price:'', mrp:'', unit:'per piece', unitCustom:'', description:'', image:'' };
const EMPTY_CAT   = { emoji:'📦', label:'' };

// ── Helpers ───────────────────────────────────────────────────────────────────
function iCls(err) {
  return [
    'w-full px-3 py-2 rounded-xl border text-sm text-gray-900',
    'placeholder-gray-400 transition focus:outline-none focus:ring-2',
    err ? 'border-red-400 focus:ring-red-200 bg-red-50'
        : 'border-gray-200 focus:ring-gray-300 bg-white',
  ].join(' ');
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
      onVerified();
    } else {
      setError('Incorrect PIN. Please try again.');
      setChecking(false);
    }
  }

  // ── Recovery ───────────────────────────────────────────────────────────────
  async function handleRecover(e) {
    e.preventDefault();
    if (phone.replace(/\D/g,'').length < 10) { setError('Enter a valid 10-digit WhatsApp number'); return; }
    if (newPin.length !== 4)  { setError('New PIN must be exactly 4 digits'); return; }
    if (newPin !== confPin)   { setError('PINs do not match'); return; }
    setChecking(true); setError('');
    try {
      await resetPin(slug, newPin, phone);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  function switchMode(m) {
    setMode(m); setError('');
    setPin(''); setPhone(''); setNewPin(''); setConfPin(''); setSuccess(false);
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
              Enter the WhatsApp number linked to this page to verify ownership.
            </p>

            <form onSubmit={handleRecover} className="space-y-3">
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
                <p className="text-sm text-red-500 text-center bg-red-50 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              <button type="submit" disabled={checking}
                      className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm
                                 hover:bg-gray-700 transition-colors disabled:opacity-60 mt-1">
                {checking ? 'Verifying…' : 'Reset PIN →'}
              </button>
            </form>

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

  const [activeForm,    setActiveForm]    = useState(null);  // 'product' | null
  const [form,          setForm]          = useState(EMPTY_PROD);
  const [editingId,     setEditingId]     = useState(null);
  const [errors,        setErrors]        = useState({});
  const [dirty,         setDirty]         = useState(false);

  function resetForm() { setForm(EMPTY_PROD); setEditingId(null); setErrors({}); setActiveForm(null); }

  function openAdd() {
    setForm(EMPTY_PROD);
    setEditingId(null);
    setErrors({});
    setActiveForm('product');
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
    });
    setEditingId(product.id);
    setErrors({});
    setActiveForm('product');
  }

  function validate() {
    const e = {};
    if (!form.name.trim())             e.name     = 'Product name is required.';
    if (!form.category)                e.category = 'Please select a category.';
    if (!form.price || Number(form.price) <= 0) e.price = 'Enter a valid price.';
    return e;
  }

  function submitProduct() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const finalUnit  = form.unit === 'Other…' ? (form.unitCustom.trim() || 'per piece') : form.unit;
    const finalImage = form.image?.trim() || '';

    let newProducts;
    if (editingId !== null) {
      newProducts = products.map(p =>
        p.id === editingId
          ? { ...p, name:form.name.trim(), category:form.category,
              price:Number(form.price),
              mrp:form.mrp && Number(form.mrp) > Number(form.price) ? Number(form.mrp) : undefined,
              unit:finalUnit, description:form.description.trim(), image:finalImage || p.image }
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">
          Products
          <span className="ml-1.5 text-xs font-normal text-gray-400">({products.length})</span>
        </p>
        {activeForm !== 'product' && (
          atProdLimit ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                Limit: {limits.products} products
              </span>
              <a href="/plans" target="_blank" rel="noopener noreferrer"
                 className="text-xs font-bold text-white px-2.5 py-1.5 rounded-lg transition-colors"
                 style={{ backgroundColor: themeColor }}>
                Upgrade →
              </a>
            </div>
          ) : (
            <button type="button" onClick={openAdd}
                    className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg
                               text-white transition-colors hover:opacity-90"
                    style={{ backgroundColor: themeColor }}>
              <Plus size={12} /> Add Product
            </button>
          )
        )}
      </div>

      {/* Product list */}
      {products.length === 0 && activeForm !== 'product' && (
        <div className="text-center py-8 text-sm text-gray-400">
          No products yet — click "Add Product" to get started.
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

      {/* Inline product form */}
      {activeForm === 'product' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {editingId !== null ? 'Edit Product' : 'New Product'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Name */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input type="text" autoFocus placeholder="e.g. 65W GaN Charger"
                     value={form.name}
                     onChange={e => { setForm(p => ({...p, name:e.target.value})); setErrors(p => ({...p, name:''})); }}
                     className={iCls(errors.name)} />
              {errors.name && <p className="mt-0.5 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select value={form.category}
                      onChange={e => { setForm(p => ({...p, category:e.target.value})); setErrors(p => ({...p, category:''})); }}
                      className={iCls(errors.category)}>
                <option value="">Select category…</option>
                {userCats.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
              </select>
              {errors.category && <p className="mt-0.5 text-xs text-red-500">{errors.category}</p>}
            </div>

            {/* Unit */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
              <select value={form.unit}
                      onChange={e => setForm(p => ({...p, unit:e.target.value, unitCustom:''}))}
                      className={iCls(false)}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              {form.unit === 'Other…' && (
                <input type="text" placeholder="e.g. per roll, per bundle" autoFocus
                       value={form.unitCustom}
                       onChange={e => setForm(p => ({...p, unitCustom:e.target.value}))}
                       className={[iCls(false), 'mt-2'].join(' ')} />
              )}
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Price ₹ <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                <input type="number" inputMode="numeric" min="0" placeholder="349"
                       value={form.price}
                       onChange={e => { setForm(p => ({...p, price:e.target.value})); setErrors(p => ({...p, price:''})); }}
                       className={[iCls(errors.price), 'pl-7'].join(' ')} />
              </div>
              {errors.price && <p className="mt-0.5 text-xs text-red-500">{errors.price}</p>}
            </div>

            {/* MRP */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                MRP ₹ <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                <input type="number" inputMode="numeric" min="0" placeholder="499"
                       value={form.mrp}
                       onChange={e => setForm(p => ({...p, mrp:e.target.value}))}
                       className={[iCls(false), 'pl-7'].join(' ')} />
              </div>
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input type="text" placeholder="Short description"
                     value={form.description}
                     onChange={e => setForm(p => ({...p, description:e.target.value}))}
                     className={iCls(false)} />
            </div>

            {/* Image */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Product Image <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <ImageUploader value={form.image} onChange={v => setForm(p => ({...p, image:v}))} />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={submitProduct}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
                    style={{ backgroundColor: themeColor }}>
              {editingId !== null ? 'Update Product' : 'Add Product'}
            </button>
            <button type="button" onClick={resetForm}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">
          Categories
          <span className="ml-1.5 text-xs font-normal text-gray-400">({userCats.length})</span>
        </p>
        {activeForm !== 'category' && (
          atCatLimit ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                Limit: {limits.categories} categor{limits.categories === 1 ? 'y' : 'ies'}
              </span>
              <a href="/plans" target="_blank" rel="noopener noreferrer"
                 className="text-xs font-bold text-white px-2.5 py-1.5 rounded-lg transition-colors"
                 style={{ backgroundColor: themeColor }}>
                Upgrade →
              </a>
            </div>
          ) : (
            <button type="button" onClick={openAdd}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg
                               border border-dashed border-gray-300 text-gray-500
                               hover:border-gray-400 hover:text-gray-700 transition-colors">
              <Plus size={12} /> Add Category
            </button>
          )
        )}
      </div>

      {userCats.length === 0 && activeForm !== 'category' && (
        <div className="text-center py-6 text-sm text-gray-400">
          No categories yet. Add one to get started.
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
            <div className="flex flex-wrap gap-1.5">
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

  // Derive editable values from config
  const digits = (config.whatsappNumber || '').replace(/\D/g,'').slice(-10);

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
    const d = val.replace(/\D/g,'').slice(0,10);
    const formatted = d.length === 10 ? `+91 ${d.slice(0,5)} ${d.slice(5)}` : `+91 ${d}`;
    onChange({ whatsappNumber: `91${d}`, phone: formatted });
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

      {/* Promo Banner */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Announcement Banner</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <div>
          <label className={lCls()}>
            Promo Message
            <span className="text-gray-400 font-normal ml-1">(optional)</span>
          </label>
          <input
            type="text"
            maxLength={100}
            placeholder="e.g. 🎉 Free delivery this week! · 10% off on orders above ₹500"
            value={config.promoText || ''}
            onChange={e => update({ promoText: e.target.value })}
            className={iCls(false)}
          />
          <p className="mt-1 text-xs text-gray-400">
            Start with an emoji 🚚 then your heading · optional subtitle.
            Use <strong className="text-gray-500">·</strong> to separate heading from subtitle.
          </p>
          <p className="mt-0.5 text-[11px] text-gray-400 italic">
            e.g. 🚚 Free delivery today · On all orders above ₹999
          </p>
          {config.promoText && (() => {
            const emoji    = config.promoText.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u)?.[0] ?? null;
            const noEmoji  = config.promoText.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '').trim();
            const parts    = noEmoji.split(/\s*[·•\-–]\s*/);
            const heading  = parts[0] ?? '';
            const sub      = parts[1] ?? null;
            const primary  = config.theme?.primary ?? themeColor;
            return (
              <div className="mt-3 rounded-2xl overflow-hidden relative"
                   style={{ backgroundColor: `${primary}18` }}>
                <div className="absolute inset-0 opacity-20 pointer-events-none"
                     style={{
                       backgroundImage: `radial-gradient(circle, ${primary}40 1px, transparent 1px)`,
                       backgroundSize: '18px 18px',
                     }} />
                <div className="relative flex items-stretch min-h-[80px]">
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 px-4 py-3">
                    <p className="font-extrabold text-sm text-gray-900 leading-tight">{heading}</p>
                    {sub && <p className="text-xs text-gray-500">{sub}</p>}
                    <span className="mt-1 self-start text-[10px] font-bold text-white px-2.5 py-1 rounded-lg"
                          style={{ backgroundColor: primary }}>
                      Order Now →
                    </span>
                  </div>
                  <div className="flex-shrink-0 w-20 flex items-end justify-center pb-1 pr-1 pt-2 relative">
                    <div className="absolute bottom-1 right-0 w-16 h-16 rounded-full"
                         style={{ backgroundColor: `${primary}20` }} />
                    <span className="relative text-4xl leading-none select-none">{emoji ?? '🎉'}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

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
                     tagline: `Order from ${e.target.value} via WhatsApp`,
                   })}
                   className={iCls(false)} />
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
            <div className="flex flex-wrap gap-2">
              {['🏪','📱','🔌','⚙️','🧵','🏭','🛒','📦','💎','🌿','🔧','🍽️','🚗','💼','👕','🎯','🔩','🌾'].map(emoji => (
                <button key={emoji} type="button"
                        onClick={() => update({ logoEmoji: emoji })}
                        className={[
                          'w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all',
                          config.logoEmoji === emoji
                            ? 'ring-2 ring-offset-1 ring-gray-800 bg-gray-100 scale-110'
                            : 'bg-gray-50 hover:bg-gray-100 border border-gray-200',
                        ].join(' ')}>
                  {emoji}
                </button>
              ))}
            </div>
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
  const [config,      setConfig]      = useState(null);
  const [tab,         setTab]         = useState('products');
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
      // Upload any base64 images added during this session
      const uploadedProducts = await uploadConfigImages(config.products, businessSlug);
      const finalConfig = { ...config, products: uploadedProducts };

      await updateStore(businessSlug, finalConfig);
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
    return <PinGate slug={businessSlug} onVerified={() => setPinVerified(true)} />;
  }

  // ── Management Dashboard ──────────────────────────────────────────────────
  const themeColor = config.theme?.primary || '#0d9488';

  // Free-trial / renewal state (coupon-granted plans expire; see effectivePlan)
  const rawPlan    = config.plan || 'free';
  const daysLeft   = trialDaysLeft(config);
  const onTrial    = rawPlan !== 'free' && daysLeft !== null && daysLeft > 0;
  const trialEnded = rawPlan !== 'free' && config.planExpiresAt && effectivePlan(config) === 'free';
  const planName   = rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1);

  const TABS = [
    { key: 'products',   label: 'Products',   icon: Package  },
    { key: 'categories', label: 'Categories', icon: Tag      },
    { key: 'settings',   label: 'Settings',   icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/40">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 shadow-sm"
                 style={{ backgroundColor: themeColor + '20' }}>
              {config.logoEmoji || '🏪'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate leading-tight">{config.businessName}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Page live · Manage
              </p>
            </div>
          </div>

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
          <a href="/plans" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Subscribe to keep it →</a>
        </div>
      )}
      {trialEnded && (
        <div className="bg-amber-500 text-white text-center text-xs font-semibold px-4 py-2">
          Your free {planName} trial ended — page is on Free now.{' '}
          <a href="/plans" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Renew {planName} →</a>
        </div>
      )}

      {/* ── Tab navigation ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 sticky top-16 z-10">
        <div className="max-w-lg mx-auto px-4 flex">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold',
                  'border-b-2 transition-colors',
                  active ? '' : 'border-transparent text-gray-400 hover:text-gray-600',
                ].join(' ')}
                style={active ? { borderColor: themeColor, color: themeColor } : undefined}>
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-6">
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
      </main>
    </div>
  );
}
