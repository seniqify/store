/**
 * ManageStore — Store management dashboard
 * Route: /:businessSlug/manage
 *
 * Flow:
 *  1. Load store config from DB
 *  2. Show PIN gate
 *  3. After verified → tabs: Products | Categories | Settings
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { canAddProduct, canAddCategory, getPlanLimits, effectivePlan, trialDaysLeft, showBrandBadge } from '../utils/planLimits';
import {
  ArrowLeft, Package, Tag, Settings2, ShoppingBag, BarChart3,
  Plus, X, Pencil, ImagePlus, Link2, CheckCircle2,
  ChevronDown, ChevronUp, Copy, Check, Trash2, QrCode, Star,
  Percent, Sparkles, Users, Bot, Search,
  Truck, ShoppingCart, LayoutDashboard, LayoutGrid,
  Bell, Volume2, VolumeX, Layers, Megaphone, Wallet, AlertTriangle, MessageCircle,
} from 'lucide-react';
import { openStorePoster } from '../utils/storePoster';
import { isValidUpiVpa } from '../utils/upiLink';
import { normaliseHours, defaultHours, getStoreStatus, DAY_ORDER, DAY_FULL } from '../utils/storeHours';
import { loadBusiness }                               from '../utils/BusinessLoader';
import { updateStore, verifyPin, deleteStore }        from '../utils/storeService';
import { categoryLinkId }                                from '../../api/_categoryLink.js';
import { cacheStore, clearCachedStore }               from '../utils/businessStorage';
import { THEME_PRESETS, FEATURE_SUGGESTIONS, customTheme } from '../utils/buildConfig';
import { uploadConfigImages, uploadSingleImage }      from '../utils/imageStorage';
import { compressImageFile, PRODUCT_MAX_DIM, LOGO_MAX_DIM } from '../utils/imageCompress';
import { subcategoriesForType, ICON_EMOJIS, defaultIcon } from '../utils/businessCategories';
import { suggestProductDetails }                     from '../utils/productAi';
import LocationPicker                                 from '../components/LocationPicker';
import IconPicker                                     from '../components/IconPicker';
import OrdersTab                                       from '../components/manage/OrdersTab';
import AbandonedTab                                    from '../components/manage/AbandonedTab';
import ProductCard                                     from '../components/product/ProductCard';
import AnalyticsTab                                    from '../components/manage/AnalyticsTab';
import ReachCard                                       from '../components/manage/ReachCard';
import ReviewsTab                                       from '../components/manage/ReviewsTab';
import OffersTab                                        from '../components/manage/OffersTab';
import AiInsightsTab                                    from '../components/manage/AiInsightsTab';
import CustomersTab                                      from '../components/manage/CustomersTab';
import AdsTab                                            from '../components/manage/AdsTab';
import OverviewTab                                       from '../components/manage/OverviewTab';
import AssistantTab                                      from '../components/manage/AssistantTab';
import PaymentsConnect                                    from '../components/manage/PaymentsConnect';
import PaymentsTab                                        from '../components/manage/PaymentsTab';
import MetaConnect                                        from '../components/manage/MetaConnect';
import ShippingConnect                                     from '../components/manage/ShippingConnect';
import DomainConnect                                       from '../components/manage/DomainConnect';
import DeliveryBoard                                        from '../components/manage/DeliveryBoard';
import CodMoney                                             from '../components/manage/CodMoney';
import WhatsAppTab                                          from '../components/manage/WhatsAppTab';
import ShipUpdates                                          from '../components/manage/ShipUpdates';
import PinGate                                              from '../components/manage/PinGate';
import { rtoSettings }                                      from '../utils/rtoRisk';
import { walletLow, clearWalletLow, onWalletLowChange }    from '../utils/courierAlerts';
import HeroBanner, { BANNER_STYLES }                      from '../components/store/HeroBanner';
import NewOrderToast                                       from '../components/manage/NewOrderToast';
import { useNewOrders }                                    from '../hooks/useNewOrders';
import { useStoreDomain }                                  from '../hooks/useStoreDomain';
import { publicStoreUrl }                                  from '../utils/storeUrls';
import { fetchProductSales }                               from '../utils/salesService';
import { pinColors }                                       from '../utils/pinGate';
import { orderSoundOn, setOrderSoundOn, playOrderChime, buzz, alertNewOrder } from '../utils/notifySound';
import ManageSidebar                                       from '../components/manage/shell/ManageSidebar';
import MoreScreen                                          from '../components/manage/shell/MoreScreen';
import GlobalSearch                                        from '../components/manage/shell/GlobalSearch';
import AlertsBell                                          from '../components/manage/shell/AlertsBell';
import { DesktopTopBar, PhoneTopBar }                      from '../components/manage/shell/TopBars';
import { shellColors, planLine, sectionSubtitle }          from '../utils/dashboardShell';

// ── Constants ─────────────────────────────────────────────────────────────────
const CAT_EMOJIS = ICON_EMOJIS;
const UNIT_OPTIONS = [
  'per piece','per kg','per metre','per litre',
  'pack of 2','pack of 3','pack of 6','pack of 12',
  'per box','per set','per dozen','Other…',
];
// Service stores price by RATE, not pack size. 'per piece' stays the stored
// default (legacy services already carry it) and renders as a plain
// "Starting from ₹X" on the storefront; real units render "₹X / sq ft" etc.
const SERVICE_UNIT_OPTIONS = [
  'per piece',
  'per sq ft','per hour','per day','per month',
  'per visit','per person','per plate','per session','per event',
  'Other…',
];
const STANDARD_UNITS = [...new Set([...UNIT_OPTIONS, ...SERVICE_UNIT_OPTIONS])].filter(u => u !== 'Other…');
const THEME_OPTIONS  = [
  { hex: '#0d9488', label: 'Teal'   },
  { hex: '#2563eb', label: 'Blue'   },
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#16a34a', label: 'Green'  },
  { hex: '#ea580c', label: 'Orange' },
  { hex: '#9333ea', label: 'Purple' },
  { hex: '#e11d48', label: 'Rose'   },
];
const EMPTY_PROD  = { name:'', category:'', price:'', mrp:'', cost:'', stock:'', unit:'per piece', unitCustom:'', description:'', image:'', images:[], gstRate:'', taxMode:'', variantLabel:'', variantOptions:[], variantExtras:[], attributes:[] };
const LOW_STOCK   = 5;   // ≤ this many units left → "low stock" (still in stock)

// Clean the form's extra option-types into the stored shape:
// [{ label, options: [{ name, addPrice }] }] — drops blank groups/options.
function buildVariantExtras(formExtras) {
  return (formExtras || [])
    .map((g) => ({
      label: String(g.label || '').trim(),
      options: (g.options || [])
        .map((o) => ({
          name: String(o.name || '').trim(),
          addPrice: (o.addPrice === '' || o.addPrice == null) ? 0 : Number(o.addPrice),
        }))
        .filter((o) => o.name),
    }))
    .filter((g) => g.label && g.options.length);
}
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

// Collapsible section for the advanced (optional) parts of the product form, so
// a first-time seller sees only the essentials. `openWhen` opens it on mount
// (e.g. editing a product that already uses this) and re-opens if it turns true
// later (e.g. AI auto-fill adds variants).
function Accordion({ icon: Icon, iconBg, iconColor, title, badge, subtitle, openWhen = false, children }) {
  const [open, setOpen] = useState(!!openWhen);
  useEffect(() => { if (openWhen) setOpen(true); }, [openWhen]);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-8 h-8 flex-shrink-0 rounded-lg grid place-items-center"
              style={{ background: iconBg, color: iconColor }}>
          {Icon && <Icon size={16} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-gray-900 leading-tight">
            {title}
            {badge && <span className="ml-1.5 align-middle text-[10px] font-bold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{badge}</span>}
          </span>
          {subtitle && <span className="block text-[11.5px] text-gray-400 mt-0.5 leading-snug">{subtitle}</span>}
        </span>
        <ChevronDown size={18} className={['text-gray-300 flex-shrink-0 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">{children}</div>}
    </div>
  );
}

// ── ImageUploader ─────────────────────────────────────────────────────────────
// `compact` renders a small square tile (used per variant option, e.g. a photo
// for each colour); the default is the full uploader used for product/logo/cover.
// `maxDim` caps the longest side. PRODUCT_MAX_DIM (1200, the default) is what the
// product page needs on a 3x phone; logos pass LOGO_MAX_DIM; the full-width cover
// banner passes 1600. Files land in Supabase Storage (not config JSONB), so bigger
// is safe here. See src/utils/imageCompress.js for why photos used to come out
// blurry — variant photos were capped at 400px and all drawn in one jump.
// `lowResWarnBelow` (px): when set, the uploader flags a photo under this size —
// either a freshly-uploaded small source or a low-res image already stored.
// `lowResBy` picks what is measured: 'width' for the wide cover banner, 'long'
// (longest side) for product photos, which can be portrait or landscape.
// `lowResHint` replaces the default warning text.
function ImageUploader({ value, onChange, compact = false, maxDim = PRODUCT_MAX_DIM,
                         lowResWarnBelow = 0, lowResBy = 'width', lowResHint = '',
                         multiple = 1, onAddMany }) {
  const [dragOver, setDragOver] = useState(false);
  const [adding,   setAdding]   = useState(false);      // compressing a multi-photo pick
  const [urlMode,  setUrlMode]  = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [lowRes,   setLowRes]   = useState(0);          // measured px when too small, else 0
  const fileRef = useRef(null);

  const isBase64 = value?.startsWith('data:');
  const hasImage = Boolean(value);

  // Measure the actual pixel width once the image paints; flag if it's too small
  // to fill the banner crisply. Runs for both stored and just-uploaded covers.
  const checkRes = (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.target;
    const px = lowResBy === 'long' ? Math.max(w, h) : w;
    setLowRes(lowResWarnBelow > 0 && px > 0 && px < lowResWarnBelow ? px : 0);
  };

  function compressAndSet(file) {
    compressImageFile(file, { maxDim })
      .then((dataUrl) => { onChange(dataUrl); setUrlMode(false); setUrlInput(''); })
      .catch(() => { /* not an image — ignored, as before */ });
  }

  // `multiple` > 1 (the gallery's empty tile): take up to that many photos from one
  // pick and hand them over together. Compressed one at a time: several full-size
  // phone photos decoded at once can run a phone out of memory.
  async function addFiles(input) {
    const files = [...(input.files || [])];
    input.value = '';   // so picking the same photos again still fires onChange
    if (!(multiple > 1 && onAddMany)) { compressAndSet(files[0]); return; }
    if (!files.length) return;
    setAdding(true);
    const urls = [];
    for (const f of files.slice(0, multiple)) {
      try { urls.push(await compressImageFile(f, { maxDim })); } catch { /* not an image — skipped */ }
    }
    setAdding(false);
    if (urls.length) onAddMany(urls);
  }

  // ── Compact tile (variant option photo) ──────────────────────────────────
  if (compact) {
    return (
      <div className="relative w-[52px] h-[52px] flex-shrink-0">
        {hasImage ? (
          <>
            <img src={value} alt="" className="w-full h-full object-cover rounded-lg border border-gray-200" onError={() => onChange('')} onLoad={checkRes} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Change photo" className="absolute inset-0 rounded-lg" />
            <button type="button" onClick={() => onChange('')} aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white flex items-center justify-center shadow">
              <X size={11} />
            </button>
            {lowRes > 0 && (
              <span title={`Only ${lowRes}px — looks blurry to customers. Re-upload the original photo.`}
                className="absolute inset-x-0 bottom-0 rounded-b-lg bg-amber-500/90 text-white text-[8px] font-bold leading-[14px] text-center pointer-events-none">
                Low-res
              </span>
            )}
          </>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={adding}
            aria-label={multiple > 1 ? `Add up to ${multiple} photos` : 'Add photo'}
            className="w-full h-full rounded-lg border-2 border-dashed border-gray-200 bg-white hover:border-gray-300
                       flex flex-col items-center justify-center gap-0.5 text-gray-400 transition-colors">
            {adding
              ? <div className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              : <ImagePlus size={15} />}
            <span className="text-[9px] font-semibold leading-none">{adding ? 'Adding' : multiple > 1 ? 'Photos' : 'Photo'}</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" multiple={multiple > 1}
               onChange={(e) => addFiles(e.target)} />
      </div>
    );
  }

  if (hasImage) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
            <img src={value} alt="" className="w-full h-full object-cover" onError={() => onChange('')} onLoad={checkRes} />
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
        {lowRes > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <span className="flex-shrink-0">⚠️</span>
            <span>{lowResHint || `This photo is only ${lowRes}px, so customers see it blurry. Tap Change and re-upload the original from your phone.`}</span>
          </p>
        )}
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

// ── PIN Gate: src/components/manage/PinGate.jsx ───────────────────────────────

// ── Products Tab ─────────────────────────────────────────────────────────────
function ManageProducts({ config, onChange, onSave, saveStatus, saveError, searchSeed = null }) {
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
  const [query,         setQuery]         = useState('');
  const [catFilter,     setCatFilter]     = useState('all');
  // Text typed in the dashboard's own search box lands here (once per hand-off).
  const [seedSeen, setSeedSeen] = useState(null);
  if (searchSeed?.q && searchSeed !== seedSeen) { setSeedSeen(searchSeed); setQuery(searchSeed.q); setCatFilter('all'); }
  // Units sold per product (get_product_sales: counts only, no customer data).
  const [sales, setSales] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchProductSales(config.slug).then((idx) => { if (alive) setSales(idx); });
    return () => { alive = false; };
  }, [config.slug]);
  // The shop colour 20% darker: readable under white text (same as the PIN screen).
  const btnColor = pinColors(themeColor).button;

  // Long catalogues need find-ability: filter by name and/or category.
  const q = query.trim().toLowerCase();
  const visible = products.filter(p =>
    (catFilter === 'all' || p.category === catFilter) &&
    (!q || String(p.name || '').toLowerCase().includes(q)));

  // Live preview: the form mapped to the exact card customers see on the page.
  const previewProduct = {
    name:  form.name.trim() || 'Product name',
    price: Number(form.price) || 0,
    mrp:   form.mrp !== '' && Number(form.mrp) > (Number(form.price) || 0) ? Number(form.mrp) : null,
    image: form.image || '',
    unit:  form.unit === 'Other…' ? (form.unitCustom || null) : (form.unit || null),
    variants: (form.variantOptions || []).filter(o => o.name?.trim()).length
      ? {
          label: form.variantLabel || 'Options',
          options: form.variantOptions.filter(o => o.name?.trim()).map(o => ({
            name:  o.name,
            price: o.price !== '' && o.price != null ? Number(o.price) : null,
            mrp:   o.mrp !== '' && o.mrp != null ? Number(o.mrp) : null,
            image: o.image || null,
          })),
        }
      : null,
    variantExtras: buildVariantExtras(form.variantExtras),
  };

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
        ? { variantLabel: res.variant.label, variantOptions: res.variant.options.map((n) => ({ name: n, price: '', mrp: '', cost: '', image: '' })) }
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
      cost:        product.cost        ?? '',
      stock:       product.stock       ?? '',
      unit:        unitIsStandard ? product.unit : 'Other…',
      unitCustom:  unitIsStandard ? '' : (product.unit || ''),
      description: product.description || '',
      image:       product.image       || '',
      images:      Array.isArray(product.images) ? product.images.filter(Boolean) : [],
      gstRate:     product.gstRate != null ? product.gstRate : '',
      taxMode:     product.taxInclusive === true ? 'inclusive' : product.taxInclusive === false ? 'exclusive' : '',
      variantLabel:   product.variants?.label || '',
      variantOptions: product.variants?.options ? product.variants.options.map(o => ({ name: o.name, price: o.price ?? '', mrp: o.mrp ?? '', cost: o.cost ?? '', image: o.image || '' })) : [],
      variantExtras:  Array.isArray(product.variantExtras) ? product.variantExtras.map(g => ({ label: g.label || '', options: (g.options || []).map(o => ({ name: o.name || '', addPrice: o.addPrice ?? '' })) })) : [],
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

    // Extra option types (Colour, Pack…): once a group is started it needs a name
    // + at least one named option; the +₹ add-on is optional but must be ≥ 0.
    (form.variantExtras || []).forEach((g) => {
      if (e.variantExtras) return;
      const started = String(g.label || '').trim() || (g.options || []).some(o => String(o.name || '').trim());
      if (!started) return;
      if (!String(g.label || '').trim())
        e.variantExtras = 'Name each option type (e.g. Colour).';
      else if (!(g.options || []).some(o => String(o.name || '').trim()))
        e.variantExtras = 'Add at least one option to each type, or remove it.';
      else if ((g.options || []).some(o => String(o.name || '').trim() && o.addPrice !== '' && o.addPrice != null && !(Number(o.addPrice) >= 0)))
        e.variantExtras = 'Extra price must be 0 or more.';
    });
    return e;
  }

  function submitProduct() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const finalUnit  = form.unit === 'Other…' ? (form.unitCustom.trim() || 'per piece') : form.unit;
    const finalImage = form.image?.trim() || '';
    const cleanImages = (form.images || []).filter(Boolean);   // extra gallery photos
    const cleanOpts  = (form.variantOptions || [])
      .map(o => ({
        name:  String(o.name || '').trim(),
        price: (o.price === '' || o.price == null) ? null : Number(o.price),
        mrp:   (o.mrp === '' || o.mrp == null) ? null : Number(o.mrp),
        // Per-variant cost price (private) — powers correct profit per option.
        cost:  (o.cost === '' || o.cost == null) ? undefined : Number(o.cost),
        image: (o.image && String(o.image).trim()) ? o.image : null,
      }))
      .filter(o => o.name);
    const variants   = (form.variantLabel.trim() && cleanOpts.length)
      ? { label: form.variantLabel.trim(), options: cleanOpts } : null;
    // Extra choice types (Colour, Pack…) — additional to the priced variant above.
    const cleanExtras    = buildVariantExtras(form.variantExtras);
    const variantExtras  = cleanExtras.length ? cleanExtras : undefined;
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
    // Cost price (what the item costs the seller) — powers the Profit stats.
    // '' → undefined (not set). Private; never sent to the storefront.
    const cost = form.cost === '' || form.cost == null ? undefined : Number(form.cost);
    // Stock count. '' → undefined = untracked/unlimited (never sold out from count).
    // A number ≥ 0 turns on Stock Sense: auto "Sold out" at 0, auto-decrement on order.
    const stock = form.stock === '' || form.stock == null ? undefined : Math.max(0, Math.floor(Number(form.stock)) || 0);

    let newProducts;
    if (editingId !== null) {
      newProducts = products.map(p =>
        p.id === editingId
          ? { ...p, name:form.name.trim(), category:form.category,
              price:Number(form.price),
              mrp:form.mrp && Number(form.mrp) > Number(form.price) ? Number(form.mrp) : undefined,
              cost,
              stock,
              unit:finalUnit, description:form.description.trim(), image:finalImage || p.image, images:cleanImages, gstRate, taxInclusive, variants, variantExtras, attributes }
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
        images:      cleanImages,
        price:       Number(form.price),
        mrp:         form.mrp && Number(form.mrp) > Number(form.price) ? Number(form.mrp) : undefined,
        cost,
        stock,
        unit:        finalUnit,
        gstRate,
        taxInclusive,
        variants,
        variantExtras,
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

  // Reorder: swap a product with its neighbour in the FULL list. The storefront
  // shows products in this array order, so this controls what customers see first.
  // Only offered on the unfiltered list (see canReorder), so "up"/"down" always
  // match what's on screen.
  function moveProduct(id, dir) {
    const idx  = products.findIndex(p => p.id === id);
    const swap = idx + (dir === 'up' ? -1 : 1);
    if (idx < 0 || swap < 0 || swap >= products.length) return;
    const next = [...products];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange({ products: next });
    setDirty(true);
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

  // Reorder arrows only make sense on the full, unfiltered list — otherwise
  // "up"/"down" wouldn't match the on-screen order.
  const canReorder = !query && catFilter === 'all';

  return (
    <div className="space-y-4">

      {/* Search + Add product */}
      <div className="flex items-center gap-2">
        {products.length > 0 ? (
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                   placeholder={`Search ${products.length} ${products.length === 1 ? 'product' : 'products'}`}
                   aria-label="Search products"
                   className={`${iCls(false)} !pl-9`} />
          </div>
        ) : <div className="flex-1" />}
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
                  className="flex items-center gap-1.5 text-sm font-bold h-11 px-4 rounded-xl flex-shrink-0
                             text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
                  style={{ backgroundColor: btnColor }}>
            <Plus size={16} strokeWidth={2.5} /> Add product
          </button>
        )}
      </div>

      {/* Category tabs, with how many products each holds */}
      {userCats.length > 0 && products.length > 0 && (
        <div className="flex gap-1 p-1 rounded-xl bg-gray-100 w-max max-w-full overflow-x-auto scrollbar-hide" role="tablist" aria-label="Categories">
          {[{ id: 'all', label: 'All', n: products.length },
            ...userCats.map(c => ({ id: c.id, label: c.label, n: products.filter(p => p.category === c.id).length }))].map(t => {
            const on = catFilter === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setCatFilter(t.id)}
                      className={['h-8 px-3 rounded-lg text-[13px] font-bold whitespace-nowrap transition',
                        on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'].join(' ')}>
                {t.label}<span className={['ml-1.5 tabular-nums', on ? 'text-gray-500' : 'text-gray-400'].join(' ')}>{t.n}</span>
              </button>
            );
          })}
        </div>
      )}
      {products.length > 0 && (
        <button type="button" onClick={() => document.getElementById('manage-categories')?.scrollIntoView({ behavior: 'smooth' })}
                className="-mt-2 text-[13px] font-bold" style={{ color: btnColor }}>
          {userCats.length > 0 ? 'Edit categories' : 'Add categories'} ↓
        </button>
      )}

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

      {products.length > 0 && visible.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">
          No products match — try a different search or category.
        </p>
      )}

      {/* The product grid: photo first, like the page buyers see */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
        {visible.map(p => {
          const cat = userCats.find(c => c.id === p.category);
          const isEditing = editingId === p.id;
          const fullIdx = products.findIndex(x => x.id === p.id);
          // Stock: the manual in/out switch, plus the count when this product tracks one.
          const tracked = Number.isFinite(Number(p.stock)) && p.stock !== '' && p.stock != null;
          const left = tracked ? Number(p.stock) : null;
          const out = p.inStock === false || (tracked && left <= 0);
          const low = !out && tracked && left <= LOW_STOCK;
          const sold = sales?.get(p.name)?.sold || 0;
          const off = Number(p.mrp) > Number(p.price) && Number(p.price) > 0
            ? Math.round((1 - Number(p.price) / Number(p.mrp)) * 100) : 0;
          return (
            <div key={p.id}
                 className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-w-0"
                 style={isEditing ? { borderColor: themeColor, boxShadow: `0 0 0 3px ${themeColor}2e` } : undefined}>
              <div className="relative">
              <button type="button" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}
                      className="relative block w-full aspect-square bg-gray-100">
                {p.image ? (
                  <img src={p.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400 text-[12px] font-bold">
                    <ImagePlus size={24} />Add a photo
                  </span>
                )}
                {out && (
                  <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
                    <span className="px-3 py-1 rounded-full bg-white text-red-700 text-[12px] font-extrabold">Sold out</span>
                  </span>
                )}
                {off > 0 && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-white text-[11px] font-extrabold"
                        style={{ backgroundColor: btnColor }}>{off}% off</span>
                )}
              </button>
              {/* Order on the page: what buyers see first (only on the full, unfiltered list) */}
              {canReorder && products.length > 1 && (
                <div className="absolute top-2 right-2 flex gap-1">
                  <button type="button" onClick={() => moveProduct(p.id, 'up')} disabled={fullIdx === 0}
                          aria-label={`Show ${p.name} earlier`} title="Show earlier on the page"
                          className="w-7 h-7 rounded-lg bg-white/90 shadow-sm grid place-items-center text-gray-700 enabled:hover:bg-white disabled:opacity-40">
                    <ChevronUp size={15} className="-rotate-90" />
                  </button>
                  <button type="button" onClick={() => moveProduct(p.id, 'down')} disabled={fullIdx === products.length - 1}
                          aria-label={`Show ${p.name} later`} title="Show later on the page"
                          className="w-7 h-7 rounded-lg bg-white/90 shadow-sm grid place-items-center text-gray-700 enabled:hover:bg-white disabled:opacity-40">
                    <ChevronUp size={15} className="rotate-90" />
                  </button>
                </div>
              )}
              </div>
              <div className="p-3 flex flex-col gap-1 flex-1">
                <p className="text-[14px] font-bold text-gray-900 leading-snug line-clamp-2">{p.name}</p>
                <p className="text-[12px] text-gray-500 truncate">
                  {[p.unit, cat ? `${cat.emoji || ''} ${cat.label}`.trim() : ''].filter(Boolean).join(' · ') || ' '}
                </p>
                <p className="mt-0.5">
                  <span className="font-extrabold tabular-nums text-gray-900">₹{p.price}</span>
                  {off > 0 && <span className="ml-1.5 text-[12px] text-gray-400 line-through tabular-nums">₹{p.mrp}</span>}
                </p>
                <p className={['text-[12px] font-bold', out ? 'text-red-700' : low ? 'text-amber-700' : 'text-gray-500'].join(' ')}>
                  {out ? 'Out of stock' : tracked ? (low ? `Only ${left} left` : `${left} in stock`) : 'In stock'}
                  {sold > 0 && <span className="font-semibold text-gray-500"> · {sold} sold</span>}
                </p>
                <div className="flex items-center gap-1.5 mt-auto pt-2">
                  <button type="button" role="switch" aria-checked={p.inStock !== false} onClick={() => toggleStock(p.id)}
                          aria-label={p.inStock === false ? `${p.name} is out of stock. Mark in stock` : `${p.name} is in stock. Mark out of stock`}
                          className="flex items-center gap-2 text-[12px] font-bold text-gray-600 mr-auto min-w-0">
                    <span className={['relative w-10 h-6 rounded-full transition-colors flex-shrink-0', p.inStock === false ? 'bg-gray-300' : ''].join(' ')}
                          style={p.inStock === false ? undefined : { backgroundColor: btnColor }}>
                      <span className={['absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', p.inStock === false ? 'left-0.5' : 'left-[18px]'].join(' ')} />
                    </span>
                    <span className="hidden sm:inline truncate">{p.inStock === false ? 'Out of stock' : 'In stock'}</span>
                  </button>
                  <button type="button" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}
                          className="w-8 h-8 rounded-lg border border-gray-200 grid place-items-center text-gray-600 hover:bg-gray-50">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => removeProduct(p.id)} aria-label={`Delete ${p.name}`}
                          className="w-8 h-8 rounded-lg border border-gray-200 grid place-items-center text-gray-400 hover:text-red-600 hover:bg-red-50">
                    <X size={14} />
                  </button>
                </div>
              </div>
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
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-gray-50/40">

            {/* ── The essentials: everything a seller needs to publish ── */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: `${themeColor}40` }}>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100"
                   style={{ background: `linear-gradient(180deg,#ffffff,${themeColor}0d)` }}>
                <span className="w-5 h-5 rounded-md grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: themeColor }}>
                  <Check size={12} strokeWidth={3} />
                </span>
                <h4 className="text-[13px] font-extrabold text-gray-900 flex-1">The essentials</h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
                      style={{ color: themeColor, borderColor: `${themeColor}55` }}>all you need to publish</span>
              </div>
              <div className="p-4 space-y-4">
                {/* Photo — the first thing customers see */}
                <div>
                  <label className={FIELD_LABEL}>Product photo <span className="text-gray-400 font-normal">· the first thing customers see</span></label>
                  <ImageUploader value={form.image} onChange={v => setForm(p => ({...p, image:v}))} lowResWarnBelow={500} lowResBy="long" />
                </div>
                {/* Name + AI auto-fill */}
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
                {/* Price + MRP */}
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
                {/* Category */}
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
              </div>
            </div>

            {/* ── Everything advanced, folded away until needed ── */}
            <div className="flex items-center gap-2.5 pt-1">
              <div className="h-px flex-1 bg-gray-200/70" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Add more — all optional</span>
              <div className="h-px flex-1 bg-gray-200/70" />
            </div>

            <Accordion icon={Tag} iconBg="#fffbeb" iconColor="#b45309" title="Cost, stock &amp; tax"
              subtitle="Your buying cost, inventory, GST &amp; unit"
              openWhen={form.cost !== '' || form.stock !== '' || form.gstRate !== ''}>
              <div>
                <label className={FIELD_LABEL}>Cost price <span className="text-gray-400 font-normal">· optional, private</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                  <input type="number" inputMode="numeric" min="0" placeholder="What it costs you, e.g. 220"
                         value={form.cost}
                         onChange={e => setForm(p => ({...p, cost:e.target.value}))}
                         className={[iCls(false), 'pl-7'].join(' ')} />
                </div>
                <p className="mt-1 text-[11px] text-gray-400 leading-snug">💡 Add this to see your real <b className="text-gray-500">profit</b> in Stats. Never shown to customers.</p>
              </div>
              {config.businessType !== 'service' && (
                <div>
                  <label className={FIELD_LABEL}>Stock <span className="text-gray-400 font-normal">· optional</span></label>
                  <input type="number" inputMode="numeric" min="0" step="1" placeholder="Leave blank = unlimited"
                         value={form.stock}
                         onChange={e => setForm(p => ({...p, stock:e.target.value}))}
                         className={iCls(false)} />
                  <p className="mt-1 text-[11px] text-gray-400 leading-snug">📦 Units in hand. Counts down as orders come in, and shows <b className="text-gray-500">Sold out</b> at 0 so you never oversell.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD_LABEL}>{config.businessType === 'service' ? 'Rate type' : 'Sold by'}</label>
                  <select value={form.unit}
                          onChange={e => setForm(p => ({...p, unit:e.target.value, unitCustom:''}))}
                          className={iCls(false)}>
                    {(config.businessType === 'service' ? SERVICE_UNIT_OPTIONS : UNIT_OPTIONS).map(u => (
                      <option key={u} value={u}>
                        {config.businessType === 'service' && u === 'per piece' ? 'Starting price (no unit)' : u}
                      </option>
                    ))}
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
            </Accordion>

            <Accordion icon={ImagePlus} iconBg="#eff6ff" iconColor="#1d4ed8" title="Description &amp; gallery"
              subtitle="A line customers read, plus extra photos"
              openWhen={!!form.description || (form.images || []).length > 0}>
              <div>
                <label className={FIELD_LABEL}>Description <span className="text-gray-400 font-normal">· optional</span></label>
                <input type="text" placeholder="Short description"
                       value={form.description}
                       onChange={e => setForm(p => ({...p, description:e.target.value}))}
                       className={iCls(false)} />
              </div>
              <div>
                <label className={FIELD_LABEL}>More photos <span className="text-gray-400 font-normal">· optional</span></label>
                <div className="flex flex-wrap gap-2">
                  {(form.images || []).map((img, i) => (
                    <ImageUploader key={i} compact maxDim={PRODUCT_MAX_DIM} lowResWarnBelow={500} lowResBy="long" value={img}
                      onChange={(v) => setForm(p => ({ ...p, images: v ? p.images.map((x, idx) => (idx === i ? v : x)) : p.images.filter((_, idx) => idx !== i) }))} />
                  ))}
                  {(form.images || []).length < 5 && (
                    <ImageUploader compact maxDim={PRODUCT_MAX_DIM} value="" multiple={5 - (form.images || []).length}
                      onChange={(v) => { if (v) setForm(p => ({ ...p, images: [...(p.images || []), v] })); }}
                      onAddMany={(urls) => setForm(p => ({ ...p, images: [...(p.images || []), ...urls].slice(0, 5) }))} />
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-400">Shown as a swipeable gallery on the product page — add the back-of-pack, close-ups, or the product in use. Select several photos at once, up to 5.</p>
              </div>
            </Accordion>

            <Accordion icon={Layers} iconBg="#eef2ff" iconColor="#4338ca" title="Options &amp; variants"
              subtitle="Size, weight or colour — let buyers pick one"
              openWhen={showVariants || (form.variantExtras?.length > 0)}>
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
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Options — each with its own price, MRP, cost &amp; optional photo</p>
                    <div className="space-y-2">
                      {(form.variantOptions || []).map((o, i) => {
                        const setOpt = (patch) => { setForm(p => ({ ...p, variantOptions: p.variantOptions.map((x, idx) => idx === i ? { ...x, ...patch } : x) })); setErrors(p => ({ ...p, variants: '' })); };
                        return (
                        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
                          <div className="flex gap-2.5">
                            {/* Optional per-option photo — e.g. each colour. Swaps the
                                product image when the customer picks this option. */}
                            <ImageUploader compact maxDim={PRODUCT_MAX_DIM} lowResWarnBelow={500} lowResBy="long" value={o.image} onChange={v => setOpt({ image: v })} />
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex gap-2 items-center">
                                <input type="text" placeholder={`Option — e.g. ${['Black','White','Red','Blue'][i] || 'name'}`}
                                  value={o.name}
                                  onChange={e => setOpt({ name: e.target.value })}
                                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                                <button type="button" aria-label="Remove option"
                                  onClick={() => setForm(p => ({ ...p, variantOptions: p.variantOptions.filter((_, idx) => idx !== i) }))}
                                  className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
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
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₹</span>
                                  <input type="number" inputMode="numeric" min={0} placeholder="Cost"
                                    title="Your buying cost for this option — private, powers profit in Stats"
                                    value={o.cost}
                                    onChange={e => setOpt({ cost: e.target.value })}
                                    className="w-full pl-6 pr-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, variantOptions: [...(p.variantOptions || []), { name: '', price: '', mrp: '', cost: '', image: '' }] }))}
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
                  <p className="text-[11px] text-gray-400 leading-relaxed">Set a price for each option (e.g. 250 g → ₹30, 500 g → ₹55). MRP is optional. Add a <strong>photo</strong> to an option (e.g. each colour) and the product picture changes when customers pick it — leave it empty for sizes/weights.</p>
                </div>
              )}
            </FormSection>

            {/* More option types (Colour, Pack…) — extra choices on top of the
                priced variant above, each with an optional +₹ add-on. */}
            <FormSection
              title="More option types"
              action={(form.variantExtras?.length || 0) < 3 && (
                <button type="button"
                  onClick={() => setForm(p => ({ ...p, variantExtras: [...(p.variantExtras || []), { label: '', options: [{ name: '', addPrice: '' }] }] }))}
                  className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
                  <Plus size={12} /> Add
                </button>
              )}>
              {!(form.variantExtras?.length) ? (
                <p className="text-xs text-gray-400 -mt-1">
                  Add extra choices like <strong>Colour</strong> or <strong>Pack</strong> on top of the priced type above. Customers pick one of each; give an option a <strong>+₹</strong> if it costs more.
                </p>
              ) : (
                <div className="space-y-3">
                  {form.variantExtras.map((g, gi) => {
                    const setGroup = (patch) => { setForm(p => ({ ...p, variantExtras: p.variantExtras.map((x, idx) => idx === gi ? { ...x, ...patch } : x) })); setErrors(p => ({ ...p, variantExtras: '' })); };
                    const setOpt   = (oi, patch) => setGroup({ options: g.options.map((o, idx) => idx === oi ? { ...o, ...patch } : o) });
                    return (
                      <div key={gi} className="rounded-xl border border-gray-200 p-3.5 space-y-2.5 bg-white">
                        <div className="flex gap-2 items-center">
                          <input type="text" placeholder="Type — e.g. Colour, Pack"
                            value={g.label}
                            onChange={e => setGroup({ label: e.target.value })}
                            className={iCls(false)} />
                          <button type="button" aria-label="Remove type"
                            onClick={() => setForm(p => ({ ...p, variantExtras: p.variantExtras.filter((_, idx) => idx !== gi) }))}
                            className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
                        </div>
                        <div className="space-y-2">
                          {g.options.map((o, oi) => (
                            <div key={oi} className="flex gap-2 items-center">
                              <input type="text" placeholder={`Option — e.g. ${['Red','Blue','Black','Green'][oi] || 'name'}`}
                                value={o.name}
                                onChange={e => setOpt(oi, { name: e.target.value })}
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                              <div className="relative w-24 flex-shrink-0">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">+₹</span>
                                <input type="number" inputMode="numeric" min={0} placeholder="0"
                                  value={o.addPrice}
                                  onChange={e => setOpt(oi, { addPrice: e.target.value })}
                                  className="w-full pl-7 pr-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition" />
                              </div>
                              <button type="button" aria-label="Remove option"
                                onClick={() => setGroup({ options: g.options.filter((_, idx) => idx !== oi) })}
                                className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
                            </div>
                          ))}
                        </div>
                        <button type="button"
                          onClick={() => setGroup({ options: [...g.options, { name: '', addPrice: '' }] })}
                          className="inline-flex items-center gap-1 text-xs font-bold transition-colors hover:opacity-80"
                          style={{ color: themeColor }}>
                          <Plus size={13} /> Add option
                        </button>
                      </div>
                    );
                  })}
                  {errors.variantExtras && (
                    <p className="text-xs text-red-500 font-medium">{errors.variantExtras}</p>
                  )}
                  <p className="text-[11px] text-gray-400 leading-relaxed">The priced type above sets the base price; these add choices on top. E.g. <strong>Colour</strong> = Red / Blue (free), <strong>Pack</strong> = Single / Combo of 3 (+₹900).</p>
                </div>
              )}
            </FormSection>
            </Accordion>

            {/* Attributes (AI-suggested or manual) — buyer-facing details */}
            {form.attributes.length > 0 && (
              <Accordion icon={Sparkles} iconBg="#f5f3ff" iconColor="#7c3aed" title="Product details"
                subtitle="Buyer-facing specs the AI suggested" openWhen>
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
              </Accordion>
            )}

            {/* Live preview — the exact storefront card, driven by the form.
                CSS brand vars are scoped here so it renders in the store's
                theme colour even though Manage doesn't apply the theme. */}
            <div className="pt-2 pb-1"
                 style={{ '--color-brand': themeColor, '--color-brand-dark': themeColor }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">How customers see it</span>
                <div className="h-px flex-1 bg-gray-100" />
              </div>
              <div className="max-w-[230px] mx-auto pointer-events-none select-none">
                <ProductCard product={previewProduct} />
              </div>
            </div>
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

      {/* Kept in view at the bottom: a long photo grid would hide it otherwise. */}
      {(dirty || saveStatus === 'saved') && (
        <div className="sticky bottom-24 lg:bottom-4 z-10 bg-white rounded-2xl border border-gray-200 shadow-lg px-4 py-3 [&>div]:mt-0 [&>div]:pt-0 [&>div]:border-t-0">
          <SaveBar
            status={saveStatus} error={saveError}
            onSave={handleSave} dirty={dirty}
            themeColor={themeColor}
          />
        </div>
      )}
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────
function ManageCategories({ config, onChange, onSave, saveStatus, saveError, domain = null }) {
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
  const [copiedCat,   setCopiedCat]   = useState(null);

  function copyCategoryLink(id) {
    const cat = userCats.find((c) => c.id === id);
    const url = publicStoreUrl(config.slug, { categoryId: categoryLinkId(cat) }, domain, window.location.origin);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedCat(id);
      setTimeout(() => setCopiedCat((c) => (c === id ? null : c)), 2000);
    }).catch(() => { /* clipboard blocked — the link is still shown in the hint below */ });
  }

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
              {/* A link straight to this category — for an Instagram bio, a
                  WhatsApp broadcast ("new masalas in stock"), or a printed QR
                  on the shelf. Without a button here nobody would ever discover
                  the URL pattern exists. */}
              <button type="button" onClick={() => copyCategoryLink(cat.id)}
                      title={`Copy link to ${cat.label}`}
                      className="p-1.5 rounded-lg transition-colors flex-shrink-0 text-gray-300 hover:text-gray-700 hover:bg-gray-100">
                {copiedCat === cat.id
                  ? <Check size={13} className="text-emerald-600" />
                  : <Copy size={13} />}
              </button>
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
// The store as the order cards need it (Orders tab and Delivery → Ship).
function orderStoreOf(config, slug) {
  return {
    slug, businessName: config.businessName, logo: config.logo,
    logoEmoji: config.logoEmoji, address: config.address, gst: config.gst,
    whatsappNumber: config.whatsappNumber, theme: config.theme,
    shipping: config.shipping, products: config.products, cart: config.cart,
    payments: config.payments,
  };
}

// A courier refused a booking for an empty wallet (courierAlerts.js): say so on
// Ship and Track until the shop says it recharged. Book courier skips it meanwhile.
function CourierWalletBanner({ slug }) {
  const [low, setLow] = useState(() => walletLow(slug));
  useEffect(() => onWalletLowChange(() => setLow(walletLow(slug))), [slug]);
  const couriers = Object.keys(low);
  if (!couriers.length) return null;
  return couriers.map((c) => {
    const name = c === 'shadowfax' ? 'Shadowfax' : 'Delhivery';
    const panel = c === 'shadowfax' ? 'https://shadowfax360.in/login' : 'https://one.delhivery.com/';
    return (
      <div key={c} className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 mb-4 space-y-2.5" role="alert">
        <div className="flex gap-2 items-start">
          <AlertTriangle size={17} className="text-amber-700 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13.5px] font-extrabold text-amber-900">{name} wallet is low</p>
            <p className="text-[12px] text-amber-900 leading-snug mt-0.5">
              Your last {name} booking failed{low[c]?.message ? `: “${low[c].message.slice(0, 90)}”` : ''}. Book courier uses your other courier until you recharge.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={panel} target="_blank" rel="noopener noreferrer"
             className="flex-1 h-11 rounded-xl bg-amber-700 text-white text-[13px] font-bold inline-flex items-center justify-center">
            Recharge {name} ↗
          </a>
          <button type="button" onClick={() => clearWalletLow(slug, c)}
                  className="flex-1 h-11 rounded-xl border border-amber-300 bg-white text-amber-900 text-[13px] font-bold">
            I’ve recharged
          </button>
        </div>
      </div>
    );
  });
}

// ── Delivery tab: Ship (what to send) · Track (every parcel) · COD money (what
// couriers owe) · Settings (couriers, charges, delivery boys, RTO protection).
// Ship is the default. WhatsApp shipping updates live in the WhatsApp tab. ───
const DELIVERY_VIEWS = [
  ['ship', 'Ship'], ['track', 'Track'], ['money', 'COD'], ['settings', 'Settings'],
];
function DeliveryTab({ slug, pin, themeColor, storeName, config, onChange, onSave, saveStatus, saveError, wide = false }) {
  const [view, setView] = useState('ship');
  const rtoRaw = config.delivery?.rto;
  const rto = useMemo(() => rtoSettings({ delivery: { rto: rtoRaw } }), [rtoRaw]);
  const orderStore = useMemo(() => orderStoreOf(config, slug), [config, slug]);
  const main = (
    <>
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 overflow-x-auto scrollbar-hide" role="tablist" aria-label="Delivery">
        {DELIVERY_VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={['flex-1 flex-shrink-0 whitespace-nowrap px-2 text-[13px] font-bold h-10 rounded-lg transition active:scale-[0.98]',
              view === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
            {label}
          </button>
        ))}
      </div>
      {(view === 'ship' || view === 'track') && <CourierWalletBanner slug={slug} />}
      {view === 'ship' && (
        <OrdersTab slug={slug} pin={pin} themeColor={themeColor} storeName={config.businessName} mode="ship"
                   riders={config.delivery?.riders || []} payInfo={{ upi: config.upi || '', bank: config.bank || null }}
                   store={orderStore} rto={rto} />
      )}
      {view === 'track' && <DeliveryBoard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} />}
      {view === 'money' && <CodMoney slug={slug} pin={pin} themeColor={themeColor} />}
      {view === 'settings' && (
        <ManageDelivery config={config} pin={pin} onChange={onChange} onSave={onSave} saveStatus={saveStatus} saveError={saveError} />
      )}
    </>
  );
  // Phone: one column, as before.
  if (!wide) return <div className="max-w-3xl mx-auto">{main}</div>;
  // Computer: the work on the left; your couriers and the customer updates on the right.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
      <div className="min-w-0">{main}</div>
      <div className="space-y-4 sticky top-[88px] max-h-[calc(100vh-104px)] overflow-y-auto">
        <CouriersSummary shipping={config.shipping} riders={config.delivery?.riders} themeColor={themeColor}
                         onSettings={() => setView('settings')} />
        <ShipUpdates slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} />
      </div>
    </div>
  );
}

// Computer Delivery, right column: which couriers are connected and which one
// books by default. A summary only: connecting and switching stay in Settings,
// the one place couriers are set up.
const COURIER_NAMES = { shadowfax: 'Shadowfax', delhivery: 'Delhivery' };
function CouriersSummary({ shipping = {}, riders = [], themeColor, onSettings }) {
  const ship = shipping || {};
  const active = ship.courier || (ship.delhivery ? 'delhivery' : ship.shadowfax ? 'shadowfax' : null);
  const rows = ['shadowfax', 'delhivery'].map((k) => ({ k, name: COURIER_NAMES[k], on: Boolean(ship[k]), isDefault: active === k }));
  const riderCount = Array.isArray(riders) ? riders.filter((r) => r && (r.phone || r.name)).length : 0;
  const btn = pinColors(themeColor).button;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-[15px] font-extrabold text-gray-900">Your couriers</p>
      <p className="text-[12px] text-gray-500 mb-3">The default is picked first when you book</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
               style={r.isDefault ? { borderColor: themeColor, background: `${themeColor}12` } : { borderColor: '#e5e7eb' }}>
            <span className="w-9 h-9 rounded-lg bg-white border border-gray-200 grid place-items-center text-gray-700 flex-shrink-0"><Truck size={17} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-bold text-gray-900">{r.name}</span>
              <span className="block text-[12px] text-gray-500">{r.on ? 'Connected' : 'Not connected'}</span>
            </span>
            {r.isDefault && <span className="text-[11px] font-extrabold px-2 py-1 rounded-md" style={{ color: btn, background: `${themeColor}1f` }}>Default</span>}
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5">
          <span className="w-9 h-9 rounded-lg bg-white border border-gray-200 grid place-items-center text-gray-700 flex-shrink-0"><Users size={17} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-bold text-gray-900">My delivery boy</span>
            <span className="block text-[12px] text-gray-500">{riderCount ? `${riderCount} saved` : 'None saved yet'}</span>
          </span>
        </div>
      </div>
      <button type="button" onClick={onSettings} className="mt-3 text-[13px] font-bold" style={{ color: btn }}>
        Connect or change in Settings →
      </button>
    </div>
  );
}

// ── Delivery tab — fulfilment, charges, areas, and the dispatch rider ─────────
function ManageDelivery({ config, pin, onChange, onSave, saveStatus, saveError }) {
  const themeColor = config.theme?.primary || '#0d9488';
  const [dirty, setDirty] = useState(false);

  function update(partial) {
    onChange(partial);
    setDirty(true);
  }
  function handleSave() {
    setDirty(false);
    onSave();
  }
  const lCls = () => 'block text-xs font-semibold text-gray-700 mb-1.5';
  const dlv  = config.delivery || {};
  const rto  = rtoSettings(config);
  const setRto = (patch) => update({ delivery: { ...dlv, rto: { ...rto, ...patch } } });
  const rtoSwitch = (key, title, desc) => {
    const on = Boolean(rto[key]) && (key === 'on' || rto.on);
    const off = key !== 'on' && !rto.on;
    return (
      <div key={key} className="flex items-start gap-3 py-2.5 border-t border-gray-50 first:border-t-0">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold ${off ? 'text-gray-400' : 'text-gray-800'}`}>{title}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={off}
          onClick={() => setRto({ [key]: !rto[key] })}
          className={['relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full p-0 transition-colors mt-0.5 disabled:opacity-50', on ? '' : 'bg-gray-200'].join(' ')}
          style={on ? { backgroundColor: themeColor } : undefined}>
          <span aria-hidden="true"
            className={['inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform', on ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">

      {/* Couriers — moved here from Settings: connect, default, disconnect */}
      <ShippingConnect config={config} pin={pin} themeColor={themeColor} onConfig={onChange} />

      {/* How orders reach customers */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">🛵 How orders reach customers</h3>
          <p className="text-xs text-gray-400 mt-0.5">Shown on your page and at checkout — customers stop asking “do you deliver here?”</p>
        </div>
        <div>
          <label className={lCls()}>Order Fulfilment</label>
          <select value={dlv.mode || 'delivery'}
                  onChange={e => update({ delivery: { ...dlv, mode: e.target.value } })}
                  className={iCls(false)}>
            <option value="delivery">Home delivery only</option>
            <option value="pickup">Pickup from shop only</option>
            <option value="both">Delivery + Pickup — customer chooses</option>
          </select>
        </div>
        {(dlv.mode || 'delivery') !== 'pickup' && (
          <>
            <div>
              <label className={lCls()}>Delivery Time <span className="text-gray-400 font-normal">(shown as a badge on your page)</span></label>
              <input type="text" placeholder="e.g. 60–90 min · same day · 2–3 days"
                     value={dlv.eta || ''}
                     onChange={e => update({ delivery: { ...dlv, eta: e.target.value } })}
                     className={iCls(false)} />
            </div>
            <div>
              <label className={lCls()}>Areas You Deliver To <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="text" placeholder="e.g. Solapur city, Hotgi Road, Vijapur Road"
                     value={dlv.areas || ''}
                     onChange={e => update({ delivery: { ...dlv, areas: e.target.value } })}
                     className={iCls(false)} />
              <p className="text-[11px] text-gray-400 mt-1">Appears under the address field when customers order.</p>
            </div>
          </>
        )}
      </div>

      {/* Charges */}
      {(dlv.mode || 'delivery') !== 'pickup' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div>
            <h3 className="text-sm font-extrabold text-gray-900">₹ Delivery charges</h3>
            <p className="text-xs text-gray-400 mt-0.5">Added to the order total automatically. Pickup orders are never charged.</p>
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
          <p className="text-xs text-gray-400">
            Set <b>Free Delivery Above</b> to <b>0</b> for no free-delivery offer — every order is
            charged the delivery fee. To make delivery free for everyone, set the <b>Delivery Charge</b> to 0.
          </p>
        </div>
      )}

      {/* Packaging + COD charges — packaging applies to every order (incl. pickup);
          COD fee only on delivery stores, added when the customer picks COD. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">₹ Order charges</h3>
          <p className="text-xs text-gray-400 mt-0.5">Extra fees on top of delivery. Leave 0 for none.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lCls()}>Packaging charge (₹)</label>
            <input type="number" inputMode="numeric" min={0} placeholder="0"
                   value={config.cart?.packagingCharge ?? ''}
                   onChange={e => update({ cart: { ...config.cart, packagingCharge: Number(e.target.value) || 0 } })}
                   className={iCls(false)} />
            <p className="mt-1 text-[11px] text-gray-400">Added to every order, incl. pickup.</p>
          </div>
          {(dlv.mode || 'delivery') !== 'pickup' && (
            <div>
              <label className={lCls()}>COD fee (₹)</label>
              <input type="number" inputMode="numeric" min={0} placeholder="0"
                     value={config.cart?.codCharge ?? ''}
                     onChange={e => update({ cart: { ...config.cart, codCharge: Number(e.target.value) || 0 } })}
                     className={iCls(false)} />
              <p className="mt-1 text-[11px] text-gray-400">Only on Cash on Delivery — waived if they pay online.</p>
            </div>
          )}
        </div>
      </div>

      {/* Your costs (private) — the merchant's OWN spend per order, never shown to
          customers. Distinct from "Order charges" above (what the customer pays).
          Feeds the real-profit maths in Stats → Profit. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">🔒 Your costs <span className="text-gray-400 font-semibold">· private</span></h3>
          <p className="text-xs text-gray-400 mt-0.5">What <b>you</b> spend per order. Never shown to customers — used to show your <b>real profit</b> in Stats.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lCls()}>Packaging cost / order (₹)</label>
            <input type="number" inputMode="numeric" min={0} placeholder="0"
                   value={config.cart?.packagingCost ?? ''}
                   onChange={e => update({ cart: { ...config.cart, packagingCost: Number(e.target.value) || 0 } })}
                   className={iCls(false)} />
            <p className="mt-1 text-[11px] text-gray-400">Box, bag, tape, filler — a rough average is fine.</p>
          </div>
          <div>
            <label className={lCls()}>Delivery cost / order (₹)</label>
            <input type="number" inputMode="numeric" min={0} placeholder="0"
                   value={config.cart?.deliveryCost ?? ''}
                   onChange={e => update({ cart: { ...config.cart, deliveryCost: Number(e.target.value) || 0 } })}
                   className={iCls(false)} />
            <p className="mt-1 text-[11px] text-gray-400">Your average courier / rider charge. Orders booked through PocketLink use the <b>exact</b> charge automatically.</p>
          </div>
        </div>
      </div>

      {/* Delivery boys */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">👤 Your delivery boys</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Every order card gets a <b>🛵 Send to delivery boy</b> button — one tap sends the
            address, items and amount to collect on WhatsApp. Add as many as you have.
          </p>
        </div>
        {(dlv.riders || []).map((r, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" placeholder="Name (e.g. Ramesh)" value={r.name || ''}
                   onChange={e => update({ delivery: { ...dlv, riders: dlv.riders.map((x, j) => j === i ? { ...x, name: e.target.value } : x) } })}
                   className={iCls(false)} />
            <input type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit WhatsApp" value={r.phone || ''}
                   onChange={e => update({ delivery: { ...dlv, riders: dlv.riders.map((x, j) => j === i ? { ...x, phone: e.target.value.replace(/\D/g, '').slice(0, 10) } : x) } })}
                   className={iCls(false)} />
            <button type="button" aria-label="Remove delivery boy"
                    onClick={() => update({ delivery: { ...dlv, riders: dlv.riders.filter((_, j) => j !== i) } })}
                    className="px-3 rounded-xl border border-gray-200 text-gray-400 hover:text-red-500 hover:bg-gray-50 flex-shrink-0 transition-colors">
              <X size={14} />
            </button>
          </div>
        ))}
        {(dlv.riders || []).length < 5 && (
          <button type="button"
                  onClick={() => update({ delivery: { ...dlv, riders: [...(dlv.riders || []), { name: '', phone: '' }] } })}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-xs font-bold
                             text-gray-500 hover:border-gray-300 hover:bg-gray-50 transition-colors">
            + Add delivery boy
          </button>
        )}
      </div>

      {/* RTO protection — risky cash-on-delivery orders are flagged on Ship */}
      {(dlv.mode || 'delivery') !== 'pickup' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-2">
          <div>
            <h3 className="text-sm font-extrabold text-gray-900">🛡 RTO protection</h3>
            <p className="text-xs text-gray-400 mt-0.5">Flags cash-on-delivery orders likely to be refused at the door, before you ship them.</p>
          </div>
          <div>
            {rtoSwitch('on', 'Check cash-on-delivery orders', 'A red “High return risk” card on the order, with the reasons')}
            {rtoSwitch('firstBig', 'First-time customer, big order', 'First order from this number and above ₹1,000')}
            {rtoSwitch('address', 'Incomplete address', 'No house or flat number in the address')}
            {rtoSwitch('refused', 'Refused before', 'This number refused or returned an order at your shop')}
            {rtoSwitch('hold', 'Ask before booking', 'Book courier asks once more for a risky order the customer has not confirmed')}
          </div>
          <div className={rto.on ? '' : 'opacity-50'}>
            <label className={lCls()}>Discount to pay online instead (₹)</label>
            <input type="number" inputMode="numeric" min={0} max={500} placeholder="20" disabled={!rto.on}
                   value={rto.discount ?? ''}
                   onChange={e => setRto({ discount: Math.min(500, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                   className={iCls(false)} />
            <p className="mt-1 text-[11px] text-gray-400">
              A risky order gets an <b>Offer ₹{rto.discount || 0} off to pay online</b> button: it lowers the total and sends a payment link. Needs online payments connected. 0 hides the button.
            </p>
          </div>
        </div>
      )}

      <SaveBar status={saveStatus} error={saveError} onSave={handleSave} dirty={dirty} themeColor={themeColor} />
    </div>
  );
}

// ── New-order alerts card (Settings) ──────────────────────────────────────────
// Device-local sound/buzz preference (not stored in config — see notifySound.js).
// Badge + pop-up are always on; this only gates the audible chime + vibration.
function OrderAlertsCard({ themeColor }) {
  const [soundOn, setSoundOn] = useState(() => orderSoundOn());

  function toggle() {
    const next = !soundOn;
    setSoundOn(next);
    setOrderSoundOn(next);
    // Turning it on doubles as a test + unlocks the AudioContext (needs a gesture).
    if (next) { playOrderChime(); buzz(); }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0"
             style={{ background: `${themeColor}14`, color: themeColor }}>
          <Bell size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-gray-900">New-order alerts</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            A red badge on <b>Orders</b> and a pop-up appear the moment an order lands — always on.
            Turn on sound to also hear a chime and feel a buzz, handy when your phone's on the
            counter during a rush.
          </p>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              {soundOn
                ? <Volume2 size={16} style={{ color: themeColor }} />
                : <VolumeX size={16} className="text-gray-400" />}
              Sound &amp; buzz
            </span>
            <div className="flex items-center gap-3">
              {soundOn && (
                <button type="button" onClick={() => { playOrderChime(); buzz(); }}
                        className="text-[11px] font-bold text-gray-500 hover:text-gray-800 underline underline-offset-2">
                  Test
                </button>
              )}
              <button type="button" role="switch" aria-checked={soundOn} aria-label="Sound and buzz on new order"
                      onClick={toggle}
                      className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                      style={{ backgroundColor: soundOn ? themeColor : '#d1d5db' }}>
                <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                                  soundOn ? 'translate-x-5' : ''].join(' ')} />
              </button>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-gray-400 leading-snug">
            Applies to <b>this device</b> only. On iPhone, keep this page open in a tab to hear the chime.
          </p>
        </div>
      </div>
    </div>
  );
}

function ManageSettings({ config, onChange, onSave, saveStatus, saveError, onDelete, pin, domainState }) {
  const themeColor  = config.theme?.primary || '#0d9488';
  // The link the owner shares: their own domain once it is live, else PocketLink (as before).
  const shareUrl    = publicStoreUrl(config.slug, {}, domainState?.domain, window.location.origin);
  const [dirty, setDirty] = useState(false);

  // Copy-link state for the store URL card
  const [copied, setCopied] = useState(false);
  function copyStoreUrl() {
    navigator.clipboard.writeText(shareUrl).then(() => {
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
    // A preset keeps its hand-tuned shades; any other colour derives its own.
    const theme = THEME_PRESETS[hex] ?? customTheme(hex);
    onChange({ theme: { ...config.theme, ...theme } });
    setDirty(true);
  }

  function updateBanner(banner) {
    onChange({ theme: { ...(config.theme || {}), banner } });
    setDirty(true);
  }

  function updateThemeMode(mode) {
    onChange({ theme: { ...(config.theme || {}), mode } });
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
            href={domainState?.domain ? shareUrl : `/${config.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-mono font-bold truncate hover:underline mb-3"
          >
            {shareUrl}
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
              href={`https://wa.me/?text=${encodeURIComponent(`Check out my page: ${shareUrl}`)}`}
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

      {/* New-order alerts — badge/pop-up always on; toggle the chime + buzz */}
      <OrderAlertsCard themeColor={themeColor} />

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

          {/* Custom "Chat on WhatsApp" message — lets owners set a short trigger
              phrase that their WhatsApp bot/automation can fire on. */}
          <div>
            <label className={lCls()}>WhatsApp chat message</label>
            <textarea rows={2} maxLength={400}
                      value={config.waMessage || ''}
                      onChange={e => update({ waMessage: e.target.value })}
                      placeholder={`Hello! I'd like to place an order from ${config.businessName || 'your store'}.`}
                      className={[iCls(false), 'resize-none'].join(' ')} />
            {(() => {
              const words = (config.waMessage || '').trim().split(/\s+/).filter(Boolean).length;
              const over  = words > 50;
              return (
                <p className={['mt-1 text-xs', over ? 'text-amber-600' : 'text-gray-400'].join(' ')}>
                  The message a customer sends when they tap “Chat on WhatsApp”. Keep it short so your WhatsApp bot can trigger on it
                  {over ? ` — ${words} words may be too long to trigger` : (words ? ` — ${words} words` : '')}. Leave blank to use the default.
                </p>
              );
            })()}
          </div>

          {/* Meta Pixel — conversion tracking for stores running Facebook/Instagram ads */}
          <div>
            <label className={lCls()}>Meta Pixel ID <span className="text-gray-400 font-normal">· for Facebook/Instagram ads</span></label>
            {getPlanLimits(effectivePlan(config)).metaPixel ? (
              <>
                <input type="text" inputMode="numeric" maxLength={20} placeholder="e.g. 123456789012345"
                       value={config.metaPixelId || ''}
                       onChange={e => update({ metaPixelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 20) })}
                       className={iCls(false)} />
                <p className="mt-1 text-xs text-gray-400">
                  Running Meta ads? Paste your Pixel ID (Meta Events Manager → Data sources) — we'll track product views, add-to-carts &amp; orders so your ads can optimise for buyers &amp; retarget. Leave blank to turn off.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5">
                <p className="text-xs text-gray-500">
                  Track your Meta ad sales on <b>Pro</b> —{' '}
                  <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
                     className="font-semibold underline text-brand-dark">upgrade →</a>
                </p>
              </div>
            )}
          </div>

          {/* Connect Meta — Facebook Login for Business (Stage 1: OAuth connect) */}
          <MetaConnect config={config} pin={pin} themeColor={themeColor} onConfig={onChange} />

          {/* Online payments — connect the store's own Razorpay */}
          <PaymentsConnect config={config} pin={pin} themeColor={themeColor} onConfig={onChange} />

          {/* Couriers moved to Delivery → Settings (2026-11 Delivery redesign) */}
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3.5 py-2.5">
            🚚 <b>Couriers</b> (Delhivery, Shadowfax) are now in <b>Delivery → Settings</b>.
          </p>

          {/* Own domain — shown only when the server allows this store */}
          <DomainConnect slug={config.slug} pin={pin} themeColor={themeColor} domainState={domainState}
                         payments={config.payments} onPayments={(payments) => update({ payments })}
                         hasPixel={Boolean(config.metaPixelId || config.meta?.pixelId)} />

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

              {/* Custom colour — pick ANY brand colour via the OS picker. The
                  darker hover shade is derived automatically (customTheme). */}
              {(() => {
                const current  = config.theme?.primary || '#0d9488';
                const isCustom = !THEME_PRESETS[current];
                return (
                  <label title="Custom colour"
                         className={[
                           'relative w-9 h-9 rounded-full cursor-pointer flex items-center justify-center overflow-hidden transition-all',
                           isCustom ? 'ring-2 ring-offset-2 ring-gray-700 scale-110' : 'hover:scale-105 opacity-90 hover:opacity-100',
                         ].join(' ')}
                         style={isCustom
                           ? { backgroundColor: current }
                           : { background: 'conic-gradient(from 90deg, #ef4444, #f59e0b, #16a34a, #06b6d4, #6366f1, #ec4899, #ef4444)' }}>
                    {isCustom ? (
                      <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-white" fill="none">
                        <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <Plus size={15} className="text-white drop-shadow" strokeWidth={3} />
                    )}
                    <input type="color" value={current} onChange={(e) => updateTheme(e.target.value)}
                           aria-label="Pick a custom brand colour"
                           className="absolute inset-0 opacity-0 cursor-pointer" />
                  </label>
                );
              })()}
            </div>
            <p className="mt-2 text-xs text-gray-400">Pick a preset or tap the rainbow swatch for any colour — your whole store recolours instantly.</p>
          </div>

          {/* Storefront theme — Light vs Premium Dark (brand colour stays the accent) */}
          {(() => {
            const tc = config.theme?.primary || '#0d9488';
            const mode = config.theme?.mode === 'dark' ? 'dark' : 'light';
            const OPTS = [
              { v: 'light', t: 'Light', d: 'Clean & bright', chip: '#f8fafc', line: '#e5e7eb' },
              { v: 'dark',  t: 'Premium Dark', d: 'Bold, dark & luxe', chip: '#0c1310', line: '#1f2a24' },
            ];
            return (
              <div>
                <label className={lCls()}>Storefront theme</label>
                <div className="flex gap-2.5 max-w-md">
                  {OPTS.map((opt) => {
                    const active = mode === opt.v;
                    return (
                      <button key={opt.v} type="button" onClick={() => updateThemeMode(opt.v)}
                        className={['flex-1 rounded-2xl border p-3 text-left transition active:scale-[0.98]',
                          active ? 'border-transparent' : 'border-gray-200 hover:border-gray-300'].join(' ')}
                        style={active ? { boxShadow: `0 0 0 2px ${tc}`, backgroundColor: `${tc}0d` } : undefined}>
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg border flex-shrink-0 relative" style={{ backgroundColor: opt.chip, borderColor: opt.line }}>
                            <span className="absolute bottom-1.5 left-1.5 right-3 h-1.5 rounded-full" style={{ backgroundColor: tc }} />
                            <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: opt.v === 'dark' ? '#233029' : '#e5e7eb' }} />
                          </span>
                          <span>
                            <span className="block text-sm font-bold text-gray-900">{opt.t}</span>
                            <span className="block text-[11px] text-gray-400">{opt.d}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-400">Premium Dark gives your storefront a bold, dark look — great for jewellery, décor, fashion &amp; gifts. Your brand colour stays the accent.</p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Banner style — the colored header behind the store card (no cover photo) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Banner Style</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {BANNER_STYLES.map(({ id, label }) => {
            const selected = (config.theme?.banner || 'aurora') === id;
            return (
              <button key={id} type="button" onClick={() => updateBanner(id)}
                className={[
                  'rounded-xl overflow-hidden border-2 transition-all active:scale-95',
                  selected ? 'border-gray-800 shadow-md' : 'border-gray-100 hover:border-gray-300',
                ].join(' ')}>
                <div className="h-12 w-full">
                  <HeroBanner style={id} primary={themeColor} primaryDark={config.theme?.primaryDark || themeColor} />
                </div>
                <div className={['text-[11px] font-bold text-center py-1.5', selected ? 'text-gray-800' : 'text-gray-400'].join(' ')}>{label}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-400">Shown on your store when you haven't added a cover photo.</p>
      </div>

      {/* Local Referrals — when a customer searches for something OUTSIDE this
          store's categories, offer a gentle link to find it on the PocketLink
          marketplace. Never triggers for what the store actually sells. */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-gray-100" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Local Referrals</span>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        {(() => {
          const on = config.localReferrals !== false;
          return (
            <div className="flex items-start gap-3">
              <button type="button" role="switch" aria-checked={on}
                onClick={() => update({ localReferrals: !on })}
                className={['relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full p-0 transition-colors mt-0.5', on ? '' : 'bg-gray-200'].join(' ')}
                style={on ? { backgroundColor: themeColor } : undefined}>
                <span aria-hidden="true"
                  className={['inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform', on ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-800">Help customers find items you don’t sell</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  When someone searches for something <strong>outside your categories</strong>, show a gentle “find it at nearby PocketLink shops” link.
                  You’re <strong>never</strong> referred out for what you actually sell — and other shops send their customers to you the same way. A win-win referral chain.
                </p>
              </div>
            </div>
          );
        })()}
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
            <ImageUploader value={config.logo || ''} onChange={v => update({ logo: v })} maxDim={LOGO_MAX_DIM} />
          </div>
          <div>
            <label className={lCls()}>Cover Photo</label>
            <ImageUploader value={config.coverImage || ''} onChange={v => update({ coverImage: v })} maxDim={1600} lowResWarnBelow={1200}
              lowResHint="This image is low-resolution and will look blurry across the wide banner. Upload one at least 1200px wide for a crisp cover." />
            <p className="text-[11px] text-gray-400 mt-1.5">Use a wide, high-resolution photo (1600px+) — it stretches across the top of your page.</p>
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
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Pricing &amp; Tax</span>
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
            <input type="text" placeholder="yourname@oksbi" inputMode="email" autoCapitalize="none" spellCheck={false}
                   value={config.upi || ''}
                   onChange={e => update({ upi: e.target.value.trim() })}
                   className={iCls(Boolean(config.upi) && !isValidUpiVpa(config.upi))} />
            {Boolean(config.upi) && !isValidUpiVpa(config.upi) ? (
              <p className="mt-1 text-xs text-red-500 leading-snug">
                That doesn’t look like a UPI ID. It must end in a bank handle like
                <b> @oksbi</b>, <b>@ybl</b> or <b>@paytm</b> — not an email like <b>@gmail.com</b>.
                An invalid UPI ID makes every payment fail.
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">Customers can pay you directly — the amount is pre-filled in their UPI app.</p>
            )}
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
// Sections laid out for the full computer width (the rest keep a reading column).
const WIDE_TABS = new Set(['home', 'orders', 'products', 'delivery', 'whatsapp', 'customers']);
// True on a computer-sized screen (the side menu shows from Tailwind's lg, 1024px).
function useIsDesktop() {
  const query = '(min-width: 1024px)';
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setMatch(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return Boolean(match);
}

export default function ManageStore() {
  const { businessSlug }  = useParams();
  const navigate          = useNavigate();
  const [loading,     setLoading]     = useState(true);
  const [notFound,    setNotFound]    = useState(false);
  const [pinVerified, setPinVerified] = useState(false);
  const [storePin,    setStorePin]    = useState('');
  const [config,      setConfig]      = useState(null);
  const [tab,         setTab]         = useState('home');   // 'more' = the phone's all-sections screen
  const [phoneSearch, setPhoneSearch] = useState(false);    // the phone's full-screen search
  // Text handed from the dashboard search to a section's own search box.
  const [searchSeed,  setSearchSeed]  = useState({ tab: '', q: '', n: 0 });
  const [shared,      setShared]      = useState(false);    // "Link copied" after Share page
  const [arrivals,    setArrivals]    = useState([]);       // orders that landed while open (the bell)
  const isDesktop = useIsDesktop();
  const [saveStatus,  setSaveStatus]  = useState('idle');  // idle | saving | saved | error
  const [saveError,   setSaveError]   = useState('');
  const saveTimerRef = useRef(null);

  // ── New-order alerts (badge · pop-up · chime) ──────────────────────────────
  // A tiny PIN-checked poll (useNewOrders) tells us when an order lands. The
  // badge count feeds the Orders nav item; a toast + chime fire on arrival.
  const [toast, setToast] = useState(null);          // { name, total, at, count } | null
  const tabRef       = useRef(tab);                  // read the live tab inside async poll
  const toastTimerRef = useRef(null);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const handleOrderArrive = useCallback((order, delta) => {
    alertNewOrder();                                 // chime + buzz (only if opted in)
    if (tabRef.current !== 'orders') setToast({ ...order, count: delta });
    setArrivals((list) => [{ ...order, count: delta, at: Date.now(), id: `${Date.now()}-${list.length}` }, ...list].slice(0, 20));
  }, []);

  // "More" is the phone's screen; on a computer the side menu already shows it all.
  if (isDesktop && tab === 'more') setTab('home');
  // Moving between sections. A search hand-off only applies to the section it
  // was made for, so leaving that section drops it.
  const goTab = useCallback((key) => {
    setTab(key);
    setSearchSeed((s) => (s.tab && s.tab !== key ? { ...s, tab: '', q: '' } : s));
  }, []);

  const { newCount, markSeen } = useNewOrders({
    slug: businessSlug, pin: storePin, enabled: pinVerified, onArrive: handleOrderArrive,
  });

  // ── Own domain: one PIN-checked status read; `domain` is set only while it is live ──
  const domainState = useStoreDomain({ slug: businessSlug, pin: storePin, enabled: pinVerified });
  const liveDomain  = domainState.domain;

  // Opening Orders (or a fresh order arriving while you're already there) clears
  // the badge + any toast — you've now seen them.
  useEffect(() => {
    if (tab === 'orders') { markSeen(); setToast(null); }
  }, [tab, newCount, markSeen]);

  // Auto-dismiss the toast after 6s.
  useEffect(() => {
    if (!toast) return;
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  // Load store
  useEffect(() => {
    setLoading(true);
    // onFresh: when the background DB refresh returns a newer config than the
    // cached copy (e.g. Razorpay/Delhivery was just connected server-side), apply
    // it — otherwise the owner keeps seeing a stale "not connected" Settings card.
    loadBusiness(businessSlug, { onFresh: (fresh) => { if (fresh) setConfig(fresh); } }).then(cfg => {
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
    return <PinGate slug={businessSlug} config={config} onVerified={(pin) => { setStorePin(pin); setPinVerified(true); }} />;
  }

  // ── Management Dashboard ──────────────────────────────────────────────────
  const themeColor = config.theme?.primary || '#0d9488';

  // Free-trial / renewal state (coupon-granted plans expire; see effectivePlan).
  // A store with a Razorpay subscription is a paying customer — NOT on a trial —
  // so the "Free … trial" banners must never show for them.
  const rawPlan    = config.plan || 'free';
  const isPaying   = !!config.razorpaySubscriptionId;
  const daysLeft   = trialDaysLeft(config);
  const onTrial    = !isPaying && rawPlan !== 'free' && daysLeft !== null && daysLeft > 0;
  const trialEnded = !isPaying && rawPlan !== 'free' && config.planExpiresAt && effectivePlan(config) === 'free';
  // Subscription expiry states for PAYING customers. The webhook pushes
  // planExpiresAt forward on every successful auto-charge (with ~3 days grace),
  // so a paying store whose expiry is ≤3 days away means the renewal charge
  // hasn't landed — warn before it lapses. Once it lapses, effectivePlan
  // reverts to 'free' silently; subEnded surfaces that downgrade to the owner.
  const renewalDue = isPaying && rawPlan !== 'free' && daysLeft !== null && daysLeft > 0 && daysLeft <= 3;
  const subEnded   = isPaying && rawPlan !== 'free' && config.planExpiresAt && effectivePlan(config) === 'free';
  const planLapsed = trialEnded || subEnded;
  const planName   = getPlanLimits(rawPlan).name;

  const analyticsEnabled  = !!getPlanLimits(effectivePlan(config)).analytics;
  const analyticsAdvanced = getPlanLimits(effectivePlan(config)).analytics === 'full';
  const aiInsightsEnabled = !!getPlanLimits(effectivePlan(config)).aiEmployee;
  // Service stores collect quote inquiries, not cart orders — same tab, same
  // data, lead-flavored vocabulary (see OrdersTab mode="leads").
  const isService = config.businessType === 'service';
  const isRestaurant = config.businessType === 'restaurant';
  const TABS = [
    { key: 'home',       label: 'Home',        icon: LayoutDashboard },
    { key: 'assistant',  label: 'Assistant',   icon: Bot },
    { key: 'orders',     label: isService ? 'Leads' : 'Orders', icon: ShoppingBag },
    ...(isService ? [] : [{ key: 'payments', label: 'Payments', icon: Wallet }]),
    ...(isService ? [] : [{ key: 'abandoned', label: 'Abandoned carts', icon: ShoppingCart }]),
    ...(isService ? [] : [{ key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }]),
    { key: 'customers',  label: 'Customers',   icon: Users },
    { key: 'analytics',  label: 'Stats',       icon: BarChart3 },
    { key: 'insights',   label: 'AI Insights', icon: Sparkles  },
    ...(isService ? [] : [{ key: 'ads', label: 'Ads', icon: Megaphone }]),
    { key: 'reviews',    label: 'Reviews',     icon: Star      },
    { key: 'products',   label: isRestaurant ? 'Menu' : 'Products', icon: Package  },
    { key: 'offers',     label: 'Offers',      icon: Percent  },
    ...(isService ? [] : [{ key: 'delivery', label: 'Delivery', icon: Truck }]),
    { key: 'settings',   label: 'Settings',    icon: Settings2 },
  ];

  // Mobile bottom bar: the daily screens one thumb-tap away. Stores that ship get
  // Delivery in the bar (Products moves under "More"); service stores keep
  // Products since they have no Delivery tab.
  const bottomTabs = [
    { key: 'home',      label: 'Home',                         Icon: LayoutDashboard },
    { key: 'orders',    label: isService ? 'Leads' : 'Orders', Icon: ShoppingBag },
    isService
      ? { key: 'products', label: isRestaurant ? 'Menu' : 'Products', Icon: Package }
      : { key: 'delivery', label: 'Delivery', Icon: Truck },
    { key: 'customers', label: 'Customers',                    Icon: Users },
  ];
  const bottomKeys = bottomTabs.map((t) => t.key);

  // ── The frame: side menu, top bars, search, bell, "More" ───────────────────
  const colors    = shellColors(themeColor);
  const badges    = { orders: newCount };
  const viewHref  = publicStoreUrl(businessSlug, {}, liveDomain, window.location.origin);
  const address   = liveDomain || `pocketlink.store/${businessSlug}`;
  const planTitle = rawPlan === 'free' || planLapsed ? 'Free plan' : `${planName} plan`;
  const planText  = planLine({ plan: rawPlan, isPaying, onTrial, daysLeft, planExpiresAt: config.planExpiresAt, lapsed: planLapsed });
  const ordersNoun = isService ? 'lead' : 'order';
  const current   = tab === 'more' ? 'home' : tab;
  const tabLabel  = TABS.find((t) => t.key === current)?.label || 'Manage';

  const goPlans = () => {
    sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''));
    window.location.href = '/plans';
  };
  const openPlan  = () => (rawPlan === 'free' || planLapsed ? goPlans() : goTab('settings'));
  const lock      = () => { setPinVerified(false); setStorePin(''); goTab('home'); };
  async function shareStore() {
    if (navigator.share) {
      try { await navigator.share({ title: config.businessName, text: `Order from ${config.businessName}`, url: viewHref }); } catch { /* dismissed */ }
      return;
    }
    try { await navigator.clipboard?.writeText(viewHref); setShared(true); setTimeout(() => setShared(false), 2500); } catch { /* ignore */ }
  }
  // The dashboard search hands its text to the section's own search box.
  const findIn = (key, q) => {
    const products = config.products || [];
    // The products box exists whenever there are products to search.
    const seedable = key !== 'products' || products.length > 0;
    setSearchSeed((s) => ({ tab: seedable ? key : '', q: seedable ? q : '', n: s.n + 1 }));
    setTab(key);
    setPhoneSearch(false);
  };
  const seedFor = (key) => (searchSeed.tab === key ? searchSeed : null);
  const searchProps = {
    tabs: TABS, products: config.products || [], onFind: findIn,
    onSection: (k) => { goTab(k); setPhoneSearch(false); },
  };
  const bell = (variant) => (
    <AlertsBell newCount={newCount} arrivals={arrivals} noun={ordersNoun} variant={variant}
                onOpenOrders={() => goTab('orders')} />
  );

  return (
    <div className="min-h-screen bg-[#f5f6f5] lg:pl-64">

      {/* ── Top bars: computer (search, bell, share, view) and phone ────────── */}
      <DesktopTopBar title={tabLabel} subtitle={sectionSubtitle(current, { isService })}
        search={<GlobalSearch {...searchProps} />} bell={bell('bar')}
        onShare={shareStore} shared={shared} viewHref={viewHref} colors={colors} />
      {tab !== 'more' && (
        <PhoneTopBar config={config} colors={colors} isHome={tab === 'home'} title={tabLabel}
          showBack={!bottomKeys.includes(tab)} onBack={() => goTab('more')}
          onSearch={() => setPhoneSearch(true)} bell={bell('phone')} />
      )}
      {phoneSearch && <GlobalSearch {...searchProps} variant="page" onClose={() => setPhoneSearch(false)} />}

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
      {renewalDue && (
        <div className="bg-amber-500 text-white text-center text-xs font-semibold px-4 py-2">
          ⚠️ Your {planName} renewal payment hasn’t gone through — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} before your page moves to Free.{' '}
          <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))} className="underline underline-offset-2">Renew now →</a>
        </div>
      )}
      {subEnded && (
        <div className="bg-amber-500 text-white text-center text-xs font-semibold px-4 py-2">
          Your {planName} subscription has ended — page is on Free now.{' '}
          <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))} className="underline underline-offset-2">Renew {planName} →</a>
        </div>
      )}

      {/* ── Computer side menu (dark, shop-colour glow) ─────────────────────── */}
      <ManageSidebar config={config} tabs={TABS} tab={current} onSelect={goTab} badges={badges}
        colors={colors} planName={planTitle} planText={planText} onPlan={openPlan} onLock={lock} />

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      {/* Home is a wide two-column screen on a computer; the other sections keep their reading width. */}
      <main className={`max-w-lg ${WIDE_TABS.has(current) ? 'lg:max-w-[1240px] lg:px-8' : 'lg:max-w-3xl'} mx-auto px-4 pt-6 pb-24 lg:pb-6`}>
        {tab === 'more' && (
          <MoreScreen config={config} tabs={TABS} badges={badges} colors={colors} address={address}
            planName={planTitle} planText={planText} onSelect={goTab} onPlan={openPlan} onLock={lock}
            onShare={shareStore} shared={shared} viewHref={viewHref} />
        )}
        {/* Reach hook — only on the Orders tab (the default landing). Settings has
            its own "share your page" hero and Stats has its own views number, so
            showing it everywhere would stack duplicate share cards. */}
        {/* Downgrade explainer — shown once a paid plan (trial or subscription)
            has lapsed and the page is running on Free. Same card idiom as
            ReachCard; reassures that nothing was deleted + one-tap renew. */}
        {tab === 'orders' && planLapsed && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-5">
            <div className="px-4 pt-3.5 pb-3" style={{ background: `linear-gradient(135deg, ${themeColor}14, transparent)` }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={14} style={{ color: themeColor }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: themeColor }}>
                  Plan update
                </span>
              </div>
              <p className="text-base font-extrabold text-gray-900">
                Your {planName} {subEnded ? 'subscription' : 'trial'} has ended
              </p>
            </div>
            <div className="px-4 pt-3 pb-4">
              <p className="text-sm text-gray-600">
                Your page is on the <span className="font-semibold text-gray-800">Free</span> plan now.
                Nothing has been deleted — your page and products are still live.
              </p>
              <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                <p>· “Powered by PocketLink” badge is back on your page</p>
                <p>· Verified badge, AI assistant, Stats &amp; Offers are paused</p>
                {(config.products || []).length > getPlanLimits('free').products && (
                  <p>· You have {(config.products || []).length} products — Free includes {getPlanLimits('free').products}, so adding more is locked</p>
                )}
              </div>
              <a href="/plans"
                 onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
                 className="mt-4 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold
                            text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
                 style={{ backgroundColor: themeColor }}>
                Renew {planName} →
              </a>
            </div>
          </div>
        )}
        {/* On a computer Orders is a list + detail screen; Share page sits in the top bar. */}
        {tab === 'orders' && !isDesktop && (
          <ReachCard slug={businessSlug} themeColor={themeColor} businessName={config.businessName}
                     upgrade={!analyticsEnabled} phone={config.whatsappNumber} domain={liveDomain} />
        )}
        {tab === 'more' ? null : tab === 'home' ? (
          <div className="animate-pl-fade-up">
            <OverviewTab slug={businessSlug} pin={storePin} config={config} themeColor={themeColor}
                         businessName={config.businessName} onGoTab={goTab} onFind={findIn} domain={liveDomain} />
          </div>
        ) : tab === 'assistant' ? (
          <div className="animate-pl-fade-up">
            <AssistantTab config={config} themeColor={themeColor} onGoTab={goTab} businessName={config.businessName} />
          </div>
        ) : tab === 'orders' ? (
          <div className="animate-pl-fade-up">
            <OrdersTab slug={businessSlug} pin={storePin} themeColor={themeColor} storeName={config.businessName}
                       mode={isService ? 'leads' : 'orders'} riders={config.delivery?.riders || []}
                       payInfo={{ upi: config.upi || '', bank: config.bank || null }}
                       store={orderStoreOf(config, businessSlug)} rto={rtoSettings(config)}
                       searchSeed={seedFor('orders')} wide={isDesktop} />
          </div>
        ) : tab === 'payments' ? (
          <div className="animate-pl-fade-up">
            <PaymentsTab slug={businessSlug} pin={storePin} themeColor={themeColor} storeName={config.businessName}
                         razorpayConnected={Boolean(config.payments?.razorpay)}
                         hasCourier={Boolean(config.shipping?.delhivery || config.shipping?.shadowfax)}
                         products={config.products} packagingCost={config.cart?.packagingCost}
                         deliveryCost={config.cart?.deliveryCost}
                         store={{ businessName: config.businessName, logo: config.logo, logoEmoji: config.logoEmoji,
                                  whatsappNumber: config.whatsappNumber, address: config.address, city: config.city,
                                  gst: config.gst, theme: config.theme }}
                         onGoTab={goTab} />
          </div>
        ) : tab === 'abandoned' ? (
          <div className="animate-pl-fade-up">
            <AbandonedTab slug={businessSlug} pin={storePin} themeColor={themeColor} storeName={config.businessName}
                          allowed={Boolean(getPlanLimits(effectivePlan(config)).abandonedCarts)}
                          waPhone={config.whatsappNumber} />
          </div>
        ) : tab === 'whatsapp' ? (
          <div className="animate-pl-fade-up">
            <WhatsAppTab slug={businessSlug} pin={storePin} themeColor={themeColor} storeName={config.businessName}
                         waPhone={config.whatsappNumber} onGoTab={goTab}
                         cartAllowed={Boolean(getPlanLimits(effectivePlan(config)).abandonedCarts)} wide={isDesktop} />
          </div>
        ) : tab === 'customers' ? (
          <div className="animate-pl-fade-up">
            <CustomersTab slug={businessSlug} pin={storePin} themeColor={themeColor} businessName={config.businessName}
                          searchSeed={seedFor('customers')} wide={isDesktop} />
          </div>
        ) : tab === 'analytics' ? (
          <div className="animate-pl-fade-up">
            <AnalyticsTab slug={businessSlug} pin={storePin} themeColor={themeColor} enabled={analyticsEnabled} advanced={analyticsAdvanced} products={config.products} packagingCost={config.cart?.packagingCost} deliveryCost={config.cart?.deliveryCost} onGoTab={goTab} />
          </div>
        ) : tab === 'reviews' ? (
          <div className="animate-pl-fade-up">
            <ReviewsTab slug={businessSlug} pin={storePin} themeColor={themeColor} businessName={config.businessName} />
          </div>
        ) : tab === 'insights' ? (
          <div className="animate-pl-fade-up">
            <AiInsightsTab slug={businessSlug} pin={storePin} themeColor={themeColor}
                           enabled={aiInsightsEnabled} businessName={config.businessName} config={config} domain={liveDomain} />
          </div>
        ) : tab === 'ads' ? (
          <div className="animate-pl-fade-up">
            <AdsTab config={config} pin={storePin} themeColor={themeColor} onConfig={handleChange} />
          </div>
        ) : tab === 'delivery' ? (
          <div className="animate-pl-fade-up">
            <DeliveryTab
              slug={businessSlug}
              pin={storePin}
              themeColor={themeColor}
              storeName={config.businessName || businessSlug}
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
              wide={isDesktop}
            />
          </div>
        ) : tab === 'products' ? (
          // Products: the photo grid at full width; categories below it.
          <div className="space-y-6 animate-pl-fade-up">
            <ManageProducts
              config={config}
              onChange={handleChange}
              onSave={handleSave}
              saveStatus={saveStatus}
              saveError={saveError}
              searchSeed={seedFor('products')}
            />
            <div id="manage-categories" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 scroll-mt-24">
              <ManageCategories
                config={config}
                onChange={handleChange}
                onSave={handleSave}
                saveStatus={saveStatus}
                saveError={saveError}
                domain={liveDomain}
              />
            </div>
          </div>
        ) : (
        <div key={tab} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pl-fade-up">
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
              pin={storePin}
              domainState={domainState}
            />
          )}
        </div>
        )}
      </main>

      {/* ── Mobile bottom tab bar — the 4 daily screens one thumb-tap away; the
             rest live under "More" (opens the drawer). Solid white (no blur) to
             stay smooth on iOS Safari. Desktop keeps the drawer nav. ────────── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-100
                      shadow-[0_-2px_12px_-6px_rgba(0,0,0,0.12)]"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-lg mx-auto px-1.5 flex">
          {bottomTabs.map(({ key, label, Icon }) => {
            const active = tab === key;
            const badge  = key === 'orders' ? newCount : 0;
            return (
              <button key={key} type="button" onClick={() => goTab(key)}
                aria-label={badge > 0 ? `${label}, ${badge} new` : label} aria-current={active ? 'page' : undefined}
                className="flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition-transform"
                style={{ color: active ? themeColor : '#9ca3af' }}>
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500
                                     text-white text-[9px] font-extrabold tabular-nums grid place-items-center
                                     ring-2 ring-white">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-bold leading-none">{label}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => goTab('more')} aria-label="More sections"
            aria-current={tab === 'more' ? 'page' : undefined}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition-transform"
            style={{ color: bottomKeys.includes(tab) ? '#9ca3af' : themeColor }}>
            <LayoutGrid size={20} strokeWidth={bottomKeys.includes(tab) ? 2 : 2.4} />
            <span className="text-[10px] font-bold leading-none">More</span>
          </button>
        </div>
      </nav>

      {/* New-order pop-up — appears on arrival when you're not on Orders; tapping
          it (or opening Orders) clears the badge via the tab effect above. */}
      {toast && (
        <NewOrderToast
          order={toast} count={toast.count} themeColor={themeColor}
          onView={() => goTab('orders')}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
