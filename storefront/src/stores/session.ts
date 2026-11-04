// The signed-in customer and the guest id live in localStorage under the same keys as the old storefront, so
// customers who are already logged in (or hold a cart) keep them. persistentAtom also follows other tabs.
import { persistentAtom } from '@nanostores/persistent';

const raw = { encode: (value: string | undefined) => value ?? '', decode: (value: string) => value };
const json = {
  encode: (value: unknown) => JSON.stringify(value),
  decode: (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
};

export const $token = persistentAtom<string | undefined>('silky_auth_token', undefined, raw);
export const $user = persistentAtom<any>('silky_auth_user', null, json);
export const $guestId = persistentAtom<string | undefined>('silky_guest_session_id', undefined, raw);

export const getUserToken = () => $token.get() || null;
export const getStoredUser = () => $user.get() || null;

export function setUserAuth(token: string | null | undefined, user: any) {
  if (token) {
    $token.set(token);
    $user.set(user);
  } else {
    $token.set(undefined);
    $user.set(null);
  }
}

export function clearUserAuth() {
  setUserAuth(null, null);
  window.dispatchEvent(new Event('silky:auth-expired'));
}
