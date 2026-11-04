// Wraps a page component so it can be mounted as an Astro island: it receives the language and the route
// parameters as props and hands them to the components below it. Other props go to the component unchanged.
import { IslandContext } from '../i18n/LocaleContext';
import { dirOf } from '@shared/locales';
import { setPriceLocale } from '@shared/formatPrice';
import { setMediaBase } from '@shared/media';

// Uploaded photos live on the media origin (the API locally); every component prints them through mediaUrl().
// Runs on the server and in the browser alike (PUBLIC_ variables are built into both).
setMediaBase(import.meta.env.PUBLIC_MEDIA_URL);

export function withIsland(Component) {
  return function Island({ locale = 'fr', params = {}, ...props }) {
    setPriceLocale(locale); // before the children render, so every price shows the right currency label
    return (
      <IslandContext.Provider value={{ locale, dir: dirOf(locale), params }}>
        <Component {...props} />
      </IslandContext.Provider>
    );
  };
}
