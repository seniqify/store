import { useEffect } from 'react';

/**
 * useScrollLock — freeze the page behind an overlay.
 *
 * While `active` is true, the page underneath a cart / checkout / product view
 * can't scroll (it used to scroll behind them, which felt broken). Uses
 * `position: fixed` on <body> — the only approach that reliably holds on iOS
 * Safari, where `overflow: hidden` alone still lets the page scroll — and
 * restores the exact scroll position on release. A shared counter keeps
 * overlapping overlays from unlocking each other.
 */
let lockCount = 0;
let saved = null;

export function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;

    if (lockCount === 0) {
      const body = document.body;
      const scrollY = window.scrollY;
      const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
      saved = {
        scrollY,
        position: body.style.position, top: body.style.top,
        left: body.style.left, right: body.style.right,
        width: body.style.width, overflow: body.style.overflow,
        paddingRight: body.style.paddingRight,
      };
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0 && saved) {
        const body = document.body;
        body.style.position = saved.position;
        body.style.top = saved.top;
        body.style.left = saved.left;
        body.style.right = saved.right;
        body.style.width = saved.width;
        body.style.overflow = saved.overflow;
        body.style.paddingRight = saved.paddingRight;
        window.scrollTo(0, saved.scrollY);
        saved = null;
      }
    };
  }, [active]);
}
