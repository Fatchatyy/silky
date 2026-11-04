// Browser side of the page head. Updates the document <title> and the description / robots meta tags in place, so
// tags already in the page (written by the server in Step 2) are replaced rather than duplicated.

export function applyHead({ title, description, robots } = {}) {
  if (title) document.title = title;
  setMeta('description', description);
  setMeta('robots', robots);
}

// Tags only the server writes (they describe the URL that was loaded first): canonical link, Open Graph and Twitter
// tags, and structured data. title, description and robots are updated in place by applyHead instead.
const SERVER_ONLY_TAGS =
  'link[rel="canonical"][data-seo], link[rel="alternate"][data-seo], meta[property^="og:"][data-seo], meta[name^="twitter:"][data-seo], script[type="application/ld+json"][data-seo]';

export function removeServerHeadTags() {
  document.head.querySelectorAll(SERVER_ONLY_TAGS).forEach((tag) => tag.remove());
}

function setMeta(name, content) {
  let tag = document.head.querySelector(`meta[name="${name}"]`);
  if (!content) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    tag.setAttribute('data-seo', '');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}
