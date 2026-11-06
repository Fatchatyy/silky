// Translation helper for .astro files (the React components use useT()).
import { translate } from '../../shared/messages.js';
import type { Locale } from './seo/types.ts';

export const translator = (locale: Locale) => (key: string, vars?: Record<string, unknown>) => translate(locale, key, vars);

export const dirOf = (locale: Locale) => (locale === 'ar' ? 'rtl' : 'ltr');
