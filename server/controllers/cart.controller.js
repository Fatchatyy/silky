import * as cartService from '../services/cart.service.js';
import { requireShopper } from '../utils/shopper.js';
import { sendError } from '../utils/errors.js';

export async function getCart(req, res) {
  try {
    const shopper = requireShopper(req);
    const cart = await cartService.getCart(shopper);
    res.json(cart);
  } catch (err) {
    sendError(res, err);
  }
}

export async function addItem(req, res) {
  const { variantId, productId, colorId, size, quantity } = req.body;

  if (!variantId && (!productId || !colorId || !size)) {
    return res.status(400).json({
      error: 'Veuillez sélectionner une couleur et une taille.',
    });
  }

  try {
    const shopper = requireShopper(req);
    const cart = await cartService.addCartItem(shopper, {
      variantId,
      productId,
      colorId,
      size,
      quantity,
    });
    res.status(201).json(cart);
  } catch (err) {
    sendError(res, err);
  }
}

export async function removeItem(req, res) {
  try {
    const shopper = requireShopper(req);
    const cart = await cartService.removeCartItem(shopper, req.params.id);
    res.json(cart);
  } catch (err) {
    sendError(res, err);
  }
}

export async function clearCart(req, res) {
  try {
    const shopper = requireShopper(req);
    const cart = await cartService.getCart(shopper);
    if (cart?.id) {
      await cartService.clearCart(cart.id);
    }
    res.json({ message: 'Panier vidé', items: [], subtotal: 0, total: 0 });
  } catch (err) {
    sendError(res, err);
  }
}
