import * as favouriteService from '../services/favourite.service.js';
import { requireShopper } from '../utils/shopper.js';
import { sendError } from '../utils/errors.js';

export async function list(req, res) {
  try {
    const shopper = requireShopper(req);
    const favourites = await favouriteService.getFavourites(shopper);
    res.json(favourites);
  } catch (err) {
    sendError(res, err);
  }
}

export async function toggle(req, res) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'Les administrateurs ne peuvent pas ajouter de produits aux favoris.' });
  }

  const { productId, variantId, favoriteId } = req.body || {};
  if (!productId && !variantId && !favoriteId) {
    return res.status(400).json({ error: 'Identifiant du produit requis.' });
  }

  try {
    const shopper = requireShopper(req);
    const result = await favouriteService.toggleFavourite(shopper, req.body);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}
