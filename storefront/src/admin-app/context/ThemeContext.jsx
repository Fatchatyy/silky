// The theme as the admin panel edits it (colours, announcement bar, hero). Saving also clears the cached shop pages (adminApi.updateTheme).
import { createContext, useContext, useEffect, useState } from 'react';
import { adminApi as api } from '../../admin/adminApi';

export const DEFAULT_HERO_CONFIG = {
  templateType: 'option1',
  option1: {
    mainText: 'Découvrez nos collections',
    smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
    leftImage: '/pictures/femme_example.jpg',
    rightImage: '/pictures/enfant_example.jpg',
    leftButton: { text: 'Femme', destination: '/collection/femme', visible: true },
    rightButton: { text: 'Enfant', destination: '/collection/enfant', visible: true },
  },
  option2: {
    mainText: 'Découvrez nos collections',
    smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
    image: '/pictures/femme_example.jpg',
    textPosition: 'left',
    button: { text: 'Découvrir', destination: '/collection/femme', visible: true },
  },
  option3: {
    slides: [
      {
        id: 'slide-1',
        mainText: 'Découvrez nos collections',
        smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
        image: '/pictures/femme_example.jpg',
        textPosition: 'left',
        button: { text: 'Femme', destination: '/collection/femme', visible: true },
      },
      {
        id: 'slide-2',
        mainText: 'Nouvelle collection enfant',
        smallText: 'Tendances & qualité au meilleur prix',
        image: '/pictures/enfant_example.jpg',
        textPosition: 'right',
        button: { text: 'Enfant', destination: '/collection/enfant', visible: true },
      },
    ],
  },
};

const DEFAULT_THEME = {
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
  heroConfig: DEFAULT_HERO_CONFIG,
};

const ThemeContext = createContext(null);

function parseHex(hex) {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function darkenHex(hex, amount = 0.15) {
  const { r, g, b } = parseHex(hex);
  const dr = Math.max(0, Math.floor(r * (1 - amount)));
  const dg = Math.max(0, Math.floor(g * (1 - amount)));
  const db = Math.max(0, Math.floor(b * (1 - amount)));
  return `#${((1 << 24) + (dr << 16) + (dg << 8) + db).toString(16).slice(1).toUpperCase()}`;
}

function applyThemeToDocument(theme) {
  const root = document.documentElement;
  const { r, g, b } = parseHex(theme.primary);
  root.style.setProperty('--color-primary', theme.primary);
  root.style.setProperty('--color-secondary', theme.secondary);
  root.style.setProperty('--color-primary-hover', darkenHex(theme.primary));
  root.style.setProperty('--color-secondary-muted', theme.secondary);
  root.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`);
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getTheme()
      .then((data) => {
        setTheme(data);
        applyThemeToDocument(data);
      })
      .catch(() => applyThemeToDocument(DEFAULT_THEME))
      .finally(() => setLoading(false));
  }, []);

  const updateTheme = async (nextTheme) => {
    const saved = await api.updateTheme(nextTheme);
    setTheme(saved);
    applyThemeToDocument(saved);
    return saved;
  };

  const refreshTheme = async () => {
    const data = await api.getTheme();
    setTheme(data);
    applyThemeToDocument(data);
    return data;
  };

  return (
    <ThemeContext.Provider value={{ theme, loading, updateTheme, refreshTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
