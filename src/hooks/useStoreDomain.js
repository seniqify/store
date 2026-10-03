import { useCallback, useEffect, useState } from 'react';
import { manageDomain, domainStep, liveDomain } from '../utils/domainsApi';

/**
 * The store's own-domain state for Manage: one PIN-checked `status` call once
 * the PIN is verified, re-run (reload) after every change the card makes.
 *   res     the last status answer (null while loading)
 *   step    domainStep(res), or 'loading'
 *   domain  the live hostname links should use, or null (feature off, not
 *           connected, or connected but not served yet) -- then every link
 *           stays exactly as it was
 */
export function useStoreDomain({ slug, pin, enabled }) {
  const [res, setRes] = useState(null);

  useEffect(() => {
    if (!enabled || !slug || !pin) return undefined;
    let alive = true;
    manageDomain(slug, pin, 'status').then((r) => { if (alive) setRes(r); });
    return () => { alive = false; };
  }, [slug, pin, enabled]);

  const reload = useCallback(async () => {
    if (!enabled || !slug || !pin) return null;
    const r = await manageDomain(slug, pin, 'status');
    setRes(r);
    return r;
  }, [slug, pin, enabled]);

  return { res, step: res ? domainStep(res) : 'loading', domain: liveDomain(res), reload };
}
