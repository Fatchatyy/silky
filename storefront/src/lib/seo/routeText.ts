// Titles and descriptions of the fixed pages, French and Arabic, written for the storefront (descriptions only
// restate what the page shows). The Arabic text is Modern Standard Arabic translated from the French and still to be
// reviewed by the owner. Pure.
import type { Locale } from './types.ts';

export type PageKey =
  | 'home' | 'about' | 'contact' | 'service-client' | 'livraison-retours' | 'faq'
  | 'search' | 'cart' | 'checkout' | 'order-confirmation' | 'leave-review' | 'login' | 'signup' | 'register'
  | 'password-reset' | 'password-reset-token' | 'favorites' | 'account';

export type PageText = { title: string; description?: string; fullTitle?: string };

/** Path of each page (French, without prefix). */
export const PAGE_PATHS: Record<PageKey, string> = {
  home: '/',
  about: '/about',
  contact: '/contact',
  'service-client': '/service-client',
  'livraison-retours': '/livraison-retours',
  faq: '/faq',
  search: '/search',
  cart: '/cart',
  checkout: '/checkout',
  'order-confirmation': '/order-confirmation',
  'leave-review': '/leave-review',
  login: '/login',
  signup: '/signup',
  register: '/register',
  'password-reset': '/password-reset',
  'password-reset-token': '/password-reset',
  favorites: '/favorites',
  account: '/account',
};

/** Pages a search engine may index. Everything else in PageKey is noindex. */
export const INDEXABLE_PAGES: PageKey[] = ['home', 'about', 'contact', 'service-client', 'livraison-retours', 'faq'];

export const PAGE_TEXT: Record<Locale, Record<PageKey, PageText>> = {
  fr: {
    home: {
      title: 'Silky',
      fullTitle: 'Silky – Boutique de mode en ligne en Tunisie',
      description:
        'Silky, boutique en ligne de mode et de prêt-à-porter pensée en Tunisie. Livraison à domicile en 24 à 48 heures, paiement à la livraison.',
    },
    about: {
      title: 'À propos',
      description:
        'Silky, boutique en ligne de mode et de prêt-à-porter : des pièces pensées en Tunisie dans des matières de qualité, au meilleur prix.',
    },
    contact: { title: 'Nous contacter', description: 'Envoyez un message au service client Silky avec le formulaire de contact.' },
    'service-client': {
      title: 'Service client',
      description: 'Joignez le service client Silky au +216 25 274 800, par e-mail ou sur nos réseaux sociaux.',
    },
    'livraison-retours': {
      title: 'Livraison et retours',
      description:
        'Livraison à domicile en 24 à 48 heures, paiement à la livraison, inspection du colis devant le livreur et échange de taille ou de couleur sous 48 heures.',
    },
    faq: {
      title: 'Questions fréquentes',
      description: 'Livraison, paiement à la livraison, échange, remboursement et contact : les réponses aux questions fréquentes sur Silky.',
    },
    search: { title: 'Recherche' },
    cart: { title: 'Panier' },
    checkout: { title: 'Finaliser la commande' },
    'order-confirmation': { title: 'Commande confirmée' },
    'leave-review': { title: 'Donner votre avis' },
    login: { title: 'Connexion' },
    signup: { title: 'Créer un compte' },
    register: { title: 'Créer un compte' },
    'password-reset': { title: 'Mot de passe oublié' },
    'password-reset-token': { title: 'Nouveau mot de passe' },
    favorites: { title: 'Mes favoris' },
    account: { title: 'Mon compte' },
  },
  ar: {
    home: {
      title: 'Silky',
      fullTitle: 'Silky – متجر أزياء إلكتروني في تونس',
      description: 'Silky، متجر إلكتروني للأزياء والملابس الجاهزة مصمّم في تونس. توصيل إلى المنزل في 24 إلى 48 ساعة والدفع عند الاستلام.',
    },
    about: {
      title: 'من نحن',
      description: 'Silky، متجر إلكتروني للأزياء والملابس الجاهزة: قطع مصمّمة في تونس بمواد عالية الجودة وبأفضل سعر.',
    },
    contact: { title: 'اتصلوا بنا', description: 'أرسلوا رسالة إلى خدمة عملاء Silky عبر نموذج الاتصال.' },
    'service-client': {
      title: 'خدمة العملاء',
      description: 'تواصلوا مع خدمة عملاء Silky على الرقم +216 25 274 800 أو عبر البريد الإلكتروني أو شبكات التواصل الاجتماعي.',
    },
    'livraison-retours': {
      title: 'التوصيل والإرجاع',
      description: 'توصيل إلى المنزل في 24 إلى 48 ساعة، الدفع عند الاستلام، فحص الطرد أمام عامل التوصيل وتبديل المقاس أو اللون في غضون 48 ساعة.',
    },
    faq: {
      title: 'الأسئلة الشائعة',
      description: 'التوصيل، الدفع عند الاستلام، التبديل، الاسترجاع والتواصل: إجابات عن الأسئلة الشائعة حول Silky.',
    },
    search: { title: 'البحث' },
    cart: { title: 'السلة' },
    checkout: { title: 'إتمام الطلب' },
    'order-confirmation': { title: 'تأكيد الطلب' },
    'leave-review': { title: 'أضف رأيك' },
    login: { title: 'تسجيل الدخول' },
    signup: { title: 'إنشاء حساب' },
    register: { title: 'إنشاء حساب' },
    'password-reset': { title: 'نسيت كلمة المرور' },
    'password-reset-token': { title: 'كلمة مرور جديدة' },
    favorites: { title: 'مفضلاتي' },
    account: { title: 'حسابي' },
  },
};

export const NOT_FOUND_TITLE: Record<Locale, string> = { fr: 'Page introuvable', ar: 'الصفحة غير موجودة' };
export const PRODUCT_NOT_FOUND_TITLE: Record<Locale, string> = { fr: 'Produit introuvable', ar: 'المنتج غير موجود' };
export const UNAVAILABLE_TITLE: Record<Locale, string> = { fr: 'Service momentanément indisponible', ar: 'الخدمة غير متاحة مؤقتًا' };

/** The Arabic twin of a fixed page exists (title and description written) so the /ar page may be indexed. */
export const hasArabicPageText = (key: PageKey) => Boolean(PAGE_TEXT.ar[key]?.description);

// Display text of the named collections (titles and intro), French and Arabic.
export const COLLECTIONS: Record<string, Record<Locale, { title: string; heroText: string }> & { fallbackImage: string }> = {
  femme: {
    fr: { title: 'Collection Femme', heroText: 'Découvrez la collection femme Silky : livraison à domicile en 24 à 48 heures, paiement à la livraison et échange de taille ou de couleur sous 48 heures.' },
    ar: { title: 'مجموعة النساء', heroText: 'اكتشفوا مجموعة النساء من Silky: توصيل إلى المنزل في غضون 24 إلى 48 ساعة، والدفع عند الاستلام، وإمكانية تبديل المقاس أو اللون في غضون 48 ساعة.' },
    fallbackImage: '/pictures/femme_example.jpg',
  },
  enfant: {
    fr: { title: 'Collection Enfant', heroText: 'Découvrez la collection enfant Silky : livraison à domicile en 24 à 48 heures, paiement à la livraison et échange de taille ou de couleur sous 48 heures.' },
    ar: { title: 'مجموعة الأطفال', heroText: 'اكتشفوا مجموعة الأطفال من Silky: توصيل إلى المنزل في غضون 24 إلى 48 ساعة، والدفع عند الاستلام، وإمكانية تبديل المقاس أو اللون في غضون 48 ساعة.' },
    fallbackImage: '/pictures/enfant_example.jpg',
  },
};
export const DEFAULT_COLLECTION: Record<Locale, { title: string; heroText: string }> & { fallbackImage: string } = {
  fr: { title: 'Collection', heroText: 'Découvrez nos produits' },
  ar: { title: 'المجموعة', heroText: 'اكتشفوا منتجاتنا' },
  fallbackImage: '/pictures/femme_example.jpg',
};
export const isNamedCollection = (slug: string) => Object.prototype.hasOwnProperty.call(COLLECTIONS, slug);
/** The collections the header links to (femme, enfant): they always have a page, even while they hold no published product. */
export const NAMED_COLLECTION_SLUGS = Object.keys(COLLECTIONS);
export function collectionText(slug: string, locale: Locale) {
  const base = isNamedCollection(slug) ? COLLECTIONS[slug] : DEFAULT_COLLECTION;
  return { ...base[locale], fallbackImage: base.fallbackImage };
}
