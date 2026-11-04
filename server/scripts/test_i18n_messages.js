/**
 * Checks the storefront interface texts (shared/messages.js): every French key has an Arabic twin and the other way
 * round, both use the same {placeholders}, nothing is empty, Arabic texts really contain Arabic (brand names aside),
 * and the lookup falls back to French instead of showing a raw key. No database, no network.
 *
 * Usage: node server/scripts/test_i18n_messages.js
 */
import fs from 'node:fs';
import { CANONICAL_GOVERNORATES } from '../config/governorates.js';
import { colorNameAr, detailsAr } from '../../shared/colors.js';
import { AR_BY_FRENCH, GOVERNORATES_AR, MESSAGES, governorateLabel, translate, translateKnown } from '../../shared/messages.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const hasArabic = (text) => /[؀-ۿ]/.test(text);

const frKeys = Object.keys(MESSAGES.fr);
const arKeys = Object.keys(MESSAGES.ar);

const missingInArabic = frKeys.filter((k) => !(k in MESSAGES.ar));
const missingInFrench = arKeys.filter((k) => !(k in MESSAGES.fr));
assert(missingInArabic.length === 0, `every French key has an Arabic text (${frKeys.length} keys)${missingInArabic.length ? ': ' + missingInArabic.join(', ') : ''}`);
assert(missingInFrench.length === 0, `no Arabic key without a French one${missingInFrench.length ? ': ' + missingInFrench.join(', ') : ''}`);

const empty = [...frKeys.map((k) => ['fr', k]), ...arKeys.map((k) => ['ar', k])].filter(([l, k]) => !String(MESSAGES[l][k]).trim());
assert(empty.length === 0, `no empty text${empty.length ? ': ' + empty.map((e) => e.join('.')).join(', ') : ''}`);

const mismatched = frKeys.filter((k) => k in MESSAGES.ar && placeholders(MESSAGES.fr[k]) !== placeholders(MESSAGES.ar[k]));
assert(mismatched.length === 0, `French and Arabic use the same placeholders${mismatched.length ? ': ' + mismatched.join(', ') : ''}`);

// A text that is identical in both languages is almost always a forgotten translation (a bare brand or number is fine).
const identical = frKeys.filter((k) => MESSAGES.ar[k] === MESSAGES.fr[k] && /[A-Za-zÀ-ÿ]{4,}/.test(MESSAGES.fr[k]));
assert(identical.length === 0, `no Arabic text left identical to the French one${identical.length ? ': ' + identical.join(', ') : ''}`);

const noArabicLetters = arKeys.filter((k) => !hasArabic(MESSAGES.ar[k]) && /[A-Za-zÀ-ÿ]{4,}/.test(MESSAGES.ar[k]));
assert(noArabicLetters.length === 0, `every Arabic text contains Arabic letters${noArabicLetters.length ? ': ' + noArabicLetters.join(', ') : ''}`);

// Lookup rules
assert(translate('fr', 'notfound.home') === MESSAGES.fr['notfound.home'], 'French lookup returns the French text');
assert(translate('ar', 'notfound.home') === MESSAGES.ar['notfound.home'], 'Arabic lookup returns the Arabic text');
assert(translate('ar', 'no.such.key') === 'no.such.key', 'an unknown key shows the key, not undefined');
assert(translate('ar', 'reviews.count', { count: 7 }).includes('7'), 'placeholders are filled in');
assert(translate('fr', 'stock.low', { qty: 2 }) === 'Plus que 2 en stock', 'French stock sentence is unchanged');
assert(translate('ar', 'stock.low', { qty: 2 }).includes('2'), 'Arabic stock sentence gets the number');

// Known default theme texts
assert(translateKnown('fr', 'Faible') === 'Faible', 'French known texts are left alone');
assert(translateKnown('ar', 'Excellent') === AR_BY_FRENCH.Excellent, 'a known French default turns into Arabic');
assert(translateKnown('ar', 'Texte tapé par un administrateur') === 'Texte tapé par un administrateur', 'text typed in the admin stays as typed');

// Governorates: the Arabic labels cover exactly the 24 canonical names, and the checkout lists use the same names
const canonical = CANONICAL_GOVERNORATES.map((g) => g.name).sort();
assert(JSON.stringify(Object.keys(GOVERNORATES_AR).sort()) === JSON.stringify(canonical), 'Arabic governorate labels match the 24 canonical names');
assert(governorateLabel('fr', 'Sfax') === 'Sfax' && governorateLabel('ar', 'Sfax') === 'صفاقس', 'governorate label follows the language, value stays Latin');
for (const file of ['src/pages/Checkout.jsx', 'src/components/BuyNowModal.jsx']) {
  const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const listed = [...text.match(/TUNISIAN_GOVERNORATES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(listed) === JSON.stringify(canonical), `${file}: governorate list is the canonical one`);
}

// Server messages shown to customers
const stockAr = translateKnown('ar', 'Robe: stock insuffisant (2 disponible(s))');
assert(translateKnown('ar', 'Connexion impossible. Identifiants incorrects.') !== 'Connexion impossible. Identifiants incorrects.', 'login error is translated');
assert(stockAr.includes('Robe') && stockAr.includes('2') && hasArabic(stockAr), 'stock message keeps the product name and the number');
assert(translateKnown('ar', 'Veuillez vous connecter pour continuer.') === 'يرجى تسجيل الدخول للمتابعة.' && translateKnown('ar', 'Session expirée. Veuillez vous reconnecter.') === 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.', 'the two login-check messages have an Arabic version');
assert(translateKnown('fr', 'Votre panier est vide') === 'Votre panier est vide', 'French server messages are untouched');
assert(translateKnown('ar', undefined) === undefined, 'a missing message stays missing');

// Colors and the cart detail line
assert(colorNameAr('Crème') === 'كريمي' && colorNameAr('Doré') === 'ذهبي' && colorNameAr('Blanc cassé') === 'أبيض عاجي', 'accents inside a color name do not break the lookup (Crème, Doré, Blanc cassé)');
const ownColors = [{ name: 'Blanc cassé', nameAr: ' أوف وايت ' }, { name: 'Rose', nameAr: '' }, { name: 'Vert pomme', nameAr: 'أخضر تفاحي' }];
assert(colorNameAr('Blanc cassé', ownColors) === 'أوف وايت', 'the Arabic color name written in the admin wins over the built-in list (trimmed)');
assert(colorNameAr('Rose', ownColors) === 'وردي' && colorNameAr('vert POMME', ownColors) === 'أخضر تفاحي', 'an empty Arabic name falls back to the list; matching ignores case');
assert(colorNameAr('Vert pomme', []) === 'Vert pomme' && colorNameAr('Vert pomme', undefined) === 'Vert pomme', 'no Arabic name and not in the list: shown as typed');
assert(detailsAr('Blanc cassé · Taille M', ownColors) === 'أوف وايت · المقاس M', 'the cart detail line uses the Arabic color name written for that product');
assert(colorNameAr('Rose') === 'وردي' && colorNameAr('NOIR') === 'أسود' && colorNameAr('Blanche') === 'أبيض', 'known colors are translated, any letter case');
assert(colorNameAr('Bleu Marine') === 'كحلي' && colorNameAr('Bleu clair') === 'أزرق فاتح' && colorNameAr('Vert foncé') === 'أخضر غامق', 'accents, shades and two-word colors');
assert(colorNameAr('Nuance Spéciale XYZ') === 'Nuance Spéciale XYZ' && colorNameAr('') === '' && colorNameAr(undefined) === undefined, 'an unknown color is shown as typed');
assert(detailsAr('Rose · Taille S') === 'وردي · المقاس S' && detailsAr('Taille 4 ans') === 'المقاس 4 ans' && detailsAr('Standard') === 'قياسي', 'the cart detail line is translated part by part');
assert(detailsAr('Couleur Inconnue · Taille M') === 'Couleur Inconnue · المقاس M', 'an unknown color inside the detail line stays as typed');
assert(MESSAGES.fr['collection.all'] === 'TOUT' && MESSAGES.fr['collection.fullWomen'] === 'TOUTE LA COLLECTION FEMME', 'French button texts are unchanged');
assert(!Object.keys(AR_BY_FRENCH).includes('Livraison sur toute la Tunisie!'), 'the announcement bar texts are not translated');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
