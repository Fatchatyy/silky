// When the keep-awake ping is allowed to run. Pure: no Worker API, no network, so the API's test script can import it.
//
// Cloudflare cron triggers are always in UTC. Tunisia is UTC+1 and has no daylight saving time today, but the window is
// decided here, in the shop's own time zone, instead of being baked into a UTC cron expression: the trigger fires every
// 10 minutes and this module says whether that tick is inside the opening hours.

export const DEFAULT_WINDOW = Object.freeze({ fromHour: 7, toHour: 24, timeZone: 'Africa/Tunis' });

const parseHour = (value, fallback, { min, max }) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= min && hour <= max ? hour : fallback;
};

const isValidTimeZone = (timeZone) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** The window from the Worker's variables; a missing or invalid value falls back to the default (07:00 to midnight, Tunis). */
export function readWindow(vars = {}) {
  const fromHour = parseHour(vars.KEEPALIVE_FROM_HOUR, DEFAULT_WINDOW.fromHour, { min: 0, max: 23 });
  let toHour = parseHour(vars.KEEPALIVE_TO_HOUR, DEFAULT_WINDOW.toHour, { min: 1, max: 24 });
  if (toHour <= fromHour) toHour = DEFAULT_WINDOW.toHour;
  const zone = String(vars.KEEPALIVE_TIMEZONE ?? '').trim();
  return { fromHour, toHour, timeZone: zone && isValidTimeZone(zone) ? zone : DEFAULT_WINDOW.timeZone };
}

/** The hour of day (0-23) of a timestamp in the given time zone. */
export function hourIn(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
  return Number(parts.find((part) => part.type === 'hour').value);
}

/** True when `timestamp` (ms since the epoch) falls from `fromHour`:00 up to, not including, `toHour`:00 (24 = midnight). */
export function isInsideWindow(timestamp, window = DEFAULT_WINDOW) {
  const hour = hourIn(timestamp, window.timeZone);
  return hour >= window.fromHour && hour < window.toHour;
}
