// The signed-in CRM person, the team and path helpers, shared by every screen.
import { createContext, useContext } from 'react';

export const CrmCtx = createContext(null);
export const useCrm = () => useContext(CrmCtx);

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const ROLE_LABEL = { manager: 'Manager', caller: 'Calling executive', field: 'Field executive', ads: 'Ads & leads executive' };
