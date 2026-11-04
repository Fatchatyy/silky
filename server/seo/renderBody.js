// Plain text of a page, written by the server inside <div id="root"> so crawlers that do not run JavaScript (many AI
// crawlers, link fetchers) can read it. React's createRoot replaces it as soon as the page loads, so shoppers see the
// normal page. Only text the page itself shows: the shared text of shared/textPages.js, or a product's own
// name, price and description. Pure: no I/O.
import { escapeHtml } from '../../src/seo/escape.js';
import { cleanText } from '../../src/seo/meta.js';
import { localizedPath } from '../../shared/urls.js';
import { TEXT_PAGE_BY_PATH, getTextPage } from '../../shared/textPages.js';
import { productDescription, productName } from '../../shared/productText.js';
import { formatPrice } from '../../shared/formatPrice.js';
import { getEffectivePrice } from '../../shared/price.js';
import { localizedCollectionMeta } from '../../src/seo/collections.js';
import { translate } from '../../shared/messages.js';
import { categoryPath, productPath } from '../../shared/urls.js';

const ROOT_MARKER = '<div id="root"></div>';

function richHtml(parts, locale) {
  return parts
    .map((part) => {
      if (typeof part === 'string') return escapeHtml(part);
      if (part.mail) return `<a href="mailto:${escapeHtml(part.mail)}">${escapeHtml(part.text)}</a>`;
      return `<a href="${escapeHtml(localizedPath(part.to, locale))}">${escapeHtml(part.text)}</a>`;
    })
    .join('');
}

const paragraphs = (list, locale) => list.map((parts) => `<p>${richHtml(parts, locale)}</p>`).join('');
const wrap = (inner) => `<main data-seo-fallback><section>${inner}</section></main>`;

/** Body of a text page (faq, delivery, service, about, contact), or null for any other route. */
export function renderTextPageBody(routePath, locale = 'fr') {
  const id = TEXT_PAGE_BY_PATH[routePath];
  if (!id) return null;
  const page = getTextPage(id, locale);
  const title = `<h1>${escapeHtml(page.title)}</h1>`;

  switch (id) {
    case 'faq':
      return wrap(
        title +
          page.items.map((item) => `<h2>${escapeHtml(item.question)}</h2>${paragraphs(item.answer, locale)}`).join('') +
          paragraphs(page.outro, locale),
      );
    case 'delivery':
      return wrap(
        title +
          page.sections
            .map((section) => `<h2 id="${escapeHtml(section.id)}">${escapeHtml(section.heading)}</h2>${paragraphs(section.paragraphs, locale)}`)
            .join(''),
      );
    case 'contact':
      return wrap(title + paragraphs(page.intro, locale));
    default:
      return wrap(title + paragraphs(page.paragraphs, locale));
  }
}

/** Body of a published product page: its name, price in TND and description. */
export function renderProductBody(product, locale = 'fr') {
  if (!product || product.isHidden || product.is_active === false) return null;
  const description = cleanText(productDescription(product, locale));
  const price = getEffectivePrice(product);
  return wrap(
    `<h1>${escapeHtml(cleanText(productName(product, locale)))}</h1>` +
      (price > 0 ? `<p>${escapeHtml(formatPrice(price, locale))}</p>` : '') +
      (description ? `<p>${escapeHtml(description)}</p>` : ''),
  );
}

const productList = (summaries, locale) =>
  summaries.length
    ? `<ul>${summaries
        .map(
          (item) =>
            `<li><a href="${escapeHtml(localizedPath(productPath(item), locale))}">${escapeHtml(cleanText(productName(item, locale)))}</a> - ${escapeHtml(formatPrice(getEffectivePrice(item), locale))}</li>`,
        )
        .join('')}</ul>`
    : '';

/** Home page: the shop name, its tagline and, per collection, the name, price and link of its newest products. */
export function renderHomeBody(summaries = [], locale = 'fr', perCollection = 12) {
  const sections = ['femme', 'enfant']
    .map((slug) => {
      const items = summaries.filter((item) => item.category === slug).slice(0, perCollection);
      if (!items.length) return '';
      const link = `<a href="${escapeHtml(localizedPath(categoryPath(slug), locale))}">${escapeHtml(localizedCollectionMeta(slug, locale).title)}</a>`;
      return `<h2>${link}</h2>${productList(items, locale)}`;
    })
    .join('');
  return wrap(`<h1>Silky</h1><p>${escapeHtml(translate(locale, 'footer.tagline'))}</p>${sections}`);
}

/** Collection page: its title, intro text and every published product of the collection (name, price, link). */
export function renderCollectionBody(slug, summaries = [], locale = 'fr') {
  const display = localizedCollectionMeta(slug, locale);
  return wrap(`<h1>${escapeHtml(display.title)}</h1><p>${escapeHtml(display.heroText)}</p>${productList(summaries, locale)}`);
}

/** Puts the body inside the empty root of the built index.html. Unchanged when there is no body or no root. */
export function injectRootContent(template, bodyHtml) {
  if (!bodyHtml || !template.includes(ROOT_MARKER)) return template;
  return template.replace(ROOT_MARKER, () => `<div id="root">${bodyHtml}</div>`);
}
