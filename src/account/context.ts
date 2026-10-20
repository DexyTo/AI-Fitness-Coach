import { createContext, useContext } from 'react';
import type { User } from './api';
export const AccountContext = createContext<{ user: User | null; setUser: (user: User | null) => void; refresh: () => Promise<void> } | null>(null);
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('AccountProvider missing');
  return value;
}
