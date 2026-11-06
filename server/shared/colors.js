// Product color names and the "Couleur · Taille S" detail line, in Arabic. Color names are typed in the admin, so the
// Arabic name of a color comes, in this order, from (1) the Arabic name the admin wrote for that color of the product,
// (2) the built-in list of common French (and a few English) names below, (3) the name exactly as typed. Modern
// Standard Arabic, to be reviewed by the owner. Pure: no DOM, no React.

const BASE = {
  noir: 'أسود', noire: 'أسود', blanc: 'أبيض', blanche: 'أبيض', rouge: 'أحمر', bleu: 'أزرق', bleue: 'أزرق',
  vert: 'أخضر', verte: 'أخضر', jaune: 'أصفر', rose: 'وردي', gris: 'رمادي', grise: 'رمادي', marron: 'بني',
  beige: 'بيج', orange: 'برتقالي', violet: 'بنفسجي', violette: 'بنفسجي', mauve: 'موف', bordeaux: 'خمري',
  marine: 'كحلي', 'bleu marine': 'كحلي', kaki: 'كاكي', camel: 'جملي', creme: 'كريمي', ecru: 'كريمي',
  ivoire: 'عاجي', turquoise: 'تركوازي', fuchsia: 'فوشيا', dore: 'ذهبي', doree: 'ذهبي', argente: 'فضي',
  argentee: 'فضي', saumon: 'سلموني', lilas: 'ليلكي', nude: 'نيود', taupe: 'توب', corail: 'مرجاني',
  moutarde: 'خردلي', olive: 'زيتي', 'vert olive': 'أخضر زيتي', anthracite: 'فحمي', chocolat: 'شوكولاتة',
  multicolore: 'متعدد الألوان', ciel: 'سماوي', 'bleu ciel': 'أزرق سماوي', 'bleu nuit': 'أزرق ليلي',
  'bleu roi': 'أزرق ملكي', menthe: 'نعناعي', 'vert menthe': 'أخضر نعناعي', blush: 'وردي فاتح', champagne: 'شامبانيا',
  prune: 'برقوقي', lavande: 'لافندر', black: 'أسود', white: 'أبيض', red: 'أحمر', blue: 'أزرق', green: 'أخضر',
  yellow: 'أصفر', pink: 'وردي', grey: 'رمادي', gray: 'رمادي', brown: 'بني', purple: 'بنفسجي', navy: 'كحلي',
  gold: 'ذهبي', silver: 'فضي', 'blanc casse': 'أبيض عاجي', 'off white': 'أبيض عاجي',
};

// "bleu clair" -> "أزرق فاتح": a known color followed by a shade word.
const SHADES = { clair: 'فاتح', claire: 'فاتح', pale: 'فاتح', pastel: 'باستيل', fonce: 'غامق', foncee: 'غامق', light: 'فاتح', dark: 'غامق' };

// Lowercase, without accents or punctuation, single spaces: "Rose Poudré" -> "rose poudre".
const normalize = (text) =>
  [...String(text).normalize('NFD')]
    .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f) // drop the accent marks left by NFD
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The color name in Arabic: the Arabic name the admin wrote for this color of the product (`colors` = the product's
 * colors, each { name, nameAr }), else the built-in list, else the name as typed.
 */
export function colorNameAr(name, colors = []) {
  if (typeof name !== 'string' || !name.trim()) return name;
  const key = normalize(name);
  const own = Array.isArray(colors) ? colors.find((color) => color && normalize(color.name || '') === key) : null;
  if (own && typeof own.nameAr === 'string' && own.nameAr.trim()) return own.nameAr.trim();
  if (BASE[key]) return BASE[key];
  const words = key.split(' ');
  if (words.length >= 2 && SHADES[words[words.length - 1]]) {
    const base = BASE[words.slice(0, -1).join(' ')];
    if (base) return `${base} ${SHADES[words[words.length - 1]]}`;
  }
  return name;
}

/** "Rose · Taille S" (the line saved with a cart item) in Arabic: known colors translated, "Taille X" -> "المقاس X". */
export function detailsAr(details, colors = []) {
  if (typeof details !== 'string' || !details) return details;
  return details
    .split(' · ')
    .map((part) => {
      const size = part.match(/^Taille (.+)$/);
      if (size) return `المقاس ${size[1]}`;
      if (part === 'Standard') return 'قياسي';
      return colorNameAr(part, colors);
    })
    .join(' · ');
}
