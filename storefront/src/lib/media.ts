// Server-side image URLs for .astro files (the React components use @shared/media with the base set in lib/island.jsx).
import { mediaUrl as toMedia, mediaVariantUrl as toVariant } from '../../shared/media.js';
import { mediaBase } from './config';

export const media = (url: string | null | undefined) => toMedia(url as string, mediaBase()) as string;
export const mediaVariant = (url: string | null | undefined, variant: 'card' | 'share' | 'large') =>
  toVariant(url as string, variant, mediaBase()) as string;
