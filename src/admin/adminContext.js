// The signed-in admin person and path helpers, shared by every Admin screen.
import { createContext, useContext } from 'react';

export const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);
