import { useState, useEffect } from 'react';
import { CheckCircle2, Eye, EyeOff, Truck, Package, Wallet, Check, Star } from 'lucide-react';
import FormField from './FormField';
import { validateCustomerDetails } from '../../utils/validators';
import {
  generateWhatsAppMessage,
  openOrderOnWhatsApp,
} from '../../utils/generateWhatsAppMessage';
import { calcCartTotals, formatINR } from '../../utils/currency';
import { pixelTrack } from '../../utils/metaPixel';
import { saveOrder, saveAbandonedCheckout, buildOrderRow } from '../../utils/orderService';
import { sendOrderNotifications } from '../../utils/otpService';
import { couponDiscountFor, isCouponLive } from '../../utils/offers';
import { fetchReviews, reviewStats } from '../../utils/reviewService';
import { isVerified, effectivePlan } from '../../utils/planLimits';
import { payOnline } from '../../utils/onlinePayment';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { buildUpiLink, hasUpi } from '../../utils/upiLink';

/**
 * CustomerDetailsForm
 * ─────────────────────────────────────────────────────────────────────────────
 * B2B order form — controlled component.  Parent holds formData state.
 *
 * Fields:
 *   partyName      string   required — customer / firm name
 *   mobile         string   required — 10-digit Indian mobile (digits only)
 *   addressLine    string   delivery — house / flat / street / area
 *   destination    string   required — city / town (pickup: overridden)
 *   pincode        string   delivery — 6-digit PIN
 *   paymentMethod  string   required — cod | upi | qr | bank
 *   notes          string   optional — packing / special instructions
 *
 * On send, delivery orders compose addressLine + city + pincode into a single
 * `destination` string (the field the DB, WhatsApp message and delivery slip
 * all read) so a full doorstep address flows through with no schema change.
 *
 * Props:
 *   formData   { partyName, mobile, addressLine, destination, pincode, paymentMethod, notes }
 *   onChange   (newFormData) => void  — parent state setter
 *   cart       CartItem[]            — needed for message generation + totals
 */

export const INITIAL_CUSTOMER_DETAILS = {
  partyName:     '',
  mobile:        '',
  addressLine:   '',
  destination:   '',
  pincode:       '',
  paymentMethod: '',
  notes:         '',
  fulfillment:   'delivery',   // 'delivery' | 'pickup' (offered per store settings)
};

// Combine the structured delivery fields into one readable address line —
// this is what gets stored, messaged and printed. "12 MG Road, Andheri, Mumbai - 400058"
function composeDeliveryAddress({ addressLine, destination, pincode }) {
  const cityPin = [destination?.trim(), pincode?.trim()].filter(Boolean).join(' - ');
  return [addressLine?.trim(), cityPin].filter(Boolean).join(', ');
}

const PAYMENT_OPTIONS = [
  { value: 'cod',  label: '💵 Cash on Delivery (COD)' },
];

// Returning-customer memory. A shopper's name / phone / address is the same
// across every PocketLink store, so we remember it on THEIR device (never on our
// servers) and pre-fill next time — a repeat buyer orders in a couple of taps.
const PROFILE_KEY = 'pl_customer_v1';
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; }
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked — fine */ }
}
// Enough saved detail to skip straight to the "welcome back" summary? A saved
// delivery address must be complete; a name + phone alone is enough for pickup.
function profileIsComplete(p) {
  if (!p || !p.partyName || !p.mobile) return false;
  if (p.addressLine || p.pincode || p.destination) return Boolean(p.addressLine && p.pincode && p.destination);
  return true;
}

// ── Official WhatsApp icon (SVG, fill="currentColor") ─────────────────────────
function WhatsAppIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function CustomerDetailsForm({ formData, onChange, cart, onOrderPlaced }) {
  const [errors,      setErrors]      = useState({});
  const [submitted,   setSubmitted]   = useState(false);
  const [placing,     setPlacing]     = useState(false);   // submit in flight
  const [payError,    setPayError]    = useState('');      // online-payment error, if any
  const [autoNotified, setAutoNotified] = useState(false); // PocketLink WhatsApp'd both sides
  const [showPreview, setShowPreview] = useState(false);

  // Returning customer: remembered details on this device. `editing` = show the
  // raw fields; otherwise we show a "welcome back" summary they can order from.
  const [savedProfile] = useState(loadProfile);
  const [editing, setEditing] = useState(() => !profileIsComplete(loadProfile()));

  // Coupon entered at checkout (validated against the store's live coupons).
  const [couponInput,   setCouponInput]   = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError,   setCouponError]   = useState('');

  const config = useBusinessConfig();

  // Fulfilment: store settings decide what's offered; pickup skips the
  // delivery charge. Default (no settings) = delivery-only, as before.
  const dlv      = config.delivery || {};
  const dlvMode  = dlv.mode || 'delivery';
  const isPickup = dlvMode === 'pickup' || (dlvMode === 'both' && formData.fulfillment === 'pickup');
  // The customer always pays the store's flat delivery charge. Delhivery is an
  // internal fulfilment tool (booked from the Orders tab) — its courier cost is
  // the merchant's margin concern and is never shown to or charged to the customer.
  const effConfig = isPickup ? { ...config, cart: { ...config.cart, shippingCharge: 0 } } : config;
  // What actually gets sent/stored/printed: pickup needs no address; delivery
  // composes the structured fields into one full `destination` address line.
  // The raw fields (addressLine, pincode) are kept in the spread so the
  // validator can flag them individually.
  const sendData = isPickup
    ? { ...formData, destination: '🏪 Pickup' }
    : { ...formData, destination: composeDeliveryAddress(formData) };

  const { subtotal, tax, shipping, packaging, codFee, total } = calcCartTotals(cart, effConfig.cart, formData.paymentMethod);

  // Abandoned-checkout capture: the moment the customer types their full phone
  // number they become recoverable. Recorded once per store+phone+day; if they
  // finish the order, the Abandoned tab hides this entry automatically.
  useEffect(() => {
    const ph = String(formData.mobile || '').replace(/\D/g, '');
    if (ph.length !== 10 || cart.length === 0 || submitted || !config?.slug) return;
    const key = `pl_ab_${config.slug}_${ph}_${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch { /* storage blocked — capture anyway, DB side stays best-effort */ }
    saveAbandonedCheckout(formData, cart, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.mobile]);

  // One-time prefill from the remembered profile — only fills fields the parent
  // hasn't already restored, so a draft is never clobbered.
  useEffect(() => {
    if (!savedProfile) return;
    const merged = { ...formData };
    let changed = false;
    for (const k of ['partyName', 'mobile', 'addressLine', 'destination', 'pincode', 'paymentMethod']) {
      if (!merged[k] && savedProfile[k]) { merged[k] = savedProfile[k]; changed = true; }
    }
    if (changed) onChange(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const taxPct     = Math.round((config.cart?.taxRate ?? 0) * 100);
  const itemCount  = cart.reduce((s, i) => s + i.qty, 0);
  const cartEmpty  = cart.length === 0;

  // Seller-identity trust signals — the same name, Verified badge & star rating
  // the customer saw on the storefront, echoed at checkout so it feels like the
  // same trusted shop (continuity = less "is this a scam?" hesitation).
  const primary  = config.theme?.primary || '#0d9488';
  const verified = isVerified(effectivePlan(config));

  // Online payment (Razorpay) is offered only when the store has connected it.
  // When available it's the first, most-prominent option.
  const onlineAvailable = Boolean(config.payments?.razorpay);
  const paymentOptions  = [
    ...(onlineAvailable ? [{ value: 'online', label: '💳 Pay Online now — UPI / Card', pickLabel: '💳 Pay Online' }] : []),
    ...PAYMENT_OPTIONS.map((o) => ({ ...o, pickLabel: '💵 Cash on Delivery' })),
  ];
  const [rating, setRating] = useState(null);
  useEffect(() => {
    if (!config?.slug) return;
    let alive = true;
    fetchReviews(config.slug).then((r) => { if (alive) setRating(reviewStats(r)); }).catch(() => {});
    return () => { alive = false; };
  }, [config?.slug]);

  const coupons        = config.coupons || [];
  const couponDiscount = appliedCoupon ? couponDiscountFor(appliedCoupon, subtotal) : 0;
  const finalTotal     = Math.max(0, total - couponDiscount);

  // For the "welcome back" summary
  const firstName = (formData.partyName || '').trim().split(/\s+/)[0] || '';
  const savedAddr = composeDeliveryAddress(formData);

  // UPI pay link + a "Scan to pay" QR of the same payload. A scanned QR is a
  // trusted flow that works to personal VPAs, unlike a browser→app upi:// intent
  // with a pre-filled amount (which GPay/NPCI block) — so the QR is the reliable
  // way to pay, and works on desktop too (scan with the phone).
  const upiPayLink = hasUpi(config) && finalTotal > 0
    ? buildUpiLink({
        upi:       config.upi,
        payeeName: config.businessName || config.name,
        amount:    finalTotal,
        note:      `Order ${config.businessName || config.name || ''}`.trim(),
      })
    : null;
  const upiQrSrc = upiPayLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=8&color=1e3a8a&data=${encodeURIComponent(upiPayLink)}`
    : null;

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const c = coupons.find((x) => String(x.code || '').toUpperCase() === code);
    if (!c || !isCouponLive(c)) { setAppliedCoupon(null); setCouponError('Invalid or expired code.'); return; }
    if (c.minOrder && subtotal < Number(c.minOrder)) {
      setAppliedCoupon(null);
      setCouponError(`Add ${formatINR(Number(c.minOrder) - subtotal)} more to use this code (min ${formatINR(c.minOrder)}).`);
      return;
    }
    setAppliedCoupon(c); setCouponError('');
  }
  function removeCoupon() { setAppliedCoupon(null); setCouponInput(''); setCouponError(''); }

  // Preview is only meaningful once the required fields + cart are ready
  const canPreview =
    !cartEmpty &&
    formData.partyName.trim() &&
    formData.mobile.trim() &&
    (isPickup || (formData.addressLine.trim() && formData.destination.trim() && formData.pincode.trim()));

  // ── Field change handler ──────────────────────────────────────────────────
  function handleChange(field, value) {
    onChange({ ...formData, [field]: value });
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (placing) return;
    const { isValid, errors: newErrors } = validateCustomerDetails(sendData, { requireDeliveryAddress: !isPickup });
    if (!isValid) {
      setEditing(true);   // a "welcome back" summary can't show an error — reveal the fields
      setErrors(newErrors);
      document.getElementById(`cdf-${Object.keys(newErrors)[0]}`)?.focus();
      return;
    }
    if (cartEmpty) return;

    setPlacing(true);
    setPayError('');

    // ── Record the order FIRST ────────────────────────────────────────────────
    // The DB row is the source of truth. Persist it before the (awaited) WhatsApp
    // notification below, so a slow edge function, a flaky mobile network, or the
    // customer closing the tab can NEVER lose a placed order. Awaited so the row is
    // written before we show "Order placed". (Best-effort — saveOrder never throws.)
    //
    // We mint the row id HERE and reuse it for (a) the client insert, (b) marking an
    // online payment paid, and (c) the server-side safety net below. If the client's
    // direct insert is ever blocked (ad-blocker / privacy browser / stale cache /
    // flaky network), the order-notify edge function re-saves this exact row with the
    // service role — so an order can't be lost as long as the notification is sent.
    const orderId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : undefined;
    const orderRow = buildOrderRow(sendData, cart, effConfig, appliedCoupon, orderId);
    await saveOrder(sendData, cart, effConfig, appliedCoupon, orderId);
    const orderRowId = orderId;

    // ── Online payment ────────────────────────────────────────────────────────
    // Collect payment before confirming. The order is already saved (unpaid), so a
    // cancelled payment just leaves it as a normal pending order the owner can chase.
    if (formData.paymentMethod === 'online') {
      try {
        const result = await payOnline({
          slug:       config.slug,
          amount:     finalTotal,
          orderRowId,
          customer:   { name: sendData.partyName, phone: sendData.mobile },
          storeName:  config.businessName,
          themeColor: primary,
        });
        if (!result?.paid) {
          setPlacing(false);
          setPayError('Payment wasn’t completed. Your order is saved — tap Pay again, or pick another method.');
          return;
        }
        // Paid. payments-verify already flips the client-inserted row to paid, but
        // if that row was blocked on the customer's device the safety-net save below
        // is the only copy — so stamp paid here too, or a real payment could land
        // showing "unpaid". (upsert ignoreDuplicates keeps the verified row intact.)
        orderRow.paid = true;
        if (result.paymentId) {
          orderRow.payment_ref = result.paymentId;
          orderRow.payment_provider = 'razorpay';
        }
      } catch (e) {
        setPlacing(false);
        setPayError(e?.message || 'Couldn’t start the payment. Try again, or choose another method.');
        return;
      }
    }

    // ── Then notify both sides (best-effort) ──────────────────────────────────
    // PocketLink sends WhatsApp alerts to BOTH sides (seller gets a new-order
    // alert, customer a thank-you) — no manual send, no drop-off. If the order
    // templates aren't live / the send fails, fall back to the classic wa.me
    // hand-off so the order still reaches the seller. The order is already saved,
    // so this hand-off only opens WhatsApp — it never re-saves or risks the order.
    let notified = false;
    try {
      notified = await sendOrderNotifications({
        sellerPhone:   config.whatsappNumber,
        customerPhone: sendData.mobile,
        customerName:  sendData.partyName,
        storeName:     config.businessName,
        itemsSummary:  cart.map((i) => `${i.qty}× ${i.name}`).join(', '),
        orderTotal:    formatINR(finalTotal),
        slug:          config.slug,   // → "View order" button in the seller alert
        order:         orderRow,      // server-side safety net: re-save if the client insert was blocked
      });
    } catch { /* fall back below */ }

    if (!notified) {
      openOrderOnWhatsApp(sendData, cart, effConfig, appliedCoupon); // order already saved
    }
    setAutoNotified(notified);
    setPlacing(false);
    setSubmitted(true);
    // Remember this customer on their device so the next order is one tap.
    saveProfile({
      partyName:     formData.partyName,
      mobile:        formData.mobile,
      addressLine:   formData.addressLine,
      destination:   formData.destination,
      pincode:       formData.pincode,
      paymentMethod: formData.paymentMethod,
    });
    // Report the sale to the store's Meta Pixel — checkout finishes in WhatsApp,
    // so order-placed is the conversion. No-op without a pixel.
    pixelTrack('Purchase', { value: finalTotal, currency: 'INR', num_items: itemCount });
    onOrderPlaced?.();   // empty the cart now that the order is placed
  }

  // ── Shared input class ─────────────────────────────────────────────────────
  function inputCls(field) {
    return [
      'w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900',
      'placeholder-gray-400 transition focus:outline-none focus:ring-2',
      errors[field]
        ? 'border-red-400 focus:ring-red-300 bg-red-50'
        : 'border-gray-200 focus:ring-brand focus:border-transparent bg-white',
    ].join(' ');
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div
        id="order-form"
        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center"
      >
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">
          {autoNotified ? 'Order placed! 🎉' : 'Order sent to WhatsApp!'}
        </h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto mb-6">
          {autoNotified ? (
            <>
              We've notified{' '}
              <strong className="text-gray-700">{config.businessName}</strong>{' '}
              on WhatsApp — they'll confirm shortly. You'll get a confirmation message too.
            </>
          ) : (
            <>
              Complete your order on WhatsApp with{' '}
              <strong className="text-gray-700">{config.businessName}</strong>.
              We'll confirm and dispatch soon.
            </>
          )}
        </p>
        <button
          onClick={() => { setSubmitted(false); setAutoNotified(false); }}
          className="text-sm font-semibold text-brand hover:text-brand-dark
                     underline underline-offset-2 transition-colors"
        >
          Place another order
        </button>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div id="order-form" className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-brand/5 to-transparent rounded-t-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Seller identity — mirrors the storefront hero so checkout reads as
                the same real, verified shop the customer was just browsing. */}
            <div className="flex items-center gap-2 flex-wrap">
              {(config.logo || config.logoEmoji) && (
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0
                                 overflow-hidden bg-gray-50 border border-gray-100"
                      style={config.logo ? undefined : { background: `${primary}14` }}>
                  {config.logo
                    ? <img src={config.logo} alt="" className="w-full h-full object-cover" />
                    : config.logoEmoji}
                </span>
              )}
              <h2 className="text-base font-bold text-gray-900 truncate max-w-[12rem]">{config.businessName}</h2>
              {verified && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand bg-brand/10
                                 px-2 py-0.5 rounded-full flex-shrink-0">
                  <Check size={10} strokeWidth={3} /> Verified
                </span>
              )}
              {rating?.count > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-500/10
                                 px-2 py-0.5 rounded-full flex-shrink-0">
                  <Star size={10} fill="currentColor" /> {rating.avg} ({rating.count})
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Almost done — add your details &amp; we'll confirm your order on WhatsApp.
            </p>
          </div>

          {/* Preview toggle — only visible when all required fields are ready */}
          {canPreview && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold
                         text-brand hover:text-brand-dark border border-brand/30 hover:border-brand/60
                         bg-brand/5 hover:bg-brand/10 rounded-lg px-3 py-1.5 transition-colors mt-0.5"
            >
              {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPreview ? 'Hide' : 'Preview'} message
            </button>
          )}
        </div>
      </div>

      {/* ── Trust reassurance chips — same chip look as the storefront; directly
             answers the three hesitations: my data, my money, will I hear back. */}
      <div className="px-6 pt-4 flex flex-wrap gap-2">
        {[
          ['🔒', 'Your details are private'],
          ['🤝', 'You pay the shop directly'],
          ['💬', 'Confirmed on WhatsApp'],
        ].map(([emoji, text]) => (
          <span key={text}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600
                       bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
            <span className="text-xs leading-none">{emoji}</span> {text}
          </span>
        ))}
      </div>

      {/* ── Order summary — show WHAT they're buying, with photos, so the order
             feels real and matches the shop they were just browsing. */}
      {!cartEmpty && (
        <div className="px-6 pt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
            Your order · {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </p>
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 divide-y divide-gray-100">
            {cart.map((it) => {
              const img = it.image || (Array.isArray(it.images) ? it.images[0] : null);
              return (
                <div key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-gray-200
                                  flex-shrink-0 flex items-center justify-center">
                    {img
                      ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />
                      : <span className="text-base">🛍️</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">{it.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {it.qty} × {formatINR(it.price)}
                      {it.variant ? ` · ${it.variant}` : ''}{it.size ? ` · ${it.size}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0">
                    {formatINR((Number(it.price) || 0) * it.qty)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Message preview panel ─────────────────────────────────────── */}
      {showPreview && canPreview && (
        <div className="border-b border-gray-100 bg-gray-50">
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Message preview
            </p>
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono
                            bg-white border border-gray-200 rounded-xl px-4 py-3 overflow-x-auto">
              {generateWhatsAppMessage(sendData, cart, effConfig, appliedCoupon)}
            </pre>
          </div>
        </div>
      )}

      {/* ── Form fields ──────────────────────────────────────────────────── */}
      <div className="px-6 py-5 space-y-4">

        {/* Returning customer — a saved profile lets them review & order in a
            couple of taps instead of retyping everything. */}
        {!editing && savedProfile ? (
          <div className="rounded-2xl border border-brand/40 bg-gradient-to-b from-brand/5 to-white px-4 py-3.5">
            <p className="text-sm font-bold text-gray-900 mb-2.5 flex items-center gap-1.5">
              <span>👋</span> Welcome back{firstName ? `, ${firstName}` : ''}
            </p>
            <div className="space-y-1.5 text-sm text-gray-700">
              <p className="flex items-start gap-2">
                <span className="text-brand flex-shrink-0">📞</span>
                <span className="tabular-nums">+91 {formData.mobile}</span>
              </p>
              {!isPickup && savedAddr && (
                <p className="flex items-start gap-2">
                  <span className="text-brand flex-shrink-0 mt-0.5">📍</span>
                  <span>{savedAddr}</span>
                </p>
              )}
              {isPickup && (
                <p className="flex items-start gap-2">
                  <span className="text-brand flex-shrink-0">🏪</span>
                  <span>Pickup from the shop</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={() => setEditing(true)}
                className="text-xs font-bold text-gray-700 border border-gray-200 bg-white
                           rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors">
                ✎ Edit details
              </button>
              {!isPickup && (
                <button type="button"
                  onClick={() => { onChange({ ...formData, addressLine: '', destination: '', pincode: '' }); setEditing(true); }}
                  className="text-xs font-bold text-gray-700 border border-gray-200 bg-white
                             rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors">
                  📍 Deliver somewhere else
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Row 1 — Your name + Mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <FormField label="Your Name" required error={errors.partyName}>
                <input
                  id="cdf-partyName"
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  autoComplete="name"
                  value={formData.partyName}
                  onChange={(e) => handleChange('partyName', e.target.value)}
                  className={inputCls('partyName')}
                />
              </FormField>

              <FormField
                label="Mobile Number"
                required
                error={errors.mobile}
                hint="10-digit number"
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400
                                   font-medium select-none pointer-events-none">
                    +91
                  </span>
                  <input
                    id="cdf-mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    maxLength={10}
                    value={formData.mobile}
                    onChange={(e) =>
                      handleChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                    className={[inputCls('mobile'), 'pl-12'].join(' ')}
                  />
                </div>
              </FormField>
            </div>

            {/* Fulfilment choice — only when the store offers both */}
            {dlvMode === 'both' && (
              <div className="flex gap-2">
                {[['delivery', '🛵 Home delivery'], ['pickup', '🏪 Pickup from shop']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => handleChange('fulfillment', v)}
                    className={[
                      'flex-1 py-2.5 rounded-xl border text-sm font-semibold transition',
                      (formData.fulfillment || 'delivery') === v
                        ? 'border-brand bg-brand/5 text-brand-dark'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300',
                    ].join(' ')}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {/* Delivery address — full address for a real delivery slip.
                Hidden entirely for pickup (nothing to ship). */}
            {isPickup ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
                <span>🏪</span>
                Pickup from the shop — timing will be confirmed on WhatsApp.
              </div>
            ) : (
              <>
                <FormField
                  label="Delivery Address"
                  required
                  error={errors.addressLine}
                  hint={dlv.areas ? `We deliver in: ${dlv.areas}` : 'House / flat no., building, street, area'}
                >
                  <textarea
                    id="cdf-addressLine"
                    rows={2}
                    autoComplete="street-address"
                    placeholder="House / flat no., building, street, area, landmark"
                    value={formData.addressLine}
                    onChange={(e) => handleChange('addressLine', e.target.value)}
                    className={[inputCls('addressLine'), 'resize-none'].join(' ')}
                  />
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="City / Town" required error={errors.destination}>
                    <input
                      id="cdf-destination"
                      type="text"
                      autoComplete="address-level2"
                      placeholder="e.g. Mumbai, Solapur"
                      value={formData.destination}
                      onChange={(e) => handleChange('destination', e.target.value)}
                      className={inputCls('destination')}
                    />
                  </FormField>

                  <FormField label="PIN Code" required error={errors.pincode}>
                    <input
                      id="cdf-pincode"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={6}
                      placeholder="e.g. 413001"
                      value={formData.pincode}
                      onChange={(e) => handleChange('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={inputCls('pincode')}
                    />
                  </FormField>
                </div>
              </>
            )}

            {/* First-timer reassurance — turns a long form into a one-time cost */}
            {!savedProfile && (
              <p className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-snug">
                <span className="flex-shrink-0 mt-px">🔒</span>
                We'll remember these on your phone — next time it's just one tap.
              </p>
            )}
          </>
        )}

        {/* Payment Method — tappable cards (bigger targets than a dropdown) */}
        <FormField
          label="Payment Method"
          required
          error={errors.paymentMethod}
        >
          <div className={paymentOptions.length > 1 ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-1'}>
            {paymentOptions.map((opt, i) => {
              const sel = formData.paymentMethod === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  id={i === 0 ? 'cdf-paymentMethod' : undefined}
                  onClick={() => handleChange('paymentMethod', opt.value)}
                  aria-pressed={sel}
                  className={[
                    'flex items-center justify-center gap-1.5 text-center text-sm font-semibold',
                    'rounded-xl border px-3 py-3 transition',
                    sel
                      ? 'border-brand bg-brand/5 text-brand-dark ring-1 ring-brand/30'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white',
                  ].join(' ')}
                >
                  {opt.pickLabel || opt.label}
                </button>
              );
            })}
          </div>
        </FormField>

        {/* ── Payment details hint ─────────────────────────────────────────
            UPI     → show the UPI ID + tap-to-pay shortcut
            QR Code → show the scan-to-pay QR
            Bank    → show bank details table
            (each falls back to "seller will share" when not configured)
        ─────────────────────────────────────────────────────────────────── */}
        {formData.paymentMethod === 'upi' && (
          hasUpi(config) ? (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5 flex-shrink-0">📱</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-blue-800 mb-0.5">Pay via UPI</p>
                  <p className="text-sm font-mono font-bold text-blue-700 break-all select-all">
                    {config.upi}
                  </p>
                  <p className="text-[11px] text-blue-400 mt-1">
                    This UPI ID will be included in your order message.
                  </p>
                </div>
              </div>

              {/* Tap-to-pay — opens the UPI app on the customer's phone */}
              {upiPayLink && (
                <a
                  href={upiPayLink}
                  className="mt-2.5 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700
                             text-white text-sm font-bold py-2.5 rounded-xl transition-colors active:scale-[0.98]"
                >
                  📲 On your phone? Tap to pay {formatINR(finalTotal)}
                </a>
              )}
              <p className="text-[10px] text-blue-400 text-center mt-1.5">
                After paying, send the screenshot on WhatsApp so we can confirm.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400
                            bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span>📱</span>
              The seller will share their UPI ID when confirming your order.
            </div>
          )
        )}

        {formData.paymentMethod === 'qr' && (
          upiQrSrc ? (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <div className="flex flex-col items-center bg-white rounded-xl border border-blue-100 py-3">
                <img src={upiQrSrc} alt={`Scan to pay ${formatINR(finalTotal)}`}
                     width={170} height={170} loading="lazy"
                     className="w-[170px] h-[170px]" />
                <p className="text-sm font-bold text-blue-800 mt-2">Scan to pay {formatINR(finalTotal)}</p>
                <p className="text-[11px] text-blue-400">with any UPI app — GPay · PhonePe · Paytm · BHIM</p>
              </div>
              <p className="text-[10px] text-blue-400 text-center mt-2">
                After paying, send the screenshot on WhatsApp so we can confirm.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400
                            bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span>🔳</span>
              The seller will share a payment QR when confirming your order.
            </div>
          )
        )}

        {formData.paymentMethod === 'bank' && (
          config.bank?.accountNumber ? (
            <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-base leading-none">🏦</span>
                <p className="text-xs font-semibold text-violet-800 flex-1">
                  Bank Transfer Details
                </p>
                <span className="text-[10px] text-violet-400">
                  Included in your order message
                </span>
              </div>
              <div className="space-y-1.5">
                {config.bank.accountName && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">Account Name</span>
                    <span className="font-semibold text-violet-900 text-right">
                      {config.bank.accountName}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-violet-500 flex-shrink-0">Account No.</span>
                  <span className="font-mono font-bold text-violet-900 tracking-widest select-all">
                    {config.bank.accountNumber}
                  </span>
                </div>
                {config.bank.ifsc && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">IFSC</span>
                    <span className="font-mono font-bold text-violet-900 select-all">
                      {config.bank.ifsc}
                    </span>
                  </div>
                )}
                {config.bank.bankName && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">Bank</span>
                    <span className="font-semibold text-violet-900">{config.bank.bankName}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400
                            bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span>🏦</span>
              The seller will share bank account details when confirming your order.
            </div>
          )
        )}

        {/* Notes */}
        <FormField label="Notes" hint="Packing instructions, special requests, etc.">
          <textarea
            id="cdf-notes"
            rows={3}
            placeholder="Any special instructions or additional notes…"
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            className={[
              'w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900',
              'placeholder-gray-400 transition focus:outline-none focus:ring-2 resize-none',
              'border-gray-200 focus:ring-brand focus:border-transparent bg-white',
            ].join(' ')}
          />
        </FormField>
      </div>

      {/* ── Footer — cost breakdown + CTA ────────────────────────────────── */}
      <div className="border-t border-gray-100 px-6 py-5 bg-gray-50/60">
        {cartEmpty ? (
          /* No items nudge */
          <div className="flex items-center gap-3 py-1 text-sm text-gray-400">
            <span className="text-xl leading-none">🛒</span>
            <span>Add products to your cart above, then place your order here.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">

            {/* Cost breakdown */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>
                  Subtotal
                  <span className="text-gray-400 font-normal ml-1">
                    ({itemCount} {itemCount === 1 ? 'item' : 'items'})
                  </span>
                </span>
                <span className="font-medium text-gray-700 tabular-nums">
                  {formatINR(subtotal)}
                </span>
              </div>

              {taxPct > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>GST ({taxPct}%)</span>
                  <span className="font-medium text-gray-700 tabular-nums">
                    {formatINR(tax)}
                  </span>
                </div>
              )}

              {packaging > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span className="flex items-center gap-1"><Package size={12} /> Packaging</span>
                  <span className="font-medium text-gray-700 tabular-nums">{formatINR(packaging)}</span>
                </div>
              )}

              {!isPickup && (
                <div className="flex justify-between text-gray-500">
                  <span className="flex items-center gap-1"><Truck size={12} /> Delivery</span>
                  <span className={[
                    'font-medium tabular-nums',
                    shipping === 0 ? 'text-green-600 font-semibold' : 'text-gray-700',
                  ].join(' ')}>
                    {shipping === 0 ? 'FREE' : formatINR(shipping)}
                  </span>
                </div>
              )}

              {codFee > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span className="flex items-center gap-1"><Wallet size={12} /> COD fee</span>
                  <span className="font-medium text-gray-700 tabular-nums">{formatINR(codFee)}</span>
                </div>
              )}

              {couponDiscount > 0 && (
                <div className="flex justify-between text-green-700">
                  <span className="flex items-center gap-1">🎟️ Coupon {appliedCoupon.code}</span>
                  <span className="font-semibold tabular-nums">− {formatINR(couponDiscount)}</span>
                </div>
              )}

              <div className="flex justify-between pt-1.5 border-t border-dashed border-gray-200">
                <span className="font-bold text-gray-900">Total</span>
                <span className="font-extrabold text-brand-dark text-base tabular-nums">
                  {formatINR(finalTotal)}
                </span>
              </div>
            </div>

            {/* ── Coupon code ────────────────────────────────────────────── */}
            {coupons.length > 0 && (
              appliedCoupon ? (
                <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-green-700 min-w-0">
                    <span className="flex-shrink-0">🎟️</span>
                    <span className="font-mono truncate">{appliedCoupon.code}</span>
                    <span className="text-green-600 font-normal">applied</span>
                  </span>
                  <button type="button" onClick={removeCoupon}
                    className="text-xs font-semibold text-gray-400 hover:text-red-500 flex-shrink-0">
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Have a coupon code?"
                      value={couponInput}
                      onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyCoupon())}
                      className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono tracking-wide
                                 uppercase text-gray-900 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal
                                 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                      maxLength={20}
                    />
                    <button type="button" onClick={applyCoupon} disabled={!couponInput.trim()}
                      className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-700 disabled:opacity-40 transition-colors">
                      Apply
                    </button>
                  </div>
                  {couponError && <p className="mt-1.5 text-xs text-red-500">{couponError}</p>}
                </div>
              )
            )}

            {/* Reassurance at the moment of commit — answers the last-second
                "is this safe?" doubt right where the customer decides. */}
            <p className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-snug">
              <span className="flex-shrink-0 mt-px">🔒</span>
              {formData.paymentMethod === 'online' ? (
                <span>
                  Secure payment via <span className="font-semibold text-gray-500">Razorpay</span> —
                  pay by UPI or card. Money goes straight to{' '}
                  <span className="font-semibold text-gray-500">{config.businessName}</span>; your order confirms instantly.
                </span>
              ) : (
                <span>
                  No card details taken here — your order goes straight to{' '}
                  <span className="font-semibold text-gray-500">{config.businessName}</span>{' '}
                  on WhatsApp. Pay by cash or UPI.
                </span>
              )}
            </p>

          </div>
        )}
      </div>

      {/* ── Sticky action bar — the total & the button stay in view the whole
             time, so the customer never scrolls to hunt for "how much / where do
             I tap". Pins to the checkout sheet's scroll viewport. */}
      {!cartEmpty && (
        <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur border-t border-gray-100
                        px-5 py-3 rounded-b-2xl shadow-[0_-10px_28px_-16px_rgba(0,0,0,0.28)]">
          {payError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-2.5">{payError}</p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={placing}
            className="w-full flex items-center justify-center gap-2.5
                       bg-brand hover:bg-brand-dark active:bg-brand-dark
                       text-white font-bold text-base
                       px-7 py-3.5 rounded-2xl
                       shadow-lg hover:shadow-xl
                       transition-all duration-200 active:scale-[0.98]
                       min-h-[52px] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {placing ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {formData.paymentMethod === 'online' ? 'Processing…' : 'Placing order…'}
              </>
            ) : formData.paymentMethod === 'online' ? (
              <>
                🔒 Pay
                <span className="bg-white/20 px-2.5 py-0.5 rounded-lg tabular-nums">{formatINR(finalTotal)}</span>
                securely
              </>
            ) : (
              <>
                Place order
                <span className="bg-white/20 px-2.5 py-0.5 rounded-lg tabular-nums">{formatINR(finalTotal)}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
