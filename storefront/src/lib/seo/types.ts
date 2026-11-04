export type Locale = 'fr' | 'ar';

export type SeoProps = {
  title: string;
  description?: string;
  /** Absolute URL, https://silky.tn/... Absent only for the admin shell, which is not a page of the site. */
  canonical?: string;
  alternates?: { fr?: string; ar?: string; 'x-default'?: string };
  robots: 'index,follow' | 'noindex,follow' | 'noindex,nofollow';
  og: { type: 'website' | 'product'; image?: string; locale: 'fr_FR' | 'ar_AR' };
  jsonLd?: object[];
};

export type SeoContext = {
  /** Public address of the site (PUBLIC_SITE_URL). */
  siteUrl: string;
  /** Origin that serves '/uploads/...' (PUBLIC_MEDIA_URL). */
  mediaBase?: string;
};
