import { AppError } from '../utils/errors.js';

export const MAX_ITEM_QUANTITY = 50;
export const MAX_ORDER_ITEMS = 50;
export const MAX_BULK_ORDER_IDS = 100;

/**
 * Validates that an item quantity is a strictly positive finite integer within configured limits.
 * Rejects 0, negative values, fractional values, NaN, Infinity, and quantities exceeding max.
 *
 * @param {*} rawQty - The quantity value from request payload or service caller
 * @param {number} max - Maximum allowed quantity (defaults to MAX_ITEM_QUANTITY)
 * @returns {number} The validated positive integer quantity
 */
export function validateOrderQuantity(rawQty, max = MAX_ITEM_QUANTITY) {
  // Only a number or a numeric string is a quantity: Number([1]) is 1, so arrays and objects are refused here.
  if (typeof rawQty !== 'number' && typeof rawQty !== 'string') {
    throw new AppError('Quantité invalide pour l\'article', 400);
  }

  if (typeof rawQty === 'string') {
    const trimmed = rawQty.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new AppError('Quantité invalide pour l\'article (doit être un entier positif)', 400);
    }
  }

  const numQty = Number(rawQty);

  if (!Number.isFinite(numQty) || isNaN(numQty) || !Number.isInteger(numQty) || numQty <= 0) {
    throw new AppError('Quantité invalide pour l\'article (doit être un entier positif)', 400);
  }

  if (numQty > max) {
    throw new AppError(`La quantité commandée (${numQty}) dépasse la limite autorisée (${max})`, 400);
  }

  return numQty;
}
