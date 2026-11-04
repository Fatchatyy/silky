/**
 * shared/media.js (mediaUrl, mediaVariantUrl, setMediaBase): '/uploads/...' gets the media origin, everything else is
 * left alone. Pure: no database, no network.
 *
 * Usage: node server/scripts/test_media_url.js
 */
import assert from 'node:assert/strict';
import { getMediaBase, mediaUrl, mediaVariantUrl, setMediaBase } from '../../shared/media.js';

const BASE = 'http://localhost:3001';
const photo = '/uploads/1786391497273-243dfd2a-r.jpg';
let passed = 0;
function check(label, fn) {
  fn();
  console.log(`✓ PASS: ${label}`);
  passed++;
}

check('an upload path gets the base put in front of it', () => {
  assert.equal(mediaUrl('/uploads/x.jpg', BASE), `${BASE}/uploads/x.jpg`);
});
check('a trailing slash (or spaces) on the base is ignored', () => {
  assert.equal(mediaUrl('/uploads/x.jpg', `${BASE}/`), `${BASE}/uploads/x.jpg`);
  assert.equal(mediaUrl('/uploads/x.jpg', ` ${BASE}// `), `${BASE}/uploads/x.jpg`);
});
check('absolute URLs come back unchanged', () => {
  for (const url of ['https://media.silky.tn/uploads/x.jpg', 'http://a.test/b.png', '//cdn.test/x.png', 'data:image/png;base64,AAAA', 'blob:http://localhost/1']) {
    assert.equal(mediaUrl(url, BASE), url);
  }
});
check('files shipped with the site (/pictures/...) and other paths come back unchanged', () => {
  assert.equal(mediaUrl('/pictures/blushmarron.jpg', BASE), '/pictures/blushmarron.jpg');
  assert.equal(mediaUrl('/logo.svg', BASE), '/logo.svg');
  assert.equal(mediaUrl('uploads/x.jpg', BASE), 'uploads/x.jpg');
  assert.equal(mediaUrl('/uploadsx/x.jpg', BASE), '/uploadsx/x.jpg');
});
check('anything that is not a string comes back as it is', () => {
  assert.equal(mediaUrl(undefined, BASE), undefined);
  assert.equal(mediaUrl(null, BASE), null);
  assert.equal(mediaUrl('', BASE), '');
  assert.deepEqual(mediaUrl({ a: 1 }, BASE), { a: 1 });
});
check('the base set with setMediaBase is the default, and an empty base leaves the path relative', () => {
  assert.equal(getMediaBase(), '');
  assert.equal(mediaUrl(photo), photo);
  setMediaBase('https://media.silky.tn/');
  assert.equal(getMediaBase(), 'https://media.silky.tn');
  assert.equal(mediaUrl(photo), `https://media.silky.tn${photo}`);
  assert.equal(mediaUrl(photo, BASE), `${BASE}${photo}`);
  setMediaBase(undefined);
  assert.equal(getMediaBase(), '');
});
check('mediaVariantUrl picks the resized copy, then the media origin', () => {
  assert.equal(mediaVariantUrl(photo, 'card', BASE), `${BASE}/uploads/1786391497273-243dfd2a-r.card.webp`);
  assert.equal(mediaVariantUrl(photo, 'large', BASE), `${BASE}/uploads/1786391497273-243dfd2a-r.large.webp`);
});
check('a photo without copies (older upload, /pictures, absolute URL) keeps its own file', () => {
  assert.equal(mediaVariantUrl('/uploads/1786391497273-old.jpg', 'card', BASE), `${BASE}/uploads/1786391497273-old.jpg`);
  assert.equal(mediaVariantUrl('/pictures/a.jpg', 'card', BASE), '/pictures/a.jpg');
  assert.equal(mediaVariantUrl('https://x.test/a.jpg', 'share', BASE), 'https://x.test/a.jpg');
});

console.log(`\nResults: ${passed} passed, 0 failed`);
