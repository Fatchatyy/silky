import { useEffect, useRef, useState } from 'react';
import { productPath } from '@shared/urls';
import { useProducts } from '../../context/ProductsContext';
import '../../styles/hero-editor.css';

function formatCategoryLabel(cat) {
  if (!cat) return 'Collection';
  const lower = cat.toLowerCase().trim();
  if (lower === 'femme') return 'Collection Femme';
  if (lower === 'enfant') return 'Collection Enfant';
  return `Collection ${lower.charAt(0).toUpperCase() + lower.slice(1)}`;
}

export default function HeroButtonEditor({ button, onSave, onCancel }) {
  const { products, refreshProducts } = useProducts();
  const [text, setText] = useState(button?.text || '');
  const [textAr, setTextAr] = useState(button?.textAr || '');
  const [destination, setDestination] = useState(button?.destination || '/collection/femme');
  const popoverRef = useRef(null);

  // Refresh products on mount to ensure destination list is fresh
  useEffect(() => {
    if (typeof refreshProducts === 'function') {
      refreshProducts();
    }
  }, [refreshProducts]);

  // Filter only visible & active products
  const activeProducts = (products || []).filter((p) => !p.isHidden && p.is_active !== false);

  // Dynamically compute available collections from product categories
  const categories = Array.from(
    new Set([
      'femme',
      'enfant',
      ...activeProducts.map((p) => p.category?.trim().toLowerCase()).filter(Boolean),
    ])
  );

  const collections = categories.map((cat) => ({
    label: formatCategoryLabel(cat),
    path: `/collection/${cat}`,
  }));

  // Filter only active visible products
  const visibleProducts = activeProducts.map((p) => ({
    label: p.name ? `Produit : ${p.name}` : `Produit #${p.id}`,
    path: productPath(p),
  }));

  useEffect(() => {
    setText(button?.text || '');
    setTextAr(button?.textAr || '');
    setDestination(button?.destination || '/collection/femme');
  }, [button]);

  // Handle outside click to cancel
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onCancel]);

  const handleSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSave({
      ...button,
      text: text.trim() || 'Bouton',
      textAr: textAr.trim(),
      destination: destination || '/collection/femme',
      visible: true,
    });
  };

  const knownPaths = [
    ...collections.map((c) => c.path),
    ...visibleProducts.map((p) => p.path),
  ];
  const isCustomDest = destination && !knownPaths.includes(destination);

  return (
    <div
      ref={popoverRef}
      className="hero_button_popover"
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <label htmlFor="hero_btn_text_input">Texte bouton</label>
        <input
          id="hero_btn_text_input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex: Femme, Découvrir..."
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="hero_btn_text_ar_input">Texte bouton en arabe (facultatif)</label>
        <input
          id="hero_btn_text_ar_input"
          type="text"
          dir="rtl"
          lang="ar"
          value={textAr}
          onChange={(e) => setTextAr(e.target.value)}
          placeholder="مثال: نساء، اكتشفوا"
        />
      </div>

      <div>
        <label htmlFor="hero_btn_dest_select">Fonction bouton (Destination)</label>
        <select
          id="hero_btn_dest_select"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          {isCustomDest && (
            <option value={destination}>
              Destination actuelle ({destination})
            </option>
          )}
          <optgroup label="Collections">
            {collections.map((col) => (
              <option key={col.path} value={col.path}>
                {col.label} ({col.path})
              </option>
            ))}
          </optgroup>
          {visibleProducts.length > 0 && (
            <optgroup label="Produits">
              {visibleProducts.map((prod) => (
                <option key={prod.path} value={prod.path}>
                  {prod.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="hero_button_popover_actions">
        <button
          type="button"
          className="admin-btn secondary sm"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Annuler
        </button>
        <button
          type="button"
          className="admin-btn primary sm"
          onClick={handleSubmit}
        >
          Appliquer
        </button>
      </div>
    </div>
  );
}
