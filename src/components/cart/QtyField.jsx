import { useState, useEffect } from 'react';

/**
 * Editable quantity field — lets customers TYPE a large quantity (e.g. 1000 pcs,
 * 10000 sqft) instead of only tapping +/-. Caps at 6 digits; empty/zero on blur
 * resets to 1. `onSetQty(n)` receives the new quantity (the id is bound by the
 * caller).
 */
export default function QtyField({ qty, onSetQty, className = '', ariaLabel = 'Quantity' }) {
  const [val, setVal] = useState(String(qty));

  // Keep in sync when qty changes elsewhere (e.g. the +/- buttons).
  useEffect(() => { setVal(String(qty)); }, [qty]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={val}
      aria-label={ariaLabel}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
        setVal(v);
        if (v !== '') onSetQty(parseInt(v, 10));
      }}
      onBlur={() => { if (val === '' || parseInt(val, 10) < 1) { onSetQty(1); setVal('1'); } }}
      className={className}
    />
  );
}
