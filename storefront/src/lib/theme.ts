// Shop colours and announcement bar come from the API (/api/theme). The colours become CSS variables written into
// the page by the server, so there is no flash of the default colours (the old app set them from JavaScript).
import { getCached, getJson } from './serverApi';

export const DEFAULT_THEME: any = {
  primary: '#8D191C',
  secondary: '#F3EBEC',
  heroLeftImage: '/pictures/femme_example.jpg',
  heroRightImage: '/pictures/enfant_example.jpg',
  announcements: [
    { text: 'Livraison sur toute la Tunisie!', bold: false, italic: false, underline: false },
    { text: 'Livraison rapide en 24/48 heures', bold: false, italic: false, underline: false },
    { text: 'Qualité garantie', bold: false, italic: false, underline: false },
    { text: 'Promotions speciales et Offres exclusives!', bold: false, italic: false, underline: false },
    { text: 'Service client disponible 24/7', bold: false, italic: false, underline: false },
  ],
  announcementsHidden: false,
  heroConfig: null,
};

/** The theme, kept 5 seconds per Worker instance (short, so a theme change made in the admin is not re-cached by another instance); the shop's defaults if the API does not answer. */
export async function loadTheme() {
  try {
    return await getCached('theme', 5_000, () => getJson('/theme'));
  } catch {
    return DEFAULT_THEME;
  }
}

function parseHex(hex: string) {
  const n = String(hex || '').replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function darkenHex(hex: string, amount = 0.15) {
  const { r, g, b } = parseHex(hex);
  const dr = Math.max(0, Math.floor(r * (1 - amount)));
  const dg = Math.max(0, Math.floor(g * (1 - amount)));
  const db = Math.max(0, Math.floor(b * (1 - amount)));
  return `#${((1 << 24) + (dr << 16) + (dg << 8) + db).toString(16).slice(1).toUpperCase()}`;
}

const HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** CSS for :root. Values that are not hex colours are ignored (the theme is admin-written text). */
export function themeCss(theme: any): string {
  const primary = HEX.test(theme?.primary) ? theme.primary : DEFAULT_THEME.primary;
  const secondary = HEX.test(theme?.secondary) ? theme.secondary : DEFAULT_THEME.secondary;
  const { r, g, b } = parseHex(primary);
  return `:root{--color-primary:${primary};--color-secondary:${secondary};--color-primary-hover:${darkenHex(primary)};--color-secondary-muted:${secondary};--color-primary-rgb:${r}, ${g}, ${b};}`;
}
