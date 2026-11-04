export function getStockKey(colorId, size) {
  if (colorId && size) return `${colorId}-${size}`;
  if (colorId) return colorId;
  if (size) return size;
  return 'default';
}

export function getAvailableStock(product, colorId, size) {
  if (!product?.stock) return 0;
  const key = getStockKey(colorId, size);
  return product.stock[key] ?? 0;
}

export function getStockStatus(stock) {
  const qty = Number(stock) || 0;
  if (qty <= 0) return { text: 'Rupture de stock', inStock: false, status: 'out' };
  if (qty <= 3) return { text: `Plus que ${qty} en stock`, inStock: true, status: 'low' };
  return { text: 'En stock', inStock: true, status: 'available' };
}

export function isProductOutOfStock(product) {
  if (!product) return false;

  if (product.stock && typeof product.stock === 'object') {
    const values = Object.values(product.stock);
    if (values.length > 0) {
      return values.every((qty) => Number(qty) <= 0);
    }
  }

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.every((v) => Number(v.stockQuantity ?? v.stock ?? 0) <= 0);
  }

  if (product.stockQuantity !== undefined && product.stockQuantity !== null) {
    return Number(product.stockQuantity) <= 0;
  }

  return false;
}

function slugify(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function buildStockMatrix(product) {
  const { colors = [], sizes = [] } = product || {};

  const seenColorIds = new Set();
  const validColors = [];
  colors.forEach((c) => {
    let name = '';
    let id = '';
    let image = '';
    if (typeof c === 'string') {
      name = c.trim();
      id = slugify(name) || name;
    } else if (c && typeof c === 'object') {
      name = (c.name || '').trim();
      id = c.id || slugify(name) || name;
      image = c.image;
    }
    if (name && id && !seenColorIds.has(id)) {
      seenColorIds.add(id);
      validColors.push({ ...c, id, name, image });
    }
  });

  const validSizes = Array.from(
    new Set(sizes.map((s) => String(s ?? '').trim()).filter(Boolean))
  );

  const keys = [];

  if (validColors.length && validSizes.length) {
    validColors.forEach((color) => {
      validSizes.forEach((size) => {
        keys.push({
          key: getStockKey(color.id, size),
          label: `${color.name} / ${size}`,
        });
      });
    });
  } else if (validColors.length) {
    validColors.forEach((color) => {
      keys.push({
        key: getStockKey(color.id, null),
        label: color.name,
      });
    });
  } else if (validSizes.length) {
    validSizes.forEach((size) => {
      keys.push({
        key: getStockKey(null, size),
        label: `Taille ${size}`,
      });
    });
  } else {
    keys.push({ key: 'default', label: 'Stock général' });
  }

  return keys;
}
