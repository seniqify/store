import { useState, useRef } from 'react';
import { Plus, X, AlertCircle, ImagePlus, Link2, Pencil, Lock } from 'lucide-react';
import { getPlanLimits, canAddProduct, canAddCategory } from '../../utils/planLimits';

/**
 * StepProducts — Onboarding Step 2
 *
 * Supports full CRUD on both categories and products:
 *  • Add / Edit / Remove category
 *  • Add / Edit / Remove product
 *
 * Only ONE inline form (category OR product) is open at a time.
 * Opening a form while editing stores editingProductId / editingCatId so the
 * submit handler knows whether to insert or update.
 */

const CAT_EMOJIS = [
  '📦', '🔌', '🧵', '🍽️', '⚙️', '📱',
  '🏠', '🎯', '💻', '🔧', '🚗', '👕',
  '🌿', '💎', '🎸', '🛒', '🔩', '🌾',
];

const UNIT_OPTIONS = [
  'per piece', 'per kg', 'per metre', 'per litre',
  'pack of 2', 'pack of 3', 'pack of 6', 'pack of 12',
  'per box', 'per set', 'per dozen', 'Other…',
];

const STANDARD_UNITS = UNIT_OPTIONS.filter(u => u !== 'Other…');

const EMPTY_PRODUCT = {
  name: '', category: '', price: '', mrp: '',
  unit: 'per piece', unitCustom: '', description: '', image: '',
};

const EMPTY_CAT_FORM = { emoji: '📦', label: '' };

function inputCls(hasError) {
  return [
    'w-full px-3 py-2 rounded-xl border text-sm text-gray-900',
    'placeholder-gray-400 transition focus:outline-none focus:ring-2',
    hasError
      ? 'border-red-400 focus:ring-red-200 bg-red-50'
      : 'border-gray-200 focus:ring-gray-300 bg-white',
  ].join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageUploader — drag-drop / click-to-upload + URL paste fallback
// ─────────────────────────────────────────────────────────────────────────────
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
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        onChange(canvas.toDataURL('image/jpeg', 0.82));
        setUrlMode(false);
        setUrlInput('');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    compressAndSet(e.dataTransfer.files?.[0]);
  }

  function applyUrl() {
    const trimmed = urlInput.trim();
    if (trimmed) { onChange(trimmed); setUrlMode(false); }
  }

  function clearImage() {
    onChange('');
    setUrlInput('');
    setUrlMode(false);
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  if (hasImage) {
    return (
      <div className="flex items-start gap-3">
        <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden
                        border border-gray-200 bg-gray-50">
          <img src={value} alt="Product preview"
               className="w-full h-full object-cover"
               onError={() => onChange('')} />
        </div>
        <div className="flex flex-col gap-1.5 pt-0.5">
          <p className="text-xs font-semibold text-gray-700">
            {isBase64 ? '✅ Image uploaded' : '🔗 Image URL set'}
          </p>
          <p className="text-[11px] text-gray-400 leading-snug max-w-[180px] truncate">
            {isBase64 ? 'Compressed & ready' : value}
          </p>
          <div className="flex gap-2 mt-0.5">
            <button type="button" onClick={() => fileRef.current?.click()}
                    className="text-xs font-medium text-brand hover:text-brand-dark
                               underline underline-offset-2 transition-colors">
              Change
            </button>
            <span className="text-gray-300">·</span>
            <button type="button" onClick={clearImage}
                    className="text-xs font-medium text-red-400 hover:text-red-600
                               underline underline-offset-2 transition-colors">
              Remove
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
               onChange={(e) => compressAndSet(e.target.files?.[0])} />
      </div>
    );
  }

  // ── URL paste mode ────────────────────────────────────────────────────────
  if (urlMode) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="url" autoFocus placeholder="https://example.com/product.jpg"
                 value={urlInput}
                 onChange={(e) => setUrlInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && applyUrl()}
                 className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white
                            focus:outline-none focus:ring-2 focus:ring-gray-300 placeholder-gray-400" />
          <button type="button" onClick={applyUrl}
                  className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs
                             font-semibold hover:bg-gray-700 transition-colors">
            Set
          </button>
          <button type="button" onClick={() => { setUrlMode(false); setUrlInput(''); }}
                  className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Paste a direct link to any image (.jpg / .png / .webp etc.)
        </p>
      </div>
    );
  }

  // ── Upload zone ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <button type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={[
                'w-full rounded-xl border-2 border-dashed py-5 px-4',
                'flex flex-col items-center gap-2 transition-all cursor-pointer',
                dragOver
                  ? 'border-gray-500 bg-gray-100 scale-[1.01]'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
              ].join(' ')}>
        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
          <ImagePlus size={18} className="text-gray-400" />
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold text-gray-600">
            Click to upload or drag &amp; drop
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            JPG, PNG, WebP · auto-compressed to 400 px
          </p>
        </div>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
             onChange={(e) => compressAndSet(e.target.files?.[0])} />
      <button type="button" onClick={() => setUrlMode(true)}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600
                         transition-colors mx-auto">
        <Link2 size={11} />
        Use image URL instead
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepProducts
// ─────────────────────────────────────────────────────────────────────────────
const MODE_LABELS = {
  product:  { plural: 'Products',   singular: 'Product',   add: 'Add Product'    },
  menuitem: { plural: 'Menu Items', singular: 'Menu Item', add: 'Add Menu Item'  },
  service:  { plural: 'Services',   singular: 'Service',   add: 'Add Service'    },
  room:     { plural: 'Rooms',      singular: 'Room',      add: 'Add Room'       },
};

export default function StepProducts({ data, onChange, onNext, onBack, themeColor = '#0d9488', plan = 'free', mode = 'product' }) {
  const labels = MODE_LABELS[mode] ?? MODE_LABELS.product;
  const limits = getPlanLimits(plan);
  const [activeForm,       setActiveForm]       = useState(null);   // 'category' | 'product' | null
  const [catForm,          setCatForm]          = useState(EMPTY_CAT_FORM);
  const [editingCatId,     setEditingCatId]     = useState(null);   // cat.id being edited
  const [productForm,      setProductForm]      = useState(EMPTY_PRODUCT);
  const [editingProductId, setEditingProductId] = useState(null);   // product.tempId being edited
  const [prodErrors,       setProdErrors]       = useState({});

  // ── Helpers: clear all editing state ────────────────────────────────────
  function resetForms() {
    setCatForm(EMPTY_CAT_FORM);
    setEditingCatId(null);
    setProductForm(EMPTY_PRODUCT);
    setEditingProductId(null);
    setProdErrors({});
    setActiveForm(null);
  }

  // ── Open: new category ────────────────────────────────────────────────────
  function openCategoryForm() {
    setProductForm(EMPTY_PRODUCT);
    setEditingProductId(null);
    setProdErrors({});
    setCatForm(EMPTY_CAT_FORM);
    setEditingCatId(null);
    setActiveForm('category');
  }

  // ── Open: edit existing category ─────────────────────────────────────────
  function openEditCategory(cat) {
    setProductForm(EMPTY_PRODUCT);
    setEditingProductId(null);
    setProdErrors({});
    setCatForm({ emoji: cat.emoji, label: cat.label });
    setEditingCatId(cat.id);
    setActiveForm('category');
  }

  // ── Open: new product ─────────────────────────────────────────────────────
  function openProductForm() {
    if (data.categories.length === 0) return;
    // Auto-save an open category form with content
    if (activeForm === 'category' && catForm.label.trim()) {
      submitCategory(catForm);
    }
    setCatForm(EMPTY_CAT_FORM);
    setEditingCatId(null);
    setProductForm(EMPTY_PRODUCT);
    setEditingProductId(null);
    setProdErrors({});
    setActiveForm('product');
  }

  // ── Open: edit existing product ───────────────────────────────────────────
  function openEditProduct(product) {
    setCatForm(EMPTY_CAT_FORM);
    setEditingCatId(null);
    // Reconstruct unit vs unitCustom
    const unitIsStandard = STANDARD_UNITS.includes(product.unit);
    setProductForm({
      name:        product.name        ?? '',
      category:    product.category    ?? '',
      price:       product.price       ?? '',
      mrp:         product.mrp         ?? '',
      unit:        unitIsStandard ? product.unit : 'Other…',
      unitCustom:  unitIsStandard ? '' : (product.unit ?? ''),
      description: product.description ?? '',
      image:       product.image       ?? '',
    });
    setEditingProductId(product.tempId);
    setProdErrors({});
    setActiveForm('product');
  }

  // ── Submit / update category ──────────────────────────────────────────────
  function submitCategory(formState = catForm) {
    if (!formState.label.trim()) return;

    if (editingCatId !== null) {
      // Update label / emoji; keep the same id so product references stay valid
      onChange({
        categories: data.categories.map(c =>
          c.id === editingCatId
            ? { ...c, label: formState.label.trim(), emoji: formState.emoji }
            : c
        ),
      });
    } else {
      const id = formState.label.toLowerCase()
        .replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') || `cat${Date.now()}`;
      onChange({
        categories: [...data.categories, { id, label: formState.label.trim(), emoji: formState.emoji }],
      });
    }
    setCatForm(EMPTY_CAT_FORM);
    setEditingCatId(null);
    setActiveForm(null);
  }

  // ── Remove category ───────────────────────────────────────────────────────
  function removeCategory(id) {
    onChange({
      categories: data.categories.filter(c => c.id !== id),
      products:   data.products.map(p => p.category === id ? { ...p, category: '' } : p),
    });
    if (editingCatId === id) resetForms();
  }

  // ── Validate product form ─────────────────────────────────────────────────
  function validateProduct() {
    const errs = {};
    if (!productForm.name.trim())                              errs.name     = 'Product name is required.';
    if (!productForm.category)                                 errs.category = 'Please select a category.';
    if (!productForm.price || Number(productForm.price) <= 0) errs.price    = 'Enter a valid price.';
    return errs;
  }

  // ── Submit / update product ───────────────────────────────────────────────
  function submitProduct() {
    const errs = validateProduct();
    if (Object.keys(errs).length) { setProdErrors(errs); return; }
    // Enforce plan product limit (only block new adds, not edits)
    if (editingProductId === null && !canAddProduct(plan, data.products.length)) {
      setProdErrors({ name: `Free plan limit: ${limits.products} products max. Upgrade to add more.` });
      return;
    }

    const finalUnit = productForm.unit === 'Other…'
      ? (productForm.unitCustom.trim() || 'per piece')
      : productForm.unit;

    if (editingProductId !== null) {
      onChange({
        products: data.products.map(p =>
          p.tempId === editingProductId
            ? { ...p, ...productForm, unit: finalUnit }
            : p
        ),
      });
      setEditingProductId(null);
    } else {
      onChange({
        products: [...data.products, { ...productForm, unit: finalUnit, tempId: Date.now() }],
      });
    }
    setProductForm(EMPTY_PRODUCT);
    setProdErrors({});
    setActiveForm(null);
  }

  // ── Remove product ────────────────────────────────────────────────────────
  function removeProduct(tempId) {
    onChange({ products: data.products.filter(p => p.tempId !== tempId) });
    if (editingProductId === tempId) resetForms();
  }

  // ── Step navigation ───────────────────────────────────────────────────────
  function handleNext() {
    if (data.categories.length === 0) { alert('Add at least one category before continuing.'); return; }
    if (data.products.length === 0)   { alert('Add at least one product before continuing.');  return; }
    onNext();
  }

  const hasCategories = data.categories.length > 0;
  const isEditingCat  = editingCatId     !== null;
  const isEditingProd = editingProductId !== null;

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Your products</h2>
        <p className="text-sm text-gray-500 mt-1">
          First add categories, then add products under each category.
        </p>
      </div>

      {/* ── CATEGORIES ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">
            Categories
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              ({data.categories.length}/{limits.categories === Infinity ? '∞' : limits.categories})
            </span>
          </span>
          {activeForm !== 'category' && (
            canAddCategory(plan, data.categories.length) ? (
              <button type="button" onClick={openCategoryForm}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg
                                 border border-dashed border-gray-300 text-gray-500
                                 hover:border-gray-400 hover:text-gray-700 transition-colors">
                <Plus size={12} /> Add Category
              </button>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600
                               bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg">
                <Lock size={10} /> Limit reached
              </span>
            )
          )}
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {data.categories.map(cat => (
            <div key={cat.id}
                 className={[
                   'group inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5',
                   'text-sm font-medium text-gray-700 transition-colors',
                   editingCatId === cat.id
                     ? 'bg-brand/10 border border-brand/30 text-brand-dark'
                     : 'bg-gray-100 hover:bg-gray-150',
                 ].join(' ')}>
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
              {/* Edit button */}
              <button type="button" onClick={() => openEditCategory(cat)}
                      title="Edit category"
                      className="ml-0.5 text-gray-300 hover:text-brand transition-colors">
                <Pencil size={11} />
              </button>
              {/* Remove button */}
              <button type="button" onClick={() => removeCategory(cat.id)}
                      title="Remove category"
                      className="text-gray-300 hover:text-red-500 transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
          {data.categories.length === 0 && activeForm !== 'category' && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50
                            border border-amber-100 rounded-xl px-3 py-1.5">
              <AlertCircle size={12} className="flex-shrink-0" />
              Add at least one category before adding products.
            </div>
          )}
        </div>

        {/* Inline category form (add or edit) */}
        {activeForm === 'category' && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {isEditingCat ? 'Edit Category' : 'New Category'}
            </p>

            {/* Emoji picker */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Pick an icon</p>
              <div className="flex flex-wrap gap-1.5">
                {CAT_EMOJIS.map(e => (
                  <button key={e} type="button"
                          onClick={() => setCatForm(p => ({ ...p, emoji: e }))}
                          className={[
                            'w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all',
                            catForm.emoji === e ? 'bg-gray-900' : 'bg-white border border-gray-200 hover:bg-gray-100',
                          ].join(' ')}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Category name  (e.g. Chargers, Bath Towels)"
                value={catForm.label}
                onChange={e => setCatForm(p => ({ ...p, label: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitCategory()}
                autoFocus
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white
                           focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <button type="button" onClick={() => submitCategory()}
                      className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm
                                 font-semibold hover:bg-gray-700 transition-colors">
                {isEditingCat ? 'Update' : 'Add'}
              </button>
              <button type="button" onClick={resetForms}
                      className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── PRODUCTS ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">
            {labels.plural}
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              ({data.products.length}/{limits.products})
            </span>
          </span>
          {activeForm !== 'product' && (
            !canAddProduct(plan, data.products.length) ? (
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-600
                                 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg">
                  <Lock size={10} /> {limits.products} product limit
                </span>
              </div>
            ) : (
              <button type="button" onClick={openProductForm} disabled={!hasCategories}
                      title={!hasCategories ? 'Add a category first' : ''}
                      className={[
                        'flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg',
                        'text-white transition-colors',
                        hasCategories ? 'hover:opacity-90' : 'opacity-40 cursor-not-allowed',
                      ].join(' ')}
                      style={{ backgroundColor: themeColor }}>
                <Plus size={12} /> {labels.add}
              </button>
            )
          )}
        </div>
        {/* Upgrade nudge when at product limit */}
        {!canAddProduct(plan, data.products.length) && (
          <div className="mb-3 bg-gradient-to-r from-teal-50 to-emerald-50
                          border border-teal-100 rounded-xl px-4 py-3 flex items-center
                          justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-teal-800">
                Free plan: {limits.products} products max
              </p>
              <p className="text-[11px] text-teal-600 mt-0.5">
                Upgrade to Starter for 10 products, or Growth for 50.
              </p>
            </div>
            <a href="/pricing" target="_blank"
               className="flex-shrink-0 text-xs font-bold text-white bg-teal-600
                          hover:bg-teal-700 px-3 py-1.5 rounded-lg transition-colors">
              Upgrade
            </a>
          </div>
        )}

        {/* Product list */}
        {data.products.length > 0 && (
          <div className="space-y-2 mb-3">
            {data.products.map(p => {
              const cat   = data.categories.find(c => c.id === p.category);
              const isEditing = editingProductId === p.tempId;
              return (
                <div key={p.tempId}
                     className={[
                       'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                       isEditing
                         ? 'bg-brand/5 border border-brand/25'
                         : 'bg-white border border-gray-100 hover:border-gray-200',
                     ].join(' ')}>
                  {/* Thumbnail */}
                  {p.image ? (
                    <img src={p.image} alt={p.name}
                         className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center
                                    justify-center flex-shrink-0 text-gray-300">
                      <ImagePlus size={16} />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">
                      {cat ? `${cat.emoji} ${cat.label}` : '—'}
                      {' · '}₹{p.price}{(mode === 'product' || mode === 'menuitem') ? ` · ${p.unit}` : ''}
                    </p>
                  </div>

                  {/* Edit button */}
                  <button type="button" onClick={() => openEditProduct(p)}
                          title="Edit product"
                          className={[
                            'p-1.5 rounded-lg transition-colors flex-shrink-0',
                            isEditing
                              ? 'text-brand bg-brand/10'
                              : 'text-gray-300 hover:text-brand hover:bg-brand/10',
                          ].join(' ')}>
                    <Pencil size={13} />
                  </button>

                  {/* Remove button */}
                  <button type="button" onClick={() => removeProduct(p.tempId)}
                          title="Remove product"
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500
                                     hover:bg-red-50 transition-colors flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {data.products.length === 0 && activeForm !== 'product' && hasCategories && (
          <p className="text-xs text-gray-400 text-center py-2">
            No {labels.plural.toLowerCase()} yet — click "{labels.add}" above.
          </p>
        )}

        {/* ── Inline product form (add or edit) ─────────────────────────── */}
        {activeForm === 'product' && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {isEditingProd ? `Edit ${labels.singular}` : `New ${labels.singular}`}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

              {/* Name */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Product Name <span className="text-red-500">*</span>
                </label>
                <input type="text"
                       placeholder="e.g. 65W GaN Charger, Premium Bath Towel"
                       value={productForm.name}
                       autoFocus
                       onChange={e => {
                         setProductForm(p => ({ ...p, name: e.target.value }));
                         setProdErrors(p => ({ ...p, name: '' }));
                       }}
                       className={inputCls(prodErrors.name)} />
                {prodErrors.name && <p className="mt-0.5 text-xs text-red-500">{prodErrors.name}</p>}
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select value={productForm.category}
                        onChange={e => {
                          setProductForm(p => ({ ...p, category: e.target.value }));
                          setProdErrors(p => ({ ...p, category: '' }));
                        }}
                        className={inputCls(prodErrors.category)}>
                  <option value="">Select category…</option>
                  {data.categories.map(c => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                  ))}
                </select>
                {prodErrors.category && <p className="mt-0.5 text-xs text-red-500">{prodErrors.category}</p>}
              </div>

              {/* Unit — only relevant for physical products and menu items */}
              {(mode === 'product' || mode === 'menuitem') && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                  <select value={productForm.unit}
                          onChange={e => setProductForm(p => ({ ...p, unit: e.target.value, unitCustom: '' }))}
                          className={inputCls(false)}>
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {productForm.unit === 'Other…' && (
                    <input type="text" autoFocus
                           placeholder="Type your unit (e.g. per roll, per bundle)"
                           value={productForm.unitCustom}
                           onChange={e => setProductForm(p => ({ ...p, unitCustom: e.target.value }))}
                           className={[inputCls(false), 'mt-2'].join(' ')} />
                  )}
                </div>
              )}

              {/* Price */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Price ₹ <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm
                                   text-gray-400 pointer-events-none">₹</span>
                  <input type="number" inputMode="numeric" min="0" placeholder="349"
                         value={productForm.price}
                         onChange={e => {
                           setProductForm(p => ({ ...p, price: e.target.value }));
                           setProdErrors(p => ({ ...p, price: '' }));
                         }}
                         className={[inputCls(prodErrors.price), 'pl-7'].join(' ')} />
                </div>
                {prodErrors.price && <p className="mt-0.5 text-xs text-red-500">{prodErrors.price}</p>}
              </div>

              {/* MRP — not relevant for services or portfolio */}
              {(mode === 'product' || mode === 'menuitem' || mode === 'room') && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {mode === 'room' ? 'Original Price ₹' : 'MRP ₹'}{' '}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm
                                     text-gray-400 pointer-events-none">₹</span>
                    <input type="number" inputMode="numeric" min="0" placeholder="499"
                           value={productForm.mrp}
                           onChange={e => setProductForm(p => ({ ...p, mrp: e.target.value }))}
                           className={[inputCls(false), 'pl-7'].join(' ')} />
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">Shows strikethrough on the card.</p>
                </div>
              )}

              {/* Description */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text"
                       placeholder="Short description shown on the product card"
                       value={productForm.description}
                       onChange={e => setProductForm(p => ({ ...p, description: e.target.value }))}
                       className={inputCls(false)} />
              </div>

              {/* Image */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  {labels.singular} Image <span className="text-gray-400 font-normal">(optional — placeholder used if skipped)</span>
                </label>
                <ImageUploader
                  value={productForm.image}
                  onChange={(v) => setProductForm(p => ({ ...p, image: v }))}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={submitProduct}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white
                                 transition-colors hover:opacity-90"
                      style={{ backgroundColor: themeColor }}>
                {isEditingProd ? `Update ${labels.singular}` : labels.add}
              </button>
              <button type="button" onClick={resetForms}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm
                                 text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold
                           text-gray-600 hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        <button type="button" onClick={handleNext}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white
                           transition-all active:scale-[0.98] hover:opacity-90"
                style={{ backgroundColor: themeColor }}>
          Preview Store →
        </button>
      </div>
    </div>
  );
}
