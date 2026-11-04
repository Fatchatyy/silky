// robots.txt content. Pure: no I/O.
//
// Everyone may read the site, except crawlers whose only purpose is to collect pages to TRAIN AI models. Search
// engines, AI search and assistant crawlers (they can send customers) and link-preview fetchers (WhatsApp, Facebook,
// Instagram previews) stay allowed. Private pages are not blocked here: they carry a noindex tag, which a crawler can
// only read if it is allowed to fetch the page.
//
// Tokens and purposes checked against each provider's own documentation (October 2026):
//   GPTBot               OpenAI model training              developers.openai.com/api/docs/bots
//   ClaudeBot            Anthropic model training           support.claude.com/en/articles/8896518
//   Google-Extended      Gemini training and grounding; not a crawler, a control token; no effect on Google Search
//                        (developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)
//   Applebot-Extended    Apple generative AI training       support.apple.com/en-us/119829
//   meta-externalagent   Meta AI training                   developers.facebook.com/docs/sharing/webmasters/web-crawlers
//   CCBot                Common Crawl, a dataset many models train on (commoncrawl.org/ccbot)
//
// Deliberately NOT blocked: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot,
// Meta-ExternalFetcher, facebookexternalhit, Googlebot, Bingbot.
// Not listed because no first-party documentation of its robots.txt behaviour was found: Bytespider.
// robots.txt is a request, not enforcement: crawlers that ignore it are not stopped.

export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'CCBot'];

export function buildRobotsTxt(siteUrl) {
  return [
    ...AI_TRAINING_BOTS.map((bot) => `User-agent: ${bot}`),
    'Disallow: /',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}
