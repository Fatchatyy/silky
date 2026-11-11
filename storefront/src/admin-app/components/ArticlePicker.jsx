import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mediaUrl } from '@shared/media';

// Article picker used by the manual order, draft and exchange modals.
// UI only: it reads the admin inventory and hands back a list of
// { variantId, quantity } lines. It never validates, never checks stock and
// never talks to the API; every rule stays in the parent form and the server.

const SYNONYMS = {
  brown: 'marron',
  black: 'noir',
  white: 'blanc',
  pink: 'rose',
  red: 'rouge',
  blue: 'bleu',
  green: 'vert',
  grey: 'gris',
  gray: 'gris',
  yellow: 'jaune',
  noire: 'noir',
};

// Same ceiling as the server (config/orderLimits.js, MAX_ITEM_QUANTITY).
const MAX_ITEM_QUANTITY = 50;

const LETTER_SIZES = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '3xl'];

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function compareSizes(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const ia = LETTER_SIZES.indexOf(norm(a));
  const ib = LETTER_SIZES.indexOf(norm(b));
  if (ia !== -1 && ib !== -1) return ia - ib;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function Thumb({ url, small }) {
  const cls = small ? 'ap-thumb ap-thumb-sm' : 'ap-thumb';
  return url ? (
    <img src={mediaUrl(url)} alt="" className={cls} />
  ) : (
    <span className={`${cls} ap-thumb-empty`} />
  );
}

// A search is a list of words. Every word must match a DIFFERENT part of the article: a word of the name,
// a word of the colour, the size or the SKU. So "set b" finds "Set Blush" (set = name, b = start of Blush)
// and "mira m" cannot use the "m" of Mira twice: m has to be the size or another word.
function matchesQuery(item, tokens) {
  const size = norm(item.size);
  const parts = [
    ...norm(item.productTitle).split(/[^a-z0-9]+/).filter(Boolean).map((text) => ({ kind: 'word', text })),
    ...norm(item.colorName).split(/[^a-z0-9]+/).filter(Boolean).map((text) => ({ kind: 'word', text })),
    { kind: 'size', text: size },
    { kind: 'sku', text: norm(item.sku) },
  ];

  const fits = (token, part, isLast) => {
    if (part.kind === 'size') {
      return part.text === token || (isLast && /^\d+$/.test(token) && part.text.startsWith(token));
    }
    // A short number (38) is a size only; it must not match digits inside a name or a SKU.
    if (/^\d+$/.test(token) && token.length < 3) return false;
    if (part.kind === 'sku') return token.length >= 3 && part.text.includes(token);
    return token.length < 3 ? part.text.startsWith(token) : part.text.includes(token);
  };

  const assign = (i, used) => {
    if (i === tokens.length) return true;
    for (let p = 0; p < parts.length; p += 1) {
      if (used.has(p) || !fits(tokens[i], parts[p], i === tokens.length - 1)) continue;
      used.add(p);
      if (assign(i + 1, used)) return true;
      used.delete(p);
    }
    return false;
  };

  return assign(0, new Set());
}

function LineList({ lines, byId, disabled, onQty, onRemove, maxFor, softStock }) {
  if (!lines.length) return null;
  return (
    <div className="ap-lines">
      {lines.map((line) => {
        const item = byId.get(line.variantId);
        const q = line.quantity;
        const max = maxFor(line.variantId);
        const over = softStock && item && (parseInt(q, 10) || 0) > item.stockQuantity;
        return (
          <div className="ap-line" key={line.variantId}>
            <Thumb url={item?.colorImageUrl} />
            <div className="ap-line-text">
              <strong>{item?.productTitle || 'Article'}</strong>
              <span>
                {item ? `${item.colorName} — Taille ${item.size}` : ''}
                {item ? ` (${item.stockQuantity} dispo.)` : ''}
              </span>
              {over && <span className="ap-warn">Stock insuffisant : {item.stockQuantity} dispo.</span>}
            </div>
            <div className="ap-qty">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onQty(line.variantId, (parseInt(q, 10) || 1) - 1)}
                aria-label="Moins"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                max={max}
                step="1"
                value={q}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value;
                  onQty(line.variantId, v === '' ? '' : parseInt(v, 10), true);
                }}
                onBlur={() => {
                  if (q === '' || Number(q) < 1) onQty(line.variantId, 0);
                }}
                aria-label={`Quantité ${item?.productTitle || ''}`}
              />
              <button
                type="button"
                disabled={disabled || (parseInt(q, 10) || 0) >= max}
                onClick={() => onQty(line.variantId, (parseInt(q, 10) || 0) + 1)}
                aria-label="Plus"
              >
                +
              </button>
            </div>
            {!disabled && (
              <button
                type="button"
                className="ap-del"
                onClick={() => onRemove(line.variantId)}
                aria-label="Retirer cet article"
                title="Retirer cet article"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ArticlePicker({
  inventory,
  lines,
  onChange,
  disabled = false,
  // 'hard': a quantity can never exceed the stock (new order, exchange: the server refuses it anyway).
  // 'soft': only warns (draft: the server checks stock when the draft is confirmed, not when it is saved).
  stockMode = 'hard',
  buttonLabel = '+ Ajouter des articles',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [undo, setUndo] = useState(null); // { message, snapshot }
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef(null);
  const searchRef = useRef(null);
  const undoTimer = useRef(null);

  const byId = useMemo(() => new Map(inventory.map((i) => [i.variantId, i])), [inventory]);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.variantId, l])), [lines]);

  const categories = useMemo(() => {
    const map = new Map();
    inventory.forEach((i) => {
      const name = i.categoryName || '';
      if (!name) return;
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(i.productId);
    });
    return [...map.entries()].map(([name, set]) => ({ name, count: set.size }));
  }, [inventory]);

  const totalProducts = useMemo(() => new Set(inventory.map((i) => i.productId)).size, [inventory]);

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(
    () => () => {
      clearTimeout(undoTimer.current);
      clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = (message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3500);
  };

  const softStock = stockMode === 'soft';
  const maxFor = (variantId) => {
    const item = byId.get(variantId);
    if (softStock || !item) return MAX_ITEM_QUANTITY;
    return Math.max(0, Math.min(MAX_ITEM_QUANTITY, Number(item.stockQuantity) || 0));
  };

  const tokens = useMemo(() => {
    const raw = query.trim() ? norm(query).split(/\s+/).filter(Boolean) : [];
    return raw.map((t) => SYNONYMS[t] || t);
  }, [query]);
  const searching = tokens.length > 0;

  const { groups, outsideCategory } = useMemo(() => {
    const productMap = new Map();
    let outside = new Set();
    inventory.forEach((item) => {
      const inCategory = !category || item.categoryName === category;
      if (!searching && !inCategory) return;
      if (searching && !matchesQuery(item, tokens)) return;
      if (searching && !inCategory) outside.add(item.productId);
      if (!productMap.has(item.productId)) {
        productMap.set(item.productId, {
          productId: item.productId,
          title: item.productTitle,
          category: item.categoryName || '',
          hidden: item.productIsHidden,
          colors: new Map(),
        });
      }
      const p = productMap.get(item.productId);
      const ck = item.colorSlug || item.colorName;
      if (!p.colors.has(ck)) {
        p.colors.set(ck, { name: item.colorName, image: item.colorImageUrl, sizes: [] });
      }
      p.colors.get(ck).sizes.push(item);
    });
    const list = [...productMap.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({
        ...p,
        colors: [...p.colors.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ ...c, sizes: c.sizes.sort((a, b) => compareSizes(a.size, b.size)) })),
      }));
    return { groups: list, outsideCategory: outside.size };
  }, [inventory, category, searching, tokens]);

  const sizeTokens = tokens.filter((t) => /^\d+$/.test(t));

  const showUndo = (message, snapshot) => {
    setUndo({ message, snapshot });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  };

  const addVariant = (variantId) => {
    const existing = lineById.get(variantId);
    const item = byId.get(variantId);
    const max = maxFor(variantId);
    if (max <= 0) {
      showNotice(`${item?.productTitle || 'Article'} : rupture de stock.`);
      return;
    }
    if (existing && (parseInt(existing.quantity, 10) || 0) >= max) {
      showNotice(
        max >= MAX_ITEM_QUANTITY
          ? `Quantité maximale par article : ${MAX_ITEM_QUANTITY}.`
          : `Stock maximum atteint : ${item?.stockQuantity} dispo.`,
      );
      return;
    }
    if (existing) {
      onChange(
        lines.map((l) =>
          l.variantId === variantId ? { ...l, quantity: (parseInt(l.quantity, 10) || 0) + 1 } : l,
        ),
      );
    } else {
      onChange([...lines, { variantId, quantity: 1 }]);
    }
  };

  const label = (variantId) => {
    const i = byId.get(variantId);
    return i ? `${i.productTitle} · ${i.colorName} · ${i.size}` : 'Article';
  };

  const removeVariant = (variantId) => {
    showUndo(`${label(variantId)} retiré.`, lines);
    onChange(lines.filter((l) => l.variantId !== variantId));
  };

  const setQty = (variantId, quantity, typing) => {
    if (typing) {
      const max = maxFor(variantId);
      const typed = quantity === '' ? '' : Math.min(quantity, max);
      if (quantity !== '' && quantity > max) showNotice(`Stock maximum atteint : ${byId.get(variantId)?.stockQuantity} dispo.`);
      onChange(lines.map((l) => (l.variantId === variantId ? { ...l, quantity: typed } : l)));
      return;
    }
    if (!quantity || quantity < 1) {
      removeVariant(variantId);
      return;
    }
    const max = maxFor(variantId);
    if (quantity > max) {
      showNotice(
        max >= MAX_ITEM_QUANTITY
          ? `Quantité maximale par article : ${MAX_ITEM_QUANTITY}.`
          : `Stock maximum atteint : ${byId.get(variantId)?.stockQuantity} dispo.`,
      );
    }
    onChange(lines.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(quantity, max) } : l)));
  };

  const clearAll = () => {
    showUndo('Tous les articles retirés.', lines);
    onChange([]);
    setConfirmAll(false);
  };

  const doUndo = () => {
    if (undo) onChange(undo.snapshot);
    setUndo(null);
    clearTimeout(undoTimer.current);
  };

  const unitCount = lines.reduce((n, l) => n + (parseInt(l.quantity, 10) || 0), 0);

  const noticeBar = notice && (
    <div className="ap-notice" role="status">
      {notice}
    </div>
  );

  const undoBar = undo && (
    <div className="ap-undo" role="status">
      <span>{undo.message}</span>
      <button type="button" onClick={doUndo}>
        Annuler
      </button>
    </div>
  );

  const tray = (
    <div className="ap-tray">
      <div className="ap-tray-head">
        <strong>
          Articles ajoutés{unitCount ? <span className="ap-muted"> ({unitCount})</span> : null}
        </strong>
        {lines.length > 0 && !disabled && (
          <button type="button" className="ap-link-danger" onClick={() => setConfirmAll(true)}>
            Tout vider
          </button>
        )}
      </div>
      {confirmAll && (
        <div className="ap-confirm">
          Retirer tous les articles ?
          <div>
            <button type="button" className="admin-btn danger" onClick={clearAll}>
              Oui, vider
            </button>
            <button type="button" className="admin-btn secondary" onClick={() => setConfirmAll(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <p className="ap-muted ap-tray-empty">Aucun article. Cliquez sur une taille.</p>
      ) : (
        <LineList lines={lines} byId={byId} disabled={disabled} onQty={setQty} onRemove={removeVariant} maxFor={maxFor} softStock={softStock} />
      )}
    </div>
  );

  const hint = searching
    ? `${groups.length} article(s) trouvé(s) dans toutes les catégories${
        category && outsideCategory ? ` dont ${outsideCategory} hors ${category}` : ''
      }`
    : category
      ? `Catégorie : ${category}. Tapez pour chercher partout.`
      : 'Toutes les catégories';

  return (
    <div className="ap-root">
      {lines.length > 0 && (
        <LineList lines={lines} byId={byId} disabled={disabled} onQty={setQty} onRemove={removeVariant} maxFor={maxFor} softStock={softStock} />
      )}
      {!open && noticeBar}
      {!open && undoBar}
      {!disabled && (
        <button type="button" className="admin-btn secondary ap-open" onClick={() => setOpen(true)}>
          {buttonLabel}
        </button>
      )}

      {open &&
        createPortal(
          <div className="ap-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div className="ap-modal" role="dialog" aria-modal="true" aria-label="Choisir des articles">
              <div className="ap-modal-head">
                <h3>Choisir des articles</h3>
                <button type="button" className="admin-modal-close" onClick={() => setOpen(false)} aria-label="Fermer">
                  ×
                </button>
              </div>
              <div className="ap-modal-body">
                <div className="ap-main">
                  <div className="ap-search">
                    <input
                      ref={searchRef}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                      placeholder="Nom, couleur, taille : ex. mi 38 brown"
                      aria-label="Rechercher un article"
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                        ×
                      </button>
                    )}
                  </div>
                  <div className="ap-chips">
                    <button
                      type="button"
                      className={`ap-chip ${category === '' ? 'on' : ''}`}
                      onClick={() => setCategory('')}
                    >
                      Tout <small>{totalProducts}</small>
                    </button>
                    {categories.map((c) => (
                      <button
                        type="button"
                        key={c.name}
                        className={`ap-chip ${category === c.name ? 'on' : ''}`}
                        onClick={() => setCategory(c.name)}
                      >
                        {c.name} <small>{c.count}</small>
                      </button>
                    ))}
                  </div>
                  <p className="ap-hint">{hint}</p>

                  <div className="ap-results">
                    {groups.length === 0 ? (
                      <p className="ap-empty">
                        Aucun article trouvé{query ? ` pour "${query}"` : ''}. Essayez moins de mots.
                      </p>
                    ) : (
                      groups.map((p) => (
                        <div className="ap-product" key={p.productId}>
                          <div className="ap-product-head">
                            <strong>{p.title}</strong>
                            {p.category && (
                              <span
                                className={`ap-tag ${searching && category && p.category !== category ? 'far' : ''}`}
                              >
                                {p.category}
                              </span>
                            )}
                            {p.hidden && <span className="ap-tag">Masqué</span>}
                          </div>
                          {p.colors.map((c) => (
                            <div className="ap-color-row" key={c.name}>
                              <Thumb url={c.image} small />
                              <span className="ap-color-name">{c.name}</span>
                              <div className="ap-sizes">
                                {c.sizes.map((it) => {
                                  const sel = lineById.get(it.variantId);
                                  const out = it.stockQuantity <= 0;
                                  const hit = sizeTokens.includes(norm(it.size));
                                  return (
                                    <button
                                      type="button"
                                      key={it.variantId}
                                      className={`ap-size ${sel ? 'sel' : ''} ${out ? 'out' : ''} ${hit ? 'hit' : ''} ${
                                        !out && it.stockQuantity <= 5 ? 'low' : ''
                                      }`}
                                      disabled={out && !softStock}
                                      onClick={() => addVariant(it.variantId)}
                                      title={`${it.stockQuantity} dispo.`}
                                    >
                                      {it.size}
                                      {sel ? <em> ×{sel.quantity}</em> : <sup>{it.stockQuantity}</sup>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <aside className="ap-side">
                  {tray}
                  {noticeBar}
                  {undoBar}
                </aside>
              </div>
              <div className="ap-modal-foot">
                <button type="button" className="admin-btn" onClick={() => setOpen(false)}>
                  Terminer{lines.length ? ` (${unitCount})` : ''}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
