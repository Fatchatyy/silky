// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // sharp does not run on Workers: product photos are plain <img> tags using the pre-made WebP copies.
    imageService: 'passthrough',
  }),
  integrations: [react()],
  site: 'https://silky.tn',
  // 'ignore' (not 'never') so /product/x/ reaches src/middleware.ts, which answers one 301 to /product/x; with 'never'
  // Astro answers such an address with a 404 before any code of ours runs.
  trailingSlash: 'ignore',
  build: { format: 'file' },
  // No sessions: the shop keeps its own login (JWT) and cart (API), so no KV namespace is needed.
  session: false,
  i18n: {
    locales: ['fr', 'ar'],
    defaultLocale: 'fr',
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    // The storefront imports the pure modules in ../shared (@shared).
    resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
    server: { fs: { allow: ['..'] } },
  },
});
