import { useState, useMemo } from 'react';
import { calcCartTotals } from '../utils/currency';

/**
 * useCart — single source of truth for all cart state and operations.
 *
 * Usage:
 *   const {
 *     cart, itemCount, totals,
 *     addToCart, increaseQty, decreaseQty, setQty,
 *     removeItem, clearCart,
 *     isInCart, getQty,
 *   } = useCart();
 *
 * Design rules:
 *  • Cart is a flat array: CartItem[]
 *  • All mutations go through this hook — nothing writes to `cart` directly
 *  • `totals` is derived with useMemo — never stale
 *  • `addToCart(product, qty)` merges into an existing line if the product is
 *    already in cart instead of creating a duplicate
 */
export function useCart() {
  const [cart, setCart] = useState([]);

  // ── Derived values ─────────────────────────────────────────────────────
  const itemCount = useMemo(
    () => cart.reduce((sum, i) => sum + i.qty, 0),
    [cart]
  );

  const totals = useMemo(() => calcCartTotals(cart), [cart]);

  // ── Mutations ──────────────────────────────────────────────────────────

  /**
   * Add a product to the cart.
   * If the product already exists, increments its quantity by `quantity`.
   * @param {object} product  — any object with at least { id, price }
   * @param {number} quantity — how many to add (default 1)
   */
  function addToCart(product, quantity = 1) {
    if (quantity < 1) return;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.id === product.id);
      if (idx !== -1) {
        // Merge: bump existing line's qty
        return prev.map((i) =>
          i.id === product.id ? { ...i, qty: i.qty + quantity } : i
        );
      }
      // New line
      return [...prev, { ...product, qty: quantity }];
    });
  }

  /**
   * Set a cart item's quantity to an exact value.
   * Passing qty ≤ 0 removes the item.
   */
  function setQty(id, qty) {
    if (qty < 1) {
      removeItem(id);
      return;
    }
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty } : i))
    );
  }

  /** Increment a line item's quantity by 1. */
  function increaseQty(id) {
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i))
    );
  }

  /**
   * Decrement a line item's quantity by 1.
   * Automatically removes the item if qty reaches 0.
   */
  function decreaseQty(id) {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0)
    );
  }

  /** Remove a line item entirely, regardless of quantity. */
  function removeItem(id) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  /** Empty the entire cart. */
  function clearCart() {
    setCart([]);
  }

  // ── Read helpers ───────────────────────────────────────────────────────

  /** Returns true if the product is already in the cart. */
  function isInCart(id) {
    return cart.some((i) => i.id === id);
  }

  /**
   * Returns the current qty for a product, or 0 if not in cart.
   * Useful for ProductCard to show the "X in cart" badge.
   */
  function getQty(id) {
    return cart.find((i) => i.id === id)?.qty ?? 0;
  }

  return {
    // State
    cart,
    itemCount,
    totals,
    // Mutations
    addToCart,
    setQty,
    increaseQty,
    decreaseQty,
    removeItem,
    clearCart,
    // Read helpers
    isInCart,
    getQty,
  };
}
