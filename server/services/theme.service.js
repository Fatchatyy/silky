import { themeRepository } from '../repositories/theme.repository.js';
import { removeUploadIfUnused } from './product.service.js';

export async function getTheme() {
  return themeRepository.getSettings();
}

/** Every '/uploads/...' image the home hero points at (the legacy left/right images and every image of every template). */
export function heroUploadUrls(settings) {
  const config = settings?.heroConfig || {};
  const urls = [
    settings?.heroLeftImage,
    settings?.heroRightImage,
    config.option1?.leftImage,
    config.option1?.rightImage,
    config.option2?.image,
    ...(config.option3?.slides || []).map((slide) => slide?.image),
  ];
  return new Set(urls.filter((url) => typeof url === 'string' && url.trim().startsWith('/uploads/')).map((url) => url.trim()));
}

export async function updateTheme({ primary, secondary, heroLeftImage, heroRightImage, announcements, announcementsHidden, heroConfig }) {
  const before = heroUploadUrls(await themeRepository.getSettings());
  const updated = await themeRepository.updateSettings({
    primary,
    secondary,
    heroLeftImage,
    heroRightImage,
    announcements,
    announcementsHidden,
    heroConfig,
  });

  // Hero images that were replaced or removed by this save are deleted from the storage (unless something else still uses
  // them). Runs after the save is committed and never fails it.
  try {
    const after = heroUploadUrls(updated);
    for (const url of before) {
      if (!after.has(url)) await removeUploadIfUnused(url);
    }
  } catch (err) {
    console.error('[theme] could not clean up replaced hero images:', String(err?.message ?? err).slice(0, 160));
  }
  return updated;
}

export async function getDeliveryFee() {
  return themeRepository.getDeliveryFee();
}
