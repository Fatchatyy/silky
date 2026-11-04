import { eq } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { siteSettings } from '../models/index.js';

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
};

function parseAnnouncements(raw) {
  if (raw === null || raw === undefined) {
    return DEFAULT_THEME.announcements;
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 7).map((item) => {
        if (typeof item === 'string') {
          return { text: item, bold: false, italic: false, underline: false };
        }
        return {
          text: String(item?.text || ''),
          bold: Boolean(item?.bold),
          italic: Boolean(item?.italic),
          underline: Boolean(item?.underline),
        };
      });
    }
    return DEFAULT_THEME.announcements;
  } catch {
    return DEFAULT_THEME.announcements;
  }
}

function sanitizeAnnouncements(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 7).map((item) => {
    if (typeof item === 'string') {
      return { text: item.trim(), bold: false, italic: false, underline: false };
    }
    return {
      text: String(item?.text || '').trim(),
      bold: Boolean(item?.bold),
      italic: Boolean(item?.italic),
      underline: Boolean(item?.underline),
    };
  });
}

function buildDefaultHeroConfig(legacyLeft, legacyRight) {
  const left = legacyLeft !== undefined && legacyLeft !== null && legacyLeft !== '' ? legacyLeft : '/pictures/femme_example.jpg';
  const right = legacyRight !== undefined && legacyRight !== null && legacyRight !== '' ? legacyRight : '/pictures/enfant_example.jpg';
  return {
    templateType: 'option1',
    option1: {
      mainText: 'Découvrez nos collections',
      smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
      leftImage: left,
      rightImage: right,
      leftButton: { text: 'Femme', destination: '/collection/femme', visible: true },
      rightButton: { text: 'Enfant', destination: '/collection/enfant', visible: true },
    },
    option2: {
      mainText: 'Découvrez nos collections',
      smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
      image: left,
      textPosition: 'left',
      button: { text: 'Découvrir', destination: '/collection/femme', visible: true },
    },
    option3: {
      slides: [
        {
          id: 'slide-1',
          mainText: 'Découvrez nos collections',
          smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
          image: left,
          textPosition: 'left',
          button: { text: 'Femme', destination: '/collection/femme', visible: true },
        },
        {
          id: 'slide-2',
          mainText: 'Nouvelle collection enfant',
          smallText: 'Tendances & qualité au meilleur prix',
          image: right,
          textPosition: 'right',
          button: { text: 'Enfant', destination: '/collection/enfant', visible: true },
        },
      ],
    },
  };
}

function sanitizePos(pos) {
  if (!pos || typeof pos !== 'object') return { x: 50, y: 50, zoom: 100 };
  const x = typeof pos.x === 'number' && !isNaN(pos.x) ? Math.max(0, Math.min(100, Math.round(pos.x * 10) / 10)) : 50;
  const y = typeof pos.y === 'number' && !isNaN(pos.y) ? Math.max(0, Math.min(100, Math.round(pos.y * 10) / 10)) : 50;
  const zoom = typeof pos.zoom === 'number' && !isNaN(pos.zoom) ? Math.max(80, Math.min(300, Math.round(pos.zoom))) : 100;
  return { x, y, zoom };
}

// Optional Arabic version of a hero text (title, subtitle, button label): '' means "none" (the page then shows the French text).
const arText = (value) => (typeof value === 'string' ? value.trim().slice(0, 500) : '');

function parseHeroConfig(raw, legacyLeft, legacyRight) {
  const defaults = buildDefaultHeroConfig(legacyLeft, legacyRight);
  if (raw === null || raw === undefined || raw === '') {
    return defaults;
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed !== 'object' || parsed === null) {
      return defaults;
    }

    const templateType = ['option1', 'option2', 'option3'].includes(parsed.templateType)
      ? parsed.templateType
      : defaults.templateType;

    const option1 = {
      mainText: parsed.option1?.mainText !== undefined ? String(parsed.option1.mainText) : defaults.option1.mainText,
      smallText: parsed.option1?.smallText !== undefined ? String(parsed.option1.smallText) : defaults.option1.smallText,
      mainTextAr: arText(parsed.option1?.mainTextAr),
      smallTextAr: arText(parsed.option1?.smallTextAr),
      leftImage: parsed.option1?.leftImage !== undefined ? String(parsed.option1.leftImage) : defaults.option1.leftImage,
      leftImagePos: sanitizePos(parsed.option1?.leftImagePos),
      rightImage: parsed.option1?.rightImage !== undefined ? String(parsed.option1.rightImage) : defaults.option1.rightImage,
      rightImagePos: sanitizePos(parsed.option1?.rightImagePos),
      leftButton: {
        text: parsed.option1?.leftButton?.text !== undefined ? String(parsed.option1.leftButton.text) : defaults.option1.leftButton.text,
        textAr: arText(parsed.option1?.leftButton?.textAr),
        destination: parsed.option1?.leftButton?.destination !== undefined ? String(parsed.option1.leftButton.destination) : defaults.option1.leftButton.destination,
        visible: parsed.option1?.leftButton?.visible !== undefined ? Boolean(parsed.option1.leftButton.visible) : true,
      },
      rightButton: {
        text: parsed.option1?.rightButton?.text !== undefined ? String(parsed.option1.rightButton.text) : defaults.option1.rightButton.text,
        textAr: arText(parsed.option1?.rightButton?.textAr),
        destination: parsed.option1?.rightButton?.destination !== undefined ? String(parsed.option1.rightButton.destination) : defaults.option1.rightButton.destination,
        visible: parsed.option1?.rightButton?.visible !== undefined ? Boolean(parsed.option1.rightButton.visible) : true,
      },
    };

    const option2 = {
      mainText: parsed.option2?.mainText !== undefined ? String(parsed.option2.mainText) : defaults.option2.mainText,
      smallText: parsed.option2?.smallText !== undefined ? String(parsed.option2.smallText) : defaults.option2.smallText,
      mainTextAr: arText(parsed.option2?.mainTextAr),
      smallTextAr: arText(parsed.option2?.smallTextAr),
      image: parsed.option2?.image !== undefined ? String(parsed.option2.image) : defaults.option2.image,
      imagePos: sanitizePos(parsed.option2?.imagePos),
      textPosition: ['left', 'right'].includes(parsed.option2?.textPosition) ? parsed.option2.textPosition : 'left',
      button: {
        text: parsed.option2?.button?.text !== undefined ? String(parsed.option2.button.text) : defaults.option2.button.text,
        textAr: arText(parsed.option2?.button?.textAr),
        destination: parsed.option2?.button?.destination !== undefined ? String(parsed.option2.button.destination) : defaults.option2.button.destination,
        visible: parsed.option2?.button?.visible !== undefined ? Boolean(parsed.option2.button.visible) : true,
      },
    };

    let slides = Array.isArray(parsed.option3?.slides) ? parsed.option3.slides : defaults.option3.slides;
    if (slides.length < 2) {
      slides = defaults.option3.slides;
    } else if (slides.length > 5) {
      slides = slides.slice(0, 5);
    }
    const cleanSlides = slides.map((s, i) => ({
      id: s.id || `slide-${i + 1}`,
      mainText: s.mainText !== undefined ? String(s.mainText) : '',
      smallText: s.smallText !== undefined ? String(s.smallText) : '',
      mainTextAr: arText(s.mainTextAr),
      smallTextAr: arText(s.smallTextAr),
      image: s.image !== undefined ? String(s.image) : '',
      imagePos: sanitizePos(s.imagePos),
      textPosition: ['left', 'right'].includes(s.textPosition) ? s.textPosition : (i % 2 === 0 ? 'left' : 'right'),
      button: {
        text: s.button?.text !== undefined ? String(s.button.text) : 'Découvrir',
        textAr: arText(s.button?.textAr),
        destination: s.button?.destination !== undefined ? String(s.button.destination) : '/',
        visible: s.button?.visible !== undefined ? Boolean(s.button.visible) : true,
      },
    }));

    const option3 = {
      slides: cleanSlides,
    };

    return {
      templateType,
      option1,
      option2,
      option3,
    };
  } catch {
    return defaults;
  }
}

function sanitizeHeroConfig(config) {
  if (!config || typeof config !== 'object') return null;
  return parseHeroConfig(config);
}

export const themeRepository = {
  async getSettings(tx = db) {
    const [row] = await tx.select().from(siteSettings).where(eq(siteSettings.id, 1));
    if (!row) {
      const [inserted] = await tx.insert(siteSettings).values({ id: 1 }).returning();
      return {
        primary: inserted.primaryColor || DEFAULT_THEME.primary,
        secondary: inserted.secondaryColor || DEFAULT_THEME.secondary,
        heroLeftImage: inserted.heroLeftImage !== null && inserted.heroLeftImage !== undefined ? inserted.heroLeftImage : DEFAULT_THEME.heroLeftImage,
        heroRightImage: inserted.heroRightImage !== null && inserted.heroRightImage !== undefined ? inserted.heroRightImage : DEFAULT_THEME.heroRightImage,
        announcements: parseAnnouncements(inserted.announcements),
        announcementsHidden: inserted.announcementsHidden !== undefined && inserted.announcementsHidden !== null ? Boolean(inserted.announcementsHidden) : false,
        heroConfig: parseHeroConfig(inserted.heroConfig, inserted.heroLeftImage, inserted.heroRightImage),
      };
    }
    return {
      primary: row.primaryColor || DEFAULT_THEME.primary,
      secondary: row.secondaryColor || DEFAULT_THEME.secondary,
      heroLeftImage: row.heroLeftImage !== null && row.heroLeftImage !== undefined ? row.heroLeftImage : DEFAULT_THEME.heroLeftImage,
      heroRightImage: row.heroRightImage !== null && row.heroRightImage !== undefined ? row.heroRightImage : DEFAULT_THEME.heroRightImage,
      announcements: parseAnnouncements(row.announcements),
      announcementsHidden: row.announcementsHidden !== undefined && row.announcementsHidden !== null ? Boolean(row.announcementsHidden) : false,
      heroConfig: parseHeroConfig(row.heroConfig, row.heroLeftImage, row.heroRightImage),
    };
  },

  async updateSettings({ primary, secondary, heroLeftImage, heroRightImage, announcements, announcementsHidden, heroConfig }, tx = db) {
    const current = await this.getSettings(tx);

    const sanitizedAnnouncements = sanitizeAnnouncements(announcements);
    const announcementsJson = sanitizedAnnouncements !== null
      ? JSON.stringify(sanitizedAnnouncements)
      : (current.announcements ? JSON.stringify(current.announcements) : null);

    const sanitizedHeroConfig = heroConfig !== undefined ? sanitizeHeroConfig(heroConfig) : null;
    const heroConfigJson = sanitizedHeroConfig !== null
      ? JSON.stringify(sanitizedHeroConfig)
      : (current.heroConfig ? JSON.stringify(current.heroConfig) : null);

    const nextHeroLeft = heroLeftImage !== undefined ? heroLeftImage : current.heroLeftImage;
    const nextHeroRight = heroRightImage !== undefined ? heroRightImage : current.heroRightImage;
    const nextAnnouncementsHidden = announcementsHidden !== undefined
      ? Boolean(announcementsHidden)
      : (current.announcementsHidden !== undefined ? Boolean(current.announcementsHidden) : false);

    const [updated] = await tx.insert(siteSettings).values({
      id: 1,
      primaryColor: primary || current.primary,
      secondaryColor: secondary || current.secondary,
      heroLeftImage: nextHeroLeft,
      heroRightImage: nextHeroRight,
      announcements: announcementsJson,
      announcementsHidden: nextAnnouncementsHidden,
      heroConfig: heroConfigJson,
    })
    .onConflictDoUpdate({
      target: [siteSettings.id],
      set: {
        primaryColor: primary || current.primary,
        secondaryColor: secondary || current.secondary,
        heroLeftImage: nextHeroLeft,
        heroRightImage: nextHeroRight,
        announcements: announcementsJson,
        announcementsHidden: nextAnnouncementsHidden,
        heroConfig: heroConfigJson,
        updatedAt: new Date(),
      },
    })
    .returning();

    return {
      primary: updated.primaryColor || DEFAULT_THEME.primary,
      secondary: updated.secondaryColor || DEFAULT_THEME.secondary,
      heroLeftImage: updated.heroLeftImage !== null && updated.heroLeftImage !== undefined ? updated.heroLeftImage : '',
      heroRightImage: updated.heroRightImage !== null && updated.heroRightImage !== undefined ? updated.heroRightImage : '',
      announcements: parseAnnouncements(updated.announcements),
      announcementsHidden: Boolean(updated.announcementsHidden),
      heroConfig: parseHeroConfig(updated.heroConfig, updated.heroLeftImage, updated.heroRightImage),
    };
  },

  async getDeliveryFee(tx = db) {
    const [row] = await tx.select({ deliveryFee: siteSettings.deliveryFee }).from(siteSettings).where(eq(siteSettings.id, 1));
    return row ? parseFloat(row.deliveryFee) : 8;
  }
};
