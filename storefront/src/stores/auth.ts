// Customer session, shared by every island of a page (replaces the old AuthContext). The token and user are
// persistent atoms (stores/session.ts); this file adds the loading state, the actions and the useAuth() hook.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { $user, getStoredUser, getUserToken, setUserAuth } from './session';

const $loading = atom(true);
let bootstrap: Promise<void> | null = null;

/** Resolves once the stored session has been checked with the API (once per page load). */
export function authReady(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!bootstrap) {
    bootstrap = (async () => {
      if (!getStoredUser() && !getUserToken()) {
        $loading.set(false);
        return;
      }
      try {
        const { user: freshUser } = await api.getMe();
        setUserAuth(getUserToken(), freshUser);
      } catch {
        setUserAuth(null, null);
      } finally {
        $loading.set(false);
      }
    })();
  }
  return bootstrap;
}

async function login({ identifier, email, password }: { identifier?: string; email?: string; password: string }) {
  const result = await api.login({ identifier: identifier || email, password });
  setUserAuth(result.token, result.user);
  return result;
}

async function register(data: any) {
  const result = await api.register(data);
  setUserAuth(result.token, result.user);
  return result;
}

function logout() {
  // An admin's logout also ends the session on the server, so a copied token stops working. Sent before the
  // token is cleared; the page does not wait for the answer.
  if (getStoredUser()?.role === 'admin') api.adminLogout().catch(() => {});
  setUserAuth(null, null);
}

async function refreshUser() {
  const { user: freshUser } = await api.getMe();
  setUserAuth(getUserToken(), freshUser);
  return freshUser;
}

export function useAuth() {
  const stored = useStore($user);
  const checking = useStore($loading);
  // The server render (and the first client render, which must match it) knows no session: the stored one is only
  // read after mount, so a logged-in visitor never causes a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    authReady();
  }, []);
  const user = mounted ? stored : null;
  const loading = !mounted || checking;
  return {
    user,
    loading,
    isAuthenticated: Boolean(user),
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
    refreshUser,
  };
}
