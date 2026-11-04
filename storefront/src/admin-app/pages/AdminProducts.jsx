import { useEffect, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { adminApi as api } from '../../admin/adminApi';
import { useProducts } from '../context/ProductsContext';
import { buildStockMatrix } from '@shared/stock';
import { formatPrice } from '@shared/formatPrice';
import { getEffectivePrice, hasDiscount } from '@shared/price';
import AdminProductReviewsSection from '../../admin/AdminProductReviewsSection';
import { colorIdOnRename, mapProductColorsToForm, normalizeProduct, uploadFile } from '../../admin/productForm';

const EMPTY_PRODUCT = {
  name: '',
  description: '',
  nameAr: '',
  descriptionAr: '',
  imageAlt: '',
  imageAltAr: '',
  price: 0,
  discount: 0,
  category: 'femme',
  mainImage: '',
  colors: [{ id: '', name: '', thumbnail: '', gallery: [] }],
  sizes: [''],
  stock: {},
  videos: [],
  collectionImage: '',
  isHidden: false,
};

function getPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [1];
  if (currentPage > 3) {
    pages.push('...');
  }
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (currentPage < totalPages - 2) {
    pages.push('...');
  }
  pages.push(totalPages);
  return pages;
}

export default function AdminProducts({ highlightProductId = null, highlightReviewId = null }) {
  const {
    products,
    addProduct,
    updateProduct,
    deleteProduct,
    uploadProductVideo,
    deleteProductVideo,
  } = useProducts();
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reviewsProductId, setReviewsProductId] = useState(null);
  const [videoToDelete, setVideoToDelete] = useState(null);
  const [videoUploading, setVideoUploading] = useState(false);

  const selectProduct = (product) => {
    if (!product) return;
    const latestProduct = products.find((p) => p.id === product.id) || product;
    setSelectedId(latestProduct.id);
    setIsNew(false);
    setForm({
      ...latestProduct,
      colors: mapProductColorsToForm(latestProduct.colors),
      sizes: [...(latestProduct.sizes || [])],
      stock: { ...(latestProduct.stock || {}) },
      videos: Array.isArray(latestProduct.videos) ? [...latestProduct.videos] : [],
      isHidden: latestProduct.isHidden === true || latestProduct.is_active === false,
    });
    setMessage('');
    setModalOpen(true);
  };

  useEffect(() => {
    if (highlightProductId && products.length > 0) {
      const match = products.find((p) => p.id === highlightProductId);
      if (match) {
        if (highlightReviewId) {
          setReviewsProductId(match.id);
        } else {
          selectProduct(match);
        }
      }
    }
  }, [highlightProductId, products]);

  useEffect(() => {
    if (products.length === 0) return;

    if (!isNew) {
      const target = selectedId
        ? products.find((p) => p.id === selectedId) || products[0]
        : products[0];

      if (target) {
        if (selectedId !== target.id) {
          setSelectedId(target.id);
        }

        setForm((prevForm) => {
          if (!prevForm || prevForm.id !== target.id) {
            return {
              ...target,
              colors: mapProductColorsToForm(target.colors),
              sizes: [...(target.sizes || [])],
              stock: { ...(target.stock || {}) },
              videos: Array.isArray(target.videos) ? [...target.videos] : [],
              isHidden: target.isHidden === true || target.is_active === false,
            };
          }

          return {
            ...prevForm,
            stock: { ...(target.stock || {}) },
            videos: Array.isArray(target.videos) ? [...target.videos] : prevForm.videos || [],
          };
        });
      }
    }
  }, [products, selectedId, isNew]);

  const startNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm({
      ...EMPTY_PRODUCT,
      colors: [{ id: '', name: '', thumbnail: '', gallery: [] }],
      sizes: [''],
      stock: {},
      videos: [],
      isHidden: false,
    });
    setMessage('');
    setModalOpen(true);
  };

  const updateField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateListItem = (field, index, value) => {
    setForm((f) => {
      const list = [...f[field]];
      let val = value;
      if (field === 'sizes') {
        val = val.replace(/\D/g, '').slice(0, 2);
      }
      list[index] = val;
      return { ...f, [field]: list };
    });
  };

  const addListItem = (field, template) => {
    setForm((f) => ({ ...f, [field]: [...f[field], template] }));
  };

  const removeListItem = (field, index) => {
    setForm((f) => ({ ...f, [field]: f[field].filter((_, i) => i !== index) }));
  };

  const updateColor = (index, key, value) => {
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== index) return c;
        let val = value;
        if (key === 'name') {
          val = val.slice(0, 20);
        }
        const updated = { ...c, [key]: val };
        if (key === 'name') {
          updated.id = colorIdOnRename(c, val, index);
        }
        return updated;
      });
      return { ...f, colors };
    });
  };

  const handleUploadThumbnail = async (colorIdx, file) => {
    if (!file) return;
    const url = await uploadFile(file, setMessage);
    if (!url) return;

    setMessage('');
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        return { ...c, thumbnail: url };
      });
      const mainImage = f.mainImage || url;
      return { ...f, colors, mainImage };
    });
  };

  const handleReplaceThumbnail = async (colorIdx, file) => {
    if (!file) return;
    const oldThumb = form.colors[colorIdx]?.thumbnail;
    const url = await uploadFile(file, setMessage);
    if (!url) return;

    setMessage('');
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        return { ...c, thumbnail: url };
      });
      let mainImage = f.mainImage;
      if (mainImage === oldThumb || !mainImage) {
        mainImage = url;
      }
      let collectionImage = f.collectionImage;
      if (collectionImage === oldThumb) {
        collectionImage = url;
      }
      return { ...f, colors, mainImage, collectionImage };
    });
  };

  const handleAddGalleryImage = async (colorIdx, file) => {
    if (!file) return;
    const url = await uploadFile(file, setMessage);
    if (!url) return;

    setMessage('');
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        const gallery = [...(c.gallery || []), url];
        return { ...c, gallery };
      });
      return { ...f, colors };
    });
  };

  const handleReplaceGalleryImage = async (colorIdx, galleryIdx, file) => {
    if (!file) return;
    const oldUrl = form.colors[colorIdx]?.gallery?.[galleryIdx];
    const url = await uploadFile(file, setMessage);
    if (!url) return;

    setMessage('');
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        const gallery = [...(c.gallery || [])];
        gallery[galleryIdx] = url;
        return { ...c, gallery };
      });
      let mainImage = f.mainImage;
      if (mainImage === oldUrl) {
        mainImage = url;
      }
      let collectionImage = f.collectionImage;
      if (collectionImage === oldUrl) {
        collectionImage = url;
      }
      return { ...f, colors, mainImage, collectionImage };
    });
  };

  const handleRemoveGalleryImage = (colorIdx, galleryIdx) => {
    const oldUrl = form.colors[colorIdx]?.gallery?.[galleryIdx];
    setForm((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        const gallery = (c.gallery || []).filter((_, idx) => idx !== galleryIdx);
        return { ...c, gallery };
      });

      let mainImage = f.mainImage;
      if (mainImage === oldUrl) {
        const remainingImages = colors.flatMap((c) => [c.thumbnail, ...(c.gallery || [])]).filter(Boolean);
        mainImage = remainingImages[0] || f.collectionImage || '';
      }
      return { ...f, colors, mainImage };
    });
  };

  const handleRemoveColor = (colorIdx) => {
    const removedColor = form.colors[colorIdx];
    const removedImages = [removedColor?.thumbnail, ...(removedColor?.gallery || [])].filter(Boolean);

    setForm((f) => {
      const colors = f.colors.filter((_, i) => i !== colorIdx);
      let mainImage = f.mainImage;
      if (removedImages.includes(mainImage)) {
        const remainingImages = colors.flatMap((c) => [c.thumbnail, ...(c.gallery || [])]).filter(Boolean);
        mainImage = remainingImages[0] || f.collectionImage || '';
      }
      return { ...f, colors, mainImage };
    });
  };

  const handleUploadCollectionImage = async (file) => {
    if (!file) return;
    const url = await uploadFile(file, setMessage);
    if (!url) return;

    setMessage('');
    updateField('collectionImage', url);
  };

  const handleUploadVideo = async (file) => {
    if (!file) return;
    if (isNew || !selectedId) {
      setMessage('Veuillez d\'abord enregistrer le produit avant d\'ajouter des vidéos.');
      return;
    }
    setVideoUploading(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await uploadProductVideo(selectedId, formData);
      if (res?.product?.videos) {
        setForm((prev) => (prev ? { ...prev, videos: res.product.videos } : prev));
      }
      setMessage('Vidéo ajoutée avec succès.');
    } catch (err) {
      setMessage(err.message || 'Erreur lors du téléversement de la vidéo.');
    } finally {
      setVideoUploading(false);
    }
  };

  const handleConfirmDeleteVideo = async () => {
    if (!videoToDelete || !selectedId) return;
    try {
      await deleteProductVideo(selectedId, videoToDelete.id);
      setForm((prev) =>
        prev
          ? { ...prev, videos: (prev.videos || []).filter((v) => v.id !== videoToDelete.id) }
          : prev,
      );
      setVideoToDelete(null);
      setMessage('Vidéo supprimée.');
    } catch (err) {
      setMessage(err.message || 'Erreur lors de la suppression de la vidéo.');
    }
  };

  const updateStock = (key, value) => {
    setForm((f) => ({ ...f, stock: { ...f.stock, [key]: value } }));
  };

  const handleSave = async () => {
    if (!form?.name?.trim()) {
      setMessage('Le nom du produit est requis.');
      return;
    }
    if (!form?.category?.trim()) {
      setMessage('Veuillez sélectionner une catégorie.');
      return;
    }
    if (!form?.description?.trim()) {
      setMessage('La description est requise.');
      return;
    }
    const priceNum = Number(form?.price);
    if (form?.price === '' || form?.price === null || form?.price === undefined || isNaN(priceNum) || priceNum <= 0) {
      setMessage('Le prix est requis et doit être supérieur à 0.');
      return;
    }
    const discountNum = Number(form?.discount ?? 0);
    if (isNaN(discountNum) || discountNum < 0) {
      setMessage('La remise doit être positive.');
      return;
    }
    if (discountNum > priceNum) {
      setMessage('La remise ne peut pas être supérieure au prix.');
      return;
    }
    if (!form?.collectionImage?.trim()) {
      setMessage('Veuillez ajouter une image de collection.');
      return;
    }
    const validSizes = (form?.sizes || []).map((s) => s.trim()).filter(Boolean);
    if (validSizes.length === 0) {
      setMessage('Veuillez ajouter au moins une taille.');
      return;
    }
    const rawColors = form?.colors || [];
    for (let i = 0; i < rawColors.length; i++) {
      const c = rawColors[i];
      if (!c.name?.trim()) {
        setMessage(`Le nom de la couleur ${i + 1} est requis.`);
        return;
      }
      const thumb = (c.thumbnail || c.images?.[0] || c.image || '').trim();
      if (!thumb) {
        setMessage(`Veuillez ajouter une miniature pour la couleur "${c.name.trim()}".`);
        return;
      }
    }

    setSaving(true);
    setMessage('');

    try {
      const normalized = normalizeProduct(form);

      if (isNew) {
        const id = Date.now().toString();
        const created = await addProduct({ ...normalized, id });
        const finalObj = created || { ...normalized, id };
        setSelectedId(finalObj.id);
        setIsNew(false);
        setForm({
          ...finalObj,
          colors: mapProductColorsToForm(finalObj.colors),
        });
        setMessage('Produit ajouté avec succès.');
        setModalOpen(false);
      } else {
        const saved = await updateProduct(selectedId, normalized);
        const finalObj = saved || { ...form, ...normalized };
        setForm({
          ...form,
          ...finalObj,
          colors: mapProductColorsToForm(finalObj.colors),
        });
        setMessage('Produit mis à jour avec succès.');
        setModalOpen(false);
      }
    } catch (err) {
      setMessage(err.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;

    setSaving(true);
    try {
      await deleteProduct(targetId);
      if (selectedId === targetId) setModalOpen(false);
      if (reviewsProductId === targetId) setReviewsProductId(null);
      setDeleteTarget(null);
      setMessage('Produit supprimé.');
    } catch (err) {
      setMessage(err.message || 'Erreur lors de la suppression.');
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setMessage('');
  };

  const stockMatrix = form ? buildStockMatrix(form) : [];

  const trimmed = searchQuery.trim().toLowerCase();
  const filteredProducts = trimmed
    ? products.filter(
        (p) =>
          p.name?.toLowerCase().includes(trimmed) ||
          p.category?.toLowerCase().includes(trimmed) ||
          p.description?.toLowerCase().includes(trimmed) ||
          p.colors?.some((c) => c.name?.toLowerCase().includes(trimmed)),
      )
    : products;

  const totalProducts = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalProducts);
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
  const reviewsProduct = reviewsProductId ? products.find((p) => p.id === reviewsProductId) : null;

  const toggleReviews = (productId) => {
    setReviewsProductId((current) => (current === productId ? null : productId));
  };

  useEffect(() => {
    if (reviewsProductId) {
      document.getElementById('admin-products-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [reviewsProductId]);

  return (
    <section className="admin-panel admin-orders-panel admin-products-table-panel">
      <div className="admin-panel-header admin-orders-header">
        <div className="admin-panel-title-area">
          <h2>Produits</h2>
          <span className="admin-draft-count-badge">
            {totalProducts} produit{totalProducts !== 1 ? 's' : ''}
            {trimmed && products.length !== totalProducts ? ` sur ${products.length}` : ''}
          </span>
        </div>

        <div className="admin-panel-actions">
          <button type="button" className="admin-primary-btn" onClick={startNew}>
            <img src="/pictures/addorder.png" alt="" className="admin-btn-icon" />
            <span>Créer un produit</span>
          </button>
        </div>
      </div>

      <div className="admin-orders-controls-bar">
        <div className="admin-orders-search-wrapper">
          <input
            type="text"
            className="admin-orders-search-input"
            placeholder="Rechercher par nom, couleur, catégorie…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            autoComplete="off"
            aria-label="Rechercher dans le catalogue"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              title="Effacer la recherche"
              aria-label="Effacer la recherche"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {message && !modalOpen && <p className="admin-message">{message}</p>}

      {filteredProducts.length === 0 ? (
        <p className="admin-empty">
          Aucun produit trouvé{searchQuery ? ` pour « ${searchQuery} »` : ''}.
        </p>
      ) : (
        <>
          <div className="admin-orders-table-wrap">
            <table className="admin-orders-table admin-products-table">
              <thead>
                <tr>
                  <th className="admin-table-th">Image</th>
                  <th className="admin-table-th">Produit</th>
                  <th className="admin-table-th">Catégorie</th>
                  <th className="admin-table-th">Prix</th>
                  <th className="admin-table-th">Stock</th>
                  <th className="admin-table-th">Statut</th>
                  <th className="admin-table-th col-actions" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map((product) => {
                  const totalStock = Object.values(product.stock || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
                  const reviewsOpen = reviewsProductId === product.id;

                  return (
                    <tr
                      key={product.id}
                      id={`product-${product.id}`}
                      className={`admin-order-row${product.isHidden ? ' product-hidden' : ''}`}
                    >
                      <td className="admin-table-td">
                        <img
                          className="admin-products-table-thumb"
                          src={mediaUrl(product.collectionImage || product.mainImage)}
                          alt=""
                        />
                      </td>
                      <td className="admin-table-td">
                        <strong>{product.name}</strong>
                      </td>
                      <td className="admin-table-td" style={{ textTransform: 'capitalize' }}>
                        {product.category}
                      </td>
                      <td className="admin-table-td">
                        {hasDiscount(product) ? (
                          <>
                            <strong>{formatPrice(getEffectivePrice(product))}</strong>{' '}
                            <s style={{ color: '#94a3b8' }}>{formatPrice(product.price)}</s>
                          </>
                        ) : (
                          <strong>{formatPrice(product.price)}</strong>
                        )}
                      </td>
                      <td className="admin-table-td">{totalStock}</td>
                      <td className="admin-table-td">
                        {product.isHidden ? (
                          <span className="admin-badge admin-badge--warning">Masqué</span>
                        ) : (
                          <span className="admin-badge admin-badge--ok">Visible</span>
                        )}
                      </td>
                      <td className="admin-table-td col-actions">
                        <div className="admin-table-actions-cell">
                          <button
                            type="button"
                            className={`admin-secondary-btn sm${reviewsOpen ? ' active' : ''}`}
                            onClick={() => toggleReviews(product.id)}
                            aria-expanded={reviewsOpen}
                            title="Afficher les avis de ce produit"
                            style={{ padding: '4px 10px', height: '32px', display: 'inline-flex', alignItems: 'center' }}
                          >
                            Avis
                          </button>
                          <button
                            type="button"
                            className="admin-secondary-btn sm"
                            onClick={() => selectProduct(product)}
                            title="Modifier le produit"
                            style={{ padding: '4px 10px', height: '32px', display: 'inline-flex', alignItems: 'center' }}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            className="admin-icon-action-btn admin-btn-cancel"
                            onClick={() => setDeleteTarget(product)}
                            aria-label="Supprimer le produit"
                            title="Supprimer"
                          >
                            <img alt="" className="admin-btn-icon" src="/pictures/cancel.png" />
                            <span className="admin-tooltip">Supprimer</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="admin-orders-pagination-bar">
            <div className="admin-pagination-summary">
              Affichage de {totalProducts === 0 ? 0 : startIndex + 1}–{endIndex} sur {totalProducts} produits
            </div>

            <div className="admin-pagination-right">
              <div className="admin-pagination-page-size">
                <select
                  id="admin-products-page-size-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="admin-page-size-select"
                  aria-label="Sélectionner le nombre de produits par page"
                >
                  <option value={20}>20 par page</option>
                  <option value={50}>50 par page</option>
                  <option value={100}>100 par page</option>
                </select>
              </div>

              <div className="admin-pagination-nav">
                <button
                  type="button"
                  className="admin-pagination-btn"
                  disabled={activePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  aria-label="Page précédente"
                >
                  Précédent
                </button>

                {getPageNumbers(activePage, totalPages).map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="admin-pagination-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className={`admin-pagination-btn ${p === activePage ? 'active' : ''}`}
                      onClick={() => setCurrentPage(p)}
                      aria-label={`Page ${p}`}
                    >
                      {p}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  className="admin-pagination-btn"
                  disabled={activePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Page suivante"
                >
                  Suivant
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {reviewsProduct && (
        <div className="admin-products-reviews-panel" id="admin-products-reviews">
          <div className="admin-products-reviews-header">
            <h3>Avis clients — {reviewsProduct.name}</h3>
            <button
              type="button"
              className="admin-secondary-btn sm"
              onClick={() => setReviewsProductId(null)}
            >
              Fermer
            </button>
          </div>
          <AdminProductReviewsSection productId={reviewsProduct.id} highlightReviewId={highlightReviewId} />
        </div>
      )}

      {modalOpen && form && (
        <div className="admin-modal-overlay" role="presentation">
          <div
            className="admin-modal admin-product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
          >
            <div className="admin-modal-header">
              <h2 id="product-modal-title">{isNew ? 'Nouveau produit' : `Modifier : ${form.name}`}</h2>
              <button type="button" className="admin-modal-close" onClick={closeModal} aria-label="Fermer">
                ×
              </button>
            </div>

            <div className="admin-product-modal-body">
              {message && <p className="admin-message">{message}</p>}

              <div className="admin-panel-form-header">
                <div className="admin-panel-title-with-badge">
                  {form.isHidden ? (
                    <span className="admin-badge admin-badge--warning">● Masqué du site</span>
                  ) : (
                    <span className="admin-badge admin-badge--ok">● Visible sur le site</span>
                  )}
                </div>
                <button
                  type="button"
                  className={`admin-btn ${form.isHidden ? 'secondary' : 'warning-btn'}`}
                  onClick={() => updateField('isHidden', !form.isHidden)}
                >
                  {form.isHidden ? 'Afficher sur le site' : 'Masquer du site'}
                </button>
              </div>

              <div className="admin-form">
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="name">Nom</label>
                    <input id="name" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="category">Catégorie</label>
                    <select id="category" value={form.category} onChange={(e) => updateField('category', e.target.value)}>
                      <option value="femme">Femme</option>
                      <option value="enfant">Enfant</option>
                    </select>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="description">Description</label>
                  <textarea id="description" value={form.description} onChange={(e) => updateField('description', e.target.value)} />
                </div>

                <div className="form-field">
                  <label htmlFor="nameAr">Nom en arabe (facultatif)</label>
                  <input
                    id="nameAr"
                    dir="rtl"
                    lang="ar"
                    value={form.nameAr || ''}
                    onChange={(e) => updateField('nameAr', e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="descriptionAr">Description en arabe (facultatif)</label>
                  <textarea
                    id="descriptionAr"
                    dir="rtl"
                    lang="ar"
                    value={form.descriptionAr || ''}
                    onChange={(e) => updateField('descriptionAr', e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="imageAlt">Texte alternatif des photos (facultatif)</label>
                  <input
                    id="imageAlt"
                    maxLength={255}
                    placeholder="Ex. : Robe satin noire à manches longues, portée de face"
                    value={form.imageAlt || ''}
                    onChange={(e) => updateField('imageAlt', e.target.value)}
                  />
                  <small>Décrit les photos pour Google et les lecteurs d'écran. Le même texte est utilisé pour toutes les photos du produit ; vide = nom + couleur.</small>
                </div>

                <div className="form-field">
                  <label htmlFor="imageAltAr">Texte alternatif des photos en arabe (facultatif)</label>
                  <input
                    id="imageAltAr"
                    dir="rtl"
                    lang="ar"
                    maxLength={255}
                    value={form.imageAltAr || ''}
                    onChange={(e) => updateField('imageAltAr', e.target.value)}
                  />
                </div>

                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="price">Prix (TND)</label>
                    <input
                      id="price"
                      type="number"
                      step="0.001"
                      min="0"
                      value={form.price}
                      onChange={(e) => updateField('price', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="discount">Remise (TND)</label>
                    <input
                      id="discount"
                      type="number"
                      step="0.001"
                      min="0"
                      value={form.discount ?? 0}
                      onChange={(e) => updateField('discount', e.target.value)}
                    />
                  </div>
                </div>

                {Number(form.discount) > 0 && (
                  <p className="admin-discount-preview">
                    Prix après remise : <strong>{formatPrice(getEffectivePrice(form))}</strong>
                  </p>
                )}
                <div className="form-field">
                  <label htmlFor="collectionImage">Image collection (accueil)</label>
                  <div className="admin-image-input-group">
                    {form.collectionImage && (
                      <img src={mediaUrl(form.collectionImage)} alt="Aperçu" className="admin-image-preview" />
                    )}
                    <label className="admin-upload-btn">
                      + Ajouter image collection
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          await handleUploadCollectionImage(file);
                          e.target.value = '';
                        }}
                        hidden
                      />
                    </label>
                  </div>
                </div>

                <p className="form-section-title">Couleurs et leurs images (miniatures & angles)</p>
                <div className="variant-list">
                  {form.colors.map((color, colorIdx) => (
                    <div
                      key={colorIdx}
                      className="admin-color-card"
                      style={{
                        background: '#fafafa',
                        border: '1px solid #e0e0e0',
                        padding: 16,
                        borderRadius: 8,
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 12,
                        }}
                      >
                        <strong style={{ fontSize: 14, color: '#333' }}>
                          Couleur {colorIdx + 1} {color.name ? `: ${color.name}` : ''}
                        </strong>
                        <button
                          type="button"
                          className="admin-btn danger sm"
                          onClick={() => handleRemoveColor(colorIdx)}
                        >
                          Supprimer la couleur
                        </button>
                      </div>

                      <div className="form-field" style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Nom de la couleur (max 20 car.)</label>
                        <input
                          value={color.name}
                          placeholder="Ex: Noir, Rose, Blanc..."
                          maxLength={20}
                          onChange={(e) => updateColor(colorIdx, 'name', e.target.value)}
                        />
                      </div>

                      <div className="form-field" style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Nom de la couleur en arabe (facultatif)</label>
                        <input
                          dir="rtl"
                          lang="ar"
                          value={color.nameAr || ''}
                          placeholder="مثال: أسود، وردي، أبيض عاجي"
                          maxLength={30}
                          onChange={(e) => updateColor(colorIdx, 'nameAr', e.target.value)}
                        />
                      </div>

                      {/* Dedicated Thumbnail Section */}
                      <div className="admin-color-section admin-thumbnail-section" style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                          Miniature (image représentative de la couleur)
                        </label>
                        {color.thumbnail ? (
                          <div className="variant-row admin-image-row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <img src={mediaUrl(color.thumbnail)} alt="" className="admin-image-preview-sm" />
                            <label className="admin-btn sm secondary inline-upload-btn">
                              Modifier
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  await handleReplaceThumbnail(colorIdx, file);
                                  e.target.value = '';
                                }}
                                hidden
                              />
                            </label>
                            {(() => {
                              const isMain = form.mainImage === color.thumbnail;
                              return (
                                <button
                                  type="button"
                                  className={`admin-btn sm ${isMain ? 'primary' : 'secondary'}`}
                                  style={isMain ? { background: '#2e7d32', color: '#fff', borderColor: '#2e7d32' } : {}}
                                  onClick={() => updateField('mainImage', color.thumbnail)}
                                >
                                  {isMain ? 'Image principale (défaut)' : 'Définir comme principale'}
                                </button>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="variant-row admin-image-row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <label className="admin-upload-btn sm">
                              + Ajouter image miniature
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  await handleUploadThumbnail(colorIdx, file);
                                  e.target.value = '';
                                }}
                                hidden
                              />
                            </label>
                          </div>
                        )}
                      </div>

                      {/* Dedicated Gallery Section */}
                      <div className="admin-color-section admin-gallery-section" style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                          Galerie (angles / positions supplémentaires)
                        </label>
                        {(color.gallery || []).map((galleryImg, galleryIdx) => {
                          const isMain = form.mainImage === galleryImg;
                          return (
                            <div key={galleryIdx} className="variant-row admin-image-row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                              {galleryImg && <img src={mediaUrl(galleryImg)} alt="" className="admin-image-preview-sm" />}
                              <label className="admin-btn sm secondary inline-upload-btn">
                                Modifier
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    await handleReplaceGalleryImage(colorIdx, galleryIdx, file);
                                    e.target.value = '';
                                  }}
                                  hidden
                                />
                              </label>
                              <button
                                type="button"
                                className={`admin-btn sm ${isMain ? 'primary' : 'secondary'}`}
                                style={isMain ? { background: '#2e7d32', color: '#fff', borderColor: '#2e7d32' } : {}}
                                onClick={() => updateField('mainImage', galleryImg)}
                              >
                                {isMain ? 'Image principale (défaut)' : 'Définir comme principale'}
                              </button>
                              <button
                                type="button"
                                className="admin-btn danger sm"
                                onClick={() => handleRemoveGalleryImage(colorIdx, galleryIdx)}
                              >
                                Suppr.
                              </button>
                            </div>
                          );
                        })}

                        <div className="admin-btn-group" style={{ marginTop: 6 }}>
                          <label className="admin-btn secondary inline-upload-btn sm">
                            + Ajouter image galerie
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                await handleAddGalleryImage(colorIdx, file);
                                e.target.value = '';
                              }}
                              hidden
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="admin-btn-group">
                    <button
                      type="button"
                      className="admin-btn secondary"
                      onClick={() => addListItem('colors', { id: '', name: '', thumbnail: '', gallery: [] })}
                    >
                      + Couleur
                    </button>
                  </div>
                </div>

                <p className="form-section-title">Vidéos du produit ({form.videos?.length || 0})</p>
                <div className="variant-list">
                  {isNew ? (
                    <p style={{ fontSize: 13, color: '#666', fontStyle: 'italic', margin: '4px 0 12px 0' }}>
                      Enregistrez le produit pour pouvoir téléverser des vidéos.
                    </p>
                  ) : (
                    <>
                      {(form.videos || []).map((vid, vidIdx) => (
                        <div
                          key={vid.id || vidIdx}
                          className="variant-row admin-image-row"
                          style={{ marginBottom: 8, flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
                        >
                          <video src={mediaUrl(vid.videoUrl)} className="admin-image-preview-sm" muted preload="metadata" />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                            Vidéo {vidIdx + 1}
                          </span>
                          <button
                            type="button"
                            className="admin-btn danger sm"
                            onClick={() => setVideoToDelete(vid)}
                          >
                            Supprimer
                          </button>
                        </div>
                      ))}
                      <div className="admin-btn-group" style={{ marginTop: 6, marginBottom: 12 }}>
                        <label className="admin-btn secondary inline-upload-btn sm">
                          {videoUploading ? 'Téléversement...' : '+ Ajouter une vidéo'}
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/ogg,video/quicktime"
                            disabled={videoUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) await handleUploadVideo(file);
                              e.target.value = '';
                            }}
                            hidden
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>

                <p className="form-section-title">Tailles</p>
                <div className="variant-list">
                  {form.sizes.map((size, i) => (
                    <div key={i} className="variant-row size-row">
                      <input
                        value={size}
                        placeholder="Ex: 38"
                        maxLength={2}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        onChange={(e) => updateListItem('sizes', i, e.target.value)}
                      />
                      <button type="button" className="admin-btn danger" onClick={() => removeListItem('sizes', i)}>
                        Suppr.
                      </button>
                    </div>
                  ))}
                  <button type="button" className="admin-btn secondary" onClick={() => addListItem('sizes', '')}>
                    + Taille
                  </button>
                </div>

                <p className="form-section-title">Stock par variante</p>
                {stockMatrix.length > 0 && (
                  <table className="stock-table">
                    <thead>
                      <tr>
                        <th>Variante</th>
                        <th>Quantité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockMatrix.map(({ key, label }) => (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={form.stock[key] ?? 0}
                              onChange={(e) => updateStock(key, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="form-footer">
                  <button type="button" className="admin-btn" onClick={handleSave} disabled={saving}>
                    {saving ? 'Enregistrement...' : isNew ? 'Ajouter le produit' : 'Enregistrer les modifications'}
                  </button>
                  {!isNew && selectedId && (
                    <button
                      type="button"
                      className="admin-btn danger"
                      onClick={() => setDeleteTarget(products.find((p) => p.id === selectedId) || null)}
                      disabled={saving}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="admin-modal-overlay"
          onClick={() => setDeleteTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div
            className="admin-modal"
            style={{ maxWidth: '420px', padding: '24px', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-confirm-title" style={{ margin: '0 0 16px', fontSize: '1.2rem', color: '#111' }}>
              Supprimer ce produit ?
            </h3>
            <p style={{ margin: '0 0 24px', color: '#666', fontSize: '0.9rem' }}>
              Cette action est irréversible. Le produit &laquo; {deleteTarget.name} &raquo; sera définitivement supprimé.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                className="admin-btn secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
              >
                Annuler
              </button>
              <button
                type="button"
                className="admin-btn danger"
                onClick={handleDelete}
                disabled={saving}
              >
                {saving ? 'Suppression...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {videoToDelete && (
        <div
          className="admin-modal-overlay"
          onClick={() => setVideoToDelete(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="admin-modal"
            style={{ maxWidth: '400px', padding: '24px', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', color: '#111' }}>
              Supprimer cette vidéo ?
            </h3>
            <p style={{ margin: '0 0 20px', color: '#666', fontSize: '0.85rem' }}>
              Cette action supprimera définitivement la vidéo du produit.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                className="admin-btn secondary"
                onClick={() => setVideoToDelete(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="admin-btn danger"
                onClick={handleConfirmDeleteVideo}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
