import * as storefrontService from '../services/storefront.service.js';
import { sendError } from '../utils/errors.js';

const handler = (load) => async (req, res) => {
  try {
    res.json(await load(req));
  } catch (err) {
    sendError(res, err);
  }
};

export const home = handler(() => storefrontService.getHome());
export const collection = handler((req) => storefrontService.getCollection(req.params.slug));
export const settings = handler(() => storefrontService.getSettings());
export const sitemapEntries = handler(() => storefrontService.getSitemapEntries());
