// Server-side fetches to the API (no localStorage, no cookies, always a timeout). A page tells "does not exist"
// (ApiNotFound -> a real 404) from "the API is down" (ApiUnavailable -> 503, which search engines retry).
import { apiUrl } from './config';

export class ApiNotFound extends Error {}
export class ApiUnavailable extends Error {}

const TIMEOUT_MS = 5000;

export async function getJson<T = any>(path: string, { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new ApiUnavailable(`API unreachable (${path}): ${err?.message || err}`);
  }
  if (res.status === 404) throw new ApiNotFound(path);
  if (!res.ok) throw new ApiUnavailable(`API answered ${res.status} (${path})`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiUnavailable(`API sent an unreadable body (${path})`);
  }
}

/** Like getJson but a missing resource gives null instead of throwing. */
export async function getJsonOrNull<T = any>(path: string): Promise<T | null> {
  try {
    return await getJson<T>(path);
  } catch (err) {
    if (err instanceof ApiNotFound) return null;
    throw err;
  }
}

// Data every page needs (colours, announcements, hero) changes rarely: kept a few seconds per Worker instance (only to absorb a burst; the pages themselves are cached 5 minutes). Kept short on purpose: the admin's purge only clears the instance that receives it, and a long memory in another instance would put old data back into a freshly purged page.
const memo = new Map<string, { at: number; value: unknown }>();
export async function getCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** Drops the short-lived server memory (theme, product list) of this Worker instance, after an admin change. */
export function forgetCachedData() {
  memo.clear();
}
