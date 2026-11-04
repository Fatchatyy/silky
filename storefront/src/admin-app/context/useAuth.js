// The admin panel's view of the session. The session itself is the shop's (stores/auth.ts: same localStorage keys
// silky_auth_token / silky_auth_user, followed across tabs), so signing in or out here is signing in or out on the shop.
// This only adds the password login of the panel.
import { useAuth as useShopAuth } from '../../stores/auth';
import { setUserAuth } from '../../stores/session';
import { adminApi } from '../../admin/adminApi';

async function adminPanelLogin(password) {
  const result = await adminApi.adminLogin(password);
  setUserAuth(result.token, result.user);
  return result;
}

export function useAuth() {
  return { ...useShopAuth(), adminPanelLogin };
}
