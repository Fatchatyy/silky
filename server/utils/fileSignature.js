import path from 'node:path';

// Extensions an uploaded file may keep for each accepted MIME type. The extension decides how the file is served
// back from /uploads, so it never comes from the client unless it matches the declared type.
const ALLOWED_EXTENSIONS = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
  'video/ogg': ['.ogg', '.ogv'],
  'video/quicktime': ['.mov'],
};

/** Extension for a stored upload: the client's one when it fits the declared MIME type, else the type's own. */
export function safeExtension(mimetype, originalName = '') {
  const allowed = ALLOWED_EXTENSIONS[mimetype];
  if (!allowed) return '.jpg';
  const ext = path.extname(originalName);
  return allowed.includes(ext.toLowerCase()) ? ext : allowed[0];
}

const ascii = (buf, start, end) => buf.toString('latin1', start, end);

/** Reads the type of a file from its first bytes. Returns a MIME type, or null when the bytes are not an accepted format. */
export function sniffMime(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const sig6 = ascii(head, 0, 6);
  if (sig6 === 'GIF87a' || sig6 === 'GIF89a') return 'image/gif';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  if (ascii(head, 0, 4) === 'OggS') return 'video/ogg';

  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['mif1', 'miaf', 'msf1'].includes(brand) && ascii(head, 0, head.length).includes('avif')) return 'image/avif';
    return 'video/mp4'; // MP4 and QuickTime share the ISO base-media layout
  }
  return null;
}

/** True when the bytes really are what the upload claims to be. */
export function contentMatchesMime(declared, head) {
  const detected = sniffMime(head);
  if (!detected) return false;
  if (detected === declared) return true;
  return declared === 'video/quicktime' && detected === 'video/mp4';
}
