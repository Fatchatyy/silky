// Each island is its own React tree, so the page language and the route parameters reach it through a provider
// (see lib/island.jsx) instead of the old URL-driven LocaleProvider.
import { createContext, useContext } from 'react';

export const IslandContext = createContext({ locale: 'fr', dir: 'ltr', params: {} });

export const useLocale = () => useContext(IslandContext);
