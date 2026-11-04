import { useEffect, useMemo, useRef, useState } from 'react';
import { productPath } from '../../shared/urls';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../i18n/router';
import ProductReviewsSection from '../components/ProductReviewsSection';
import ProductPrice from '../components/ProductPrice';
import ProductBadges from '../components/ProductBadges';
import BuyNowModal from '../components/BuyNowModal';
import ShareModal from '../components/ShareModal';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { useProducts } from '../context/ProductsContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getEffectivePrice } from '../../shared/price';
import { buildStockMatrix, getAvailableStock, getStockStatus } from '../../shared/stock';
import { formatPrice } from '../../shared/formatPrice';
import { useSeo } from '../seo/useSeo';
import { productMeta } from '../seo/meta';
import { imageVariantPath } from '../../shared/imageVariants.js';
import { useLocale } from '../i18n/LocaleContext';
import '../styles/product.css';
import '../styles/product-admin.css';
import { useT } from '../i18n/useT';
import { hasArabicProduct, localizedProductView, productDescription, productImageAlt, productName } from '../../shared/productText';

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function mapProductColorsToForm(rawColors = []) {
  return rawColors.map((c, i) => {
    const rawImages = (c.images || (c.image ? [c.image] : [])).filter(Boolean);
    const thumbnail = (c.thumbnail || rawImages[0] || c.image || '').trim();
    const gallery = (c.gallery || rawImages.slice(1))
      .map((g) => (typeof g === 'string' ? g.trim() : ''))
      .filter(Boolean);
    return {
      id: c.id || slugify(c.name) || `color-${i}`,
      name: (c.name || '').trim(),
      nameAr: (c.nameAr || '').trim(),
      thumbnail,
      gallery,
    };
  });
}

function normalizeProduct(form) {
  const colors = form.colors
    .filter((c) => c.name.trim())
    .map((c, i) => {
      const thumbnail = (c.thumbnail || '').trim();
      const gallery = (c.gallery || []).map((g) => (typeof g === 'string' ? g.trim() : '')).filter(Boolean);
      const images = [thumbnail, ...gallery].filter(Boolean);
      return {
        id: c.id || slugify(c.name) || `color-${i}`,
        name: c.name.trim(),
        nameAr: (c.nameAr || '').trim(),
        image: thumbnail,
        thumbnail,
        gallery,
        images,
      };
    });

  const sizes = form.sizes.map((s) => s.trim()).filter(Boolean);

  const stock = { ...form.stock };
  buildStockMatrix({ colors, sizes }).forEach(({ key }) => {
    if (stock[key] === undefined || stock[key] === '') stock[key] = 0;
    stock[key] = Number(stock[key]) || 0;
  });

  const allThumbnails = colors.flatMap((c) => c.images).filter(Boolean);
  const currentMain = (form.mainImage || '').trim();
  const mainImage =
    currentMain && allThumbnails.includes(currentMain)
      ? currentMain
      : allThumbnails[0] || '';

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    nameAr: (form.nameAr || '').trim(),
    descriptionAr: (form.descriptionAr || '').trim(),
    price: Number(form.price) || 0,
    discount: Number(form.discount) || 0,
    category: form.category,
    mainImage,
    thumbnails: allThumbnails,
    colors,
    sizes,
    stock,
    collectionImage: (form.collectionImage || '').trim(),
    isHidden: Boolean(form.isHidden),
  };
}

async function uploadFile(file, onRejected) {
  if (!file) return null;
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await api.uploadProductImage(formData);
    if (res?.url) return res.url;
  } catch (err) {
    // The server refused the file itself (wrong content, too large...): tell the admin instead of embedding it as a data URL.
    if (err?.status >= 400 && err?.status < 500) {
      onRejected?.(err.message);
      return null;
    }
    console.warn('API upload failed, falling back to data URL:', err);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

function formatVideoTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function ProductVideoPlayer({ videoUrl }) {
  const { t, known } = useT();
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setCurrentTime(0);
    video.muted = true;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [videoUrl]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (videoRef.current.duration && !duration) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const handleSeek = (e) => {
    if (!progressRef.current || !videoRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = percentage * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="product_video_main_container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        className="product_video_player"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onClick={togglePlayPause}
      />

      {/* Center Play Overlay when paused */}
      {!isPlaying && (
        <button
          type="button"
          className="product_video_center_play"
          onClick={togglePlayPause}
          aria-label={t('product.videoPlay')}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      {/* Sleek Custom Controls Bar (Play/Pause & Seekbar ONLY) */}
      <div
        className={`product_video_controls_overlay${
          !isPlaying || isHovered ? ' visible' : ''
        }`}
      >
        <button
          type="button"
          className="product_video_play_btn"
          onClick={togglePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
          title={isPlaying ? 'Pause' : 'Lecture'}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div
          className="product_video_progress_container"
          ref={progressRef}
          onClick={handleSeek}
          role="slider"
          aria-label={t('product.videoProgress')}
          aria-valuemin="0"
          aria-valuemax={duration || 100}
          aria-valuenow={currentTime}
        >
          <div className="product_video_progress_track">
            <div
              className="product_video_progress_bar"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <span className="product_video_time">
          {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default function Product() {
  const { t, known, colorLabel } = useT();
  const { slug: productKey } = useParams();
  const navigate = useNavigate();
  const {
    getProduct,
    products,
    loading,
    updateProduct,
    deleteProduct,
    uploadProductVideo,
    deleteProductVideo,
  } = useProducts();
  const { addItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isAdmin } = useAuth();
  const { locale } = useLocale();

  const product = getProduct(productKey);

  // The address of a product is its slug. A link made with its id (an old share, a hero button) moves to the slug
  // address, as the server does with a 301.
  useEffect(() => {
    if (product?.slug && productKey && productKey !== product.slug) navigate(productPath(product), { replace: true });
  }, [product, productKey, navigate]);

  // Head metadata: a product this visitor cannot see is described as "introuvable" and not indexed. While the
  // product loads the head is left as is (the server-written one on a first load, see SeoManager).
  const visibleProduct = product && (!product.isHidden || isAdmin) ? product : null;
  const seoMeta = productMeta(localizedProductView(visibleProduct, locale), locale);
  // Same rule as the server: an Arabic page without a full Arabic translation is not indexed.
  if (visibleProduct && locale === 'ar' && !hasArabicProduct(visibleProduct)) seoMeta.robots = 'noindex';
  useSeo(loading && !product ? null : seoMeta);

  // Customer view states
  const [quantity, setQuantity] = useState(1);
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [mainImage, setMainImage] = useState('');
  const [cartMessage, setCartMessage] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [isZoomed, setIsZoomed] = useState(false);
  const [buyNowModalOpen, setBuyNowModalOpen] = useState(false);
  const [buyNowItem, setBuyNowItem] = useState(null);
  const [selectedVideoIdx, setSelectedVideoIdx] = useState(0);

  // Admin edit states
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adminMessage, setAdminMessage] = useState({ type: '', text: '' });
  const [stockExpanded, setStockExpanded] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState(null);
  const [videoUploading, setVideoUploading] = useState(false);

  const verticalTrackRef = useRef(null);
  const colorTrackRef = useRef(null);
  const videoTrackRef = useRef(null);

  // Active product source (draft when editing, loaded product otherwise)
  const activeProduct = isEditing && draft ? draft : product;

  // Flattened thumbnails for selection and arrow navigation
  const allThumbnails = useMemo(() => {
    if (!activeProduct) return [];
    const result = [];
    if (activeProduct.colors?.length > 0) {
      activeProduct.colors.forEach((color, colorIdx) => {
        const colorThumb = color.thumbnail || color.images?.[0] || color.image || '';
        const gallery = color.gallery || (color.images?.length > 1 ? color.images.slice(1) : []);

        if (colorThumb) {
          result.push({
            src: colorThumb,
            colorId: color.id,
            colorName: color.name,
            isThumbnail: true,
            isGallery: false,
            colorIdx,
            color,
          });
        }

        gallery.forEach((src, galleryIdx) => {
          if (src) {
            result.push({
              src,
              colorId: color.id,
              colorName: color.name,
              isThumbnail: false,
              isGallery: true,
              colorIdx,
              galleryIdx,
              color,
            });
          }
        });
      });
    }
    if (!result.length) {
      const fallbackList = activeProduct.thumbnails?.length
        ? activeProduct.thumbnails
        : [activeProduct.mainImage];
      fallbackList.filter(Boolean).forEach((src) => {
        result.push({
          src,
          colorId: null,
          colorName: '',
          isThumbnail: true,
          isGallery: false,
          colorIdx: 0,
          color: null,
        });
      });
    }
    return result;
  }, [activeProduct]);

  // Alt text of a gallery photo: product name, its colour and, when the colour has several photos, which one.
  const photoAlt = (thumb) => {
    const name = productName(activeProduct, locale);
    if (!thumb) return name;
    const sameColor = allThumbnails.filter((item) => item.colorId === thumb.colorId);
    return productImageAlt(name, {
      colorName: thumb.colorName ? colorLabel(thumb.colorName, activeProduct) : '',
      positionText: sameColor.length > 1 ? t('product.photoOf', { n: sameColor.indexOf(thumb) + 1, total: sameColor.length }) : '',
    });
  };
  const mainImageThumb =
    allThumbnails.find((item) => item.src === mainImage && (selectedColor?.id ? item.colorId === selectedColor.id : true)) ||
    allThumbnails.find((item) => item.src === mainImage);

  useEffect(() => {
    if (!product) return;
    const initialColor = product.colors?.[0] ?? null;
    setSelectedSize(product.sizes?.[0] ?? null);
    const initialMainImage =
      product.mainImage ||
      initialColor?.thumbnail ||
      initialColor?.images?.[0] ||
      initialColor?.image ||
      '';
    setMainImage(initialMainImage);

    let matchingColor = initialColor;
    if (initialMainImage && product.colors?.length > 0) {
      const found = product.colors.find(
        (c) =>
          c.thumbnail === initialMainImage ||
          c.image === initialMainImage ||
          (c.images || []).includes(initialMainImage) ||
          (c.gallery || []).includes(initialMainImage),
      );
      if (found) {
        matchingColor = found;
      }
    }
    setSelectedColor(matchingColor);
    setSelectedVideoIdx(0);
    setQuantity(1);
    setCartMessage('');
  }, [product?.id]);

  const scrollToThumbnail = (index) => {
    if (!verticalTrackRef.current || typeof index !== 'number' || index < 0) return;
    const track = verticalTrackRef.current;
    const buttons = track.querySelectorAll('.thumb_box_vertical');
    const targetBtn = buttons[index];
    if (targetBtn) {
      const trackRect = track.getBoundingClientRect();
      const btnRect = targetBtn.getBoundingClientRect();
      if (track.scrollWidth > track.clientWidth) {
        const offset = btnRect.left - trackRect.left + track.scrollLeft - (track.clientWidth - btnRect.width) / 2;
        track.scrollTo({ left: offset, behavior: 'smooth' });
      }
      if (track.scrollHeight > track.clientHeight) {
        const offset = btnRect.top - trackRect.top + track.scrollTop - (track.clientHeight - btnRect.height) / 2;
        track.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
  };

  const scrollToColorSwatch = (colorId) => {
    if (!colorTrackRef.current || !colorId || !activeProduct?.colors?.length) return;
    const targetIdx = activeProduct.colors.findIndex((c) => c.id === colorId);
    if (targetIdx !== -1) {
      const track = colorTrackRef.current;
      const buttons = track.querySelectorAll('.color_thumb_box');
      const targetBtn = buttons[targetIdx];
      if (targetBtn) {
        const trackLeft = track.getBoundingClientRect().left;
        const btnLeft = targetBtn.getBoundingClientRect().left;
        const offset = btnLeft - trackLeft + track.scrollLeft - (track.clientWidth - targetBtn.clientWidth) / 2;
        track.scrollTo({ left: offset, behavior: 'smooth' });
      }
    }
  };

  const scrollToSection = (targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const header = document.querySelector('.header_wrapper');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - 16;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  };

  const scrollToColorThumbnail = (colorId) => {
    if (!verticalTrackRef.current || !colorId || !allThumbnails.length) return;
    const targetIdx = allThumbnails.findIndex((item) => item.colorId === colorId);
    if (targetIdx !== -1) {
      scrollToThumbnail(targetIdx);
    }
  };

  const handleColorSelect = (color) => {
    if (!color) return;
    setSelectedColor(color);
    const mainImg =
      color.thumbnail || color.images?.[0] || color.image || activeProduct.mainImage || '';
    setMainImage(mainImg);
    setCartMessage('');
    scrollToColorThumbnail(color.id);
    scrollToColorSwatch(color.id);
  };

  const handleThumbnailSelect = (thumb, index) => {
    if (!thumb) return;
    setMainImage(thumb.src);
    let parentColor = null;
    if (thumb.color) {
      parentColor = thumb.color;
    } else if (thumb.colorId) {
      parentColor = activeProduct?.colors?.find((c) => c.id === thumb.colorId) || null;
    }
    if (parentColor) {
      setSelectedColor(parentColor);
    }
    setCartMessage('');
    if (typeof index === 'number') {
      scrollToThumbnail(index);
    } else {
      const foundIdx = allThumbnails.findIndex(
        (t) => t === thumb || (t.src === thumb.src && t.colorId === thumb.colorId),
      );
      if (foundIdx !== -1) scrollToThumbnail(foundIdx);
    }
  };

  const handleVerticalArrow = (direction) => {
    if (!allThumbnails.length) return;
    let currentIdx = allThumbnails.findIndex(
      (t) => t.src === mainImage && (selectedColor?.id ? t.colorId === selectedColor.id : true),
    );
    if (currentIdx === -1) {
      currentIdx = allThumbnails.findIndex((t) => t.src === mainImage);
    }
    if (currentIdx === -1) {
      currentIdx = 0;
    }

    let targetIdx = currentIdx;
    if (direction === 'up') {
      targetIdx = Math.max(0, currentIdx - 1);
    } else if (direction === 'down') {
      targetIdx = Math.min(allThumbnails.length - 1, currentIdx + 1);
    }

    const targetThumb = allThumbnails[targetIdx];
    if (targetThumb) {
      handleThumbnailSelect(targetThumb, targetIdx);
    }
  };

  const handleHorizontalArrow = (direction) => {
    if (!activeProduct?.colors?.length) return;
    let currentIdx = activeProduct.colors.findIndex((c) => c.id === selectedColor?.id);
    if (currentIdx === -1) {
      currentIdx = 0;
    }

    let targetIdx = currentIdx;
    if (direction === 'left') {
      targetIdx = Math.max(0, currentIdx - 1);
    } else if (direction === 'right') {
      targetIdx = Math.min(activeProduct.colors.length - 1, currentIdx + 1);
    }

    const targetColor = activeProduct.colors[targetIdx];
    if (targetColor) {
      handleColorSelect(targetColor);
    }
  };

  const handleVideoArrow = (direction) => {
    const videos = activeProduct?.videos || [];
    if (!videos.length) return;
    let nextIdx = selectedVideoIdx;
    if (direction === 'left') {
      nextIdx = Math.max(0, selectedVideoIdx - 1);
    } else if (direction === 'right') {
      nextIdx = Math.min(videos.length - 1, selectedVideoIdx + 1);
    }
    setSelectedVideoIdx(nextIdx);
    if (videoTrackRef.current) {
      const buttons = videoTrackRef.current.querySelectorAll('.product_video_thumb_box');
      if (buttons[nextIdx]) {
        buttons[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  };

  /* ==========================================================================
     Admin Draft Handlers
     ========================================================================== */

  const enterEditMode = () => {
    if (!product) return;
    setDraft({
      ...product,
      colors: mapProductColorsToForm(product.colors),
      sizes: [...(product.sizes || [])],
      stock: { ...(product.stock || {}) },
      videos: Array.isArray(product.videos) ? [...product.videos] : [],
      collectionImage: product.collectionImage || '',
      isHidden: product.isHidden === true || product.is_active === false,
    });
    setIsEditing(true);
    setAdminMessage({ type: '', text: '' });
  };

  const handleUploadVideo = async (file) => {
    if (!file || !product?.id) return;
    setVideoUploading(true);
    setAdminMessage({ type: '', text: '' });
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await uploadProductVideo(product.id, formData);
      if (res?.product?.videos) {
        setDraft((prev) => (prev ? { ...prev, videos: res.product.videos } : prev));
      }
      setAdminMessage({ type: 'success', text: 'Vidéo ajoutée avec succès.' });
      setTimeout(() => setAdminMessage({ type: '', text: '' }), 4000);
    } catch (err) {
      setAdminMessage({ type: 'error', text: err.message || 'Erreur lors du téléversement de la vidéo.' });
    } finally {
      setVideoUploading(false);
    }
  };

  const handleConfirmDeleteVideo = async () => {
    if (!videoToDelete || !product?.id) return;
    try {
      await deleteProductVideo(product.id, videoToDelete.id);
      setDraft((prev) =>
        prev
          ? { ...prev, videos: (prev.videos || []).filter((v) => v.id !== videoToDelete.id) }
          : prev,
      );
      if (selectedVideoIdx >= (activeProduct?.videos?.length || 1) - 1) {
        setSelectedVideoIdx(Math.max(0, (activeProduct?.videos?.length || 1) - 2));
      }
      setVideoToDelete(null);
      setAdminMessage({ type: 'success', text: 'Vidéo supprimée.' });
      setTimeout(() => setAdminMessage({ type: '', text: '' }), 4000);
    } catch (err) {
      setAdminMessage({ type: 'error', text: err.message || 'Erreur lors de la suppression de la vidéo.' });
    }
  };

  const exitEditMode = () => {
    setIsEditing(false);
    setDraft(null);
    setAdminMessage({ type: '', text: '' });
    if (product) {
      setMainImage(product.mainImage || product.colors?.[0]?.thumbnail || '');
      setSelectedColor(product.colors?.[0] || null);
    }
  };

  const updateDraftField = (field, value) => {
    setDraft((f) => ({ ...f, [field]: value }));
  };

  const updateDraftColor = (colorIdx, key, value) => {
    setDraft((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        let val = value;
        if (key === 'name') {
          val = val.slice(0, 20);
        }
        const updated = { ...c, [key]: val };
        if (key === 'name') {
          updated.id = slugify(val) || `color-${i}`;
        }
        return updated;
      });
      return { ...f, colors };
    });
  };

  const handleUploadThumbnail = async (colorIdx, file) => {
    if (!file) return;
    const url = await uploadFile(file, (text) => setAdminMessage({ type: 'error', text }));
    if (!url) return;

    setAdminMessage({ type: '', text: '' });
    setDraft((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        return { ...c, thumbnail: url };
      });
      const newMain = f.mainImage || url;
      return { ...f, colors, mainImage: newMain };
    });
    if (!mainImage) setMainImage(url);
  };

  const handleReplaceThumbnail = async (colorIdx, file) => {
    if (!file) return;
    const oldThumb = draft.colors[colorIdx]?.thumbnail;
    const url = await uploadFile(file, (text) => setAdminMessage({ type: 'error', text }));
    if (!url) return;

    setAdminMessage({ type: '', text: '' });
    setDraft((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        return { ...c, thumbnail: url };
      });
      let nextMain = f.mainImage;
      if (nextMain === oldThumb || !nextMain) {
        nextMain = url;
      }
      let collectionImage = f.collectionImage;
      if (collectionImage === oldThumb) {
        collectionImage = url;
      }
      return { ...f, colors, mainImage: nextMain, collectionImage };
    });

    if (mainImage === oldThumb || !mainImage) {
      setMainImage(url);
    }
  };

  const handleAddGalleryImage = async (colorIdx, file) => {
    if (!file) return;
    const url = await uploadFile(file, (text) => setAdminMessage({ type: 'error', text }));
    if (!url) return;

    setAdminMessage({ type: '', text: '' });
    setDraft((f) => {
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
    const oldUrl = draft.colors[colorIdx]?.gallery?.[galleryIdx];
    const url = await uploadFile(file, (text) => setAdminMessage({ type: 'error', text }));
    if (!url) return;

    setAdminMessage({ type: '', text: '' });
    setDraft((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        const gallery = [...(c.gallery || [])];
        gallery[galleryIdx] = url;
        return { ...c, gallery };
      });
      let nextMain = f.mainImage;
      if (nextMain === oldUrl) {
        nextMain = url;
      }
      let collectionImage = f.collectionImage;
      if (collectionImage === oldUrl) {
        collectionImage = url;
      }
      return { ...f, colors, mainImage: nextMain, collectionImage };
    });

    if (mainImage === oldUrl) {
      setMainImage(url);
    }
  };

  const handleRemoveGalleryImage = (colorIdx, galleryIdx) => {
    const oldUrl = draft.colors[colorIdx]?.gallery?.[galleryIdx];
    setDraft((f) => {
      const colors = f.colors.map((c, i) => {
        if (i !== colorIdx) return c;
        const gallery = (c.gallery || []).filter((_, idx) => idx !== galleryIdx);
        return { ...c, gallery };
      });

      let nextMain = f.mainImage;
      if (nextMain === oldUrl) {
        const remainingImages = colors.flatMap((c) => [c.thumbnail, ...(c.gallery || [])]).filter(Boolean);
        nextMain = remainingImages[0] || f.collectionImage || '';
      }
      return { ...f, colors, mainImage: nextMain };
    });

    if (mainImage === oldUrl) {
      const remainingImages = draft.colors
        .flatMap((c, i) =>
          i === colorIdx
            ? [c.thumbnail, ...(c.gallery || []).filter((_, idx) => idx !== galleryIdx)]
            : [c.thumbnail, ...(c.gallery || [])],
        )
        .filter(Boolean);
      setMainImage(remainingImages[0] || '');
    }
  };

  const handleRemoveColor = (colorIdx) => {
    const removedColor = draft.colors[colorIdx];
    const removedImages = [removedColor?.thumbnail, ...(removedColor?.gallery || [])].filter(Boolean);

    setDraft((f) => {
      const colors = f.colors.filter((_, i) => i !== colorIdx);
      let nextMain = f.mainImage;
      if (removedImages.includes(nextMain)) {
        const remainingImages = colors.flatMap((c) => [c.thumbnail, ...(c.gallery || [])]).filter(Boolean);
        nextMain = remainingImages[0] || f.collectionImage || '';
      }
      return { ...f, colors, mainImage: nextMain };
    });

    if (selectedColor?.id === removedColor?.id) {
      const nextColor = draft.colors.find((_, i) => i !== colorIdx) || null;
      setSelectedColor(nextColor);
      if (nextColor) {
        setMainImage(nextColor.thumbnail || nextColor.gallery?.[0] || '');
      }
    }
  };

  const handleAddColor = () => {
    const nextIdx = draft.colors.length + 1;
    const newColor = {
      id: `color-${nextIdx}`,
      name: `Couleur ${nextIdx}`,
      thumbnail: '',
      gallery: [],
    };
    setDraft((f) => ({
      ...f,
      colors: [...f.colors, newColor],
    }));
    setSelectedColor(newColor);
  };

  const handleAddSize = () => {
    setDraft((f) => ({
      ...f,
      sizes: [...f.sizes, ''],
    }));
  };

  const handleUpdateSize = (index, value) => {
    const cleanVal = value.replace(/\D/g, '').slice(0, 2);
    setDraft((f) => {
      const sizes = [...f.sizes];
      sizes[index] = cleanVal;
      return { ...f, sizes };
    });
  };

  const handleRemoveSize = (index) => {
    setDraft((f) => ({
      ...f,
      sizes: f.sizes.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateStock = (key, value) => {
    setDraft((f) => ({
      ...f,
      stock: { ...f.stock, [key]: value },
    }));
  };

  const handleUploadCollectionImage = async (file) => {
    if (!file) return;
    const url = await uploadFile(file, (text) => setAdminMessage({ type: 'error', text }));
    if (!url) return;

    setAdminMessage({ type: '', text: '' });
    updateDraftField('collectionImage', url);
  };

  const handleToggleVisibility = async () => {
    if (isEditing) {
      updateDraftField('isHidden', !draft.isHidden);
    } else {
      try {
        setSaving(true);
        setAdminMessage({ type: '', text: '' });
        const updatedVal = !(product.isHidden === true || product.is_active === false);
        await updateProduct(product.id, {
          ...normalizeProduct(product),
          isHidden: updatedVal,
          is_active: !updatedVal,
        });
        setAdminMessage({
          type: updatedVal ? 'warning' : 'success',
          text: updatedVal ? 'Produit masqué du site.' : 'Produit visible sur le site.',
        });
        setTimeout(() => setAdminMessage({ type: '', text: '' }), 4000);
      } catch (err) {
        setAdminMessage({
          type: 'error',
          text: err.message || 'Erreur lors de la modification de la visibilité.',
        });
      } finally {
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    if (!draft?.name?.trim()) {
      setAdminMessage({ type: 'error', text: 'Le nom du produit est requis.' });
      return;
    }
    if (!draft?.category?.trim()) {
      setAdminMessage({ type: 'error', text: 'Veuillez sélectionner une catégorie.' });
      return;
    }
    if (!draft?.description?.trim()) {
      setAdminMessage({ type: 'error', text: 'La description est requise.' });
      return;
    }
    const priceNum = Number(draft?.price);
    if (
      draft?.price === '' ||
      draft?.price === null ||
      draft?.price === undefined ||
      isNaN(priceNum) ||
      priceNum <= 0
    ) {
      setAdminMessage({ type: 'error', text: 'Le prix est requis et doit être supérieur à 0.' });
      return;
    }
    const discountNum = Number(draft?.discount ?? 0);
    if (isNaN(discountNum) || discountNum < 0) {
      setAdminMessage({ type: 'error', text: 'La remise doit être positive.' });
      return;
    }
    if (discountNum > priceNum) {
      setAdminMessage({ type: 'error', text: 'La remise ne peut pas être supérieure au prix.' });
      return;
    }
    if (!draft?.collectionImage?.trim()) {
      setAdminMessage({ type: 'error', text: 'Veuillez ajouter une image de collection.' });
      return;
    }
    const validSizes = (draft?.sizes || []).map((s) => s.trim()).filter(Boolean);
    if (validSizes.length === 0) {
      setAdminMessage({ type: 'error', text: 'Veuillez ajouter au moins une taille.' });
      return;
    }
    const rawColors = draft?.colors || [];
    if (rawColors.length === 0) {
      setAdminMessage({ type: 'error', text: 'Veuillez ajouter au moins une couleur.' });
      return;
    }
    for (let i = 0; i < rawColors.length; i++) {
      const c = rawColors[i];
      if (!c.name?.trim()) {
        setAdminMessage({ type: 'error', text: `Le nom de la couleur ${i + 1} est requis.` });
        return;
      }
      const thumb = (c.thumbnail || c.images?.[0] || c.image || '').trim();
      if (!thumb) {
        setAdminMessage({
          type: 'error',
          text: `Veuillez ajouter une miniature pour la couleur "${c.name.trim()}".`,
        });
        return;
      }
    }

    setSaving(true);
    setAdminMessage({ type: '', text: '' });

    try {
      const normalized = normalizeProduct(draft);
      await updateProduct(product.id, normalized);
      setIsEditing(false);
      setDraft(null);
      setAdminMessage({ type: 'success', text: 'Modifications enregistrées avec succès.' });
      setTimeout(() => setAdminMessage({ type: '', text: '' }), 4000);
    } catch (err) {
      setAdminMessage({ type: 'error', text: err.message || 'Erreur lors de la sauvegarde.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce produit ? Cette action est irréversible.')) return;
    setSaving(true);
    try {
      await deleteProduct(product.id);
      navigate('/');
    } catch (err) {
      setAdminMessage({ type: 'error', text: err.message || 'Erreur lors de la suppression.' });
      setSaving(false);
    }
  };

  /* ==========================================================================
     Customer Action Handlers
     ========================================================================== */

  const recommendations = useMemo(() => {
    if (!activeProduct) return [];
    return products
      .filter((p) => p.category === activeProduct.category && p.id !== activeProduct.id && (isAdmin || !p.isHidden))
      .slice(0, 4);
  }, [activeProduct, products, isAdmin]);

  const availableStock = activeProduct
    ? getAvailableStock(activeProduct, selectedColor?.id, selectedSize)
    : 0;

  const stockStatus = getStockStatus(availableStock);
  const stockText = t(`stock.${stockStatus.status}`, { qty: availableStock });

  const buildDetails = () => {
    const parts = [];
    if (selectedColor?.name) parts.push(selectedColor.name);
    if (selectedSize) parts.push(`Taille ${selectedSize}`);
    return parts.join(' · ') || 'Standard';
  };

  const currentVariant = useMemo(() => {
    if (!activeProduct?.variants?.length) return null;
    return (
      activeProduct.variants.find(
        (v) =>
          (!selectedColor?.id || v.colorSlug === selectedColor.id) &&
          (!selectedSize || v.size === selectedSize),
      ) ||
      activeProduct.variants.find(
        (v) => !selectedColor?.id || v.colorSlug === selectedColor.id,
      ) ||
      activeProduct.variants[0] ||
      null
    );
  }, [activeProduct, selectedColor?.id, selectedSize]);

  const isFav = isFavorite(activeProduct?.id, currentVariant?.id);

  const buildCartItem = () => ({
    productId: activeProduct.id,
    variantId: currentVariant?.id ?? null,
    name: activeProduct.name,
    price: getEffectivePrice(activeProduct),
    quantity,
    image: mainImage || activeProduct.mainImage,
    colorId: selectedColor?.id ?? null,
    colorName: selectedColor?.name ?? '',
    size: selectedSize ?? null,
    details: buildDetails(),
  });

  const validateSelection = () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrderFav'));
      return false;
    }
    if (activeProduct.colors?.length && !selectedColor) {
      setCartMessage(t('product.pickColor'));
      return false;
    }
    if (activeProduct.sizes?.length && !selectedSize) {
      setCartMessage(t('product.pickSize'));
      return false;
    }
    if (quantity > availableStock) {
      setCartMessage(t('product.stockInsufficient', { n: availableStock }));
      return false;
    }
    if (availableStock <= 0) {
      setCartMessage(t('product.outOfStockMsg'));
      return false;
    }
    return true;
  };

  const handleAddToCart = async () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrder'));
      return;
    }
    if (!activeProduct || !validateSelection()) return;
    try {
      await addItem(buildCartItem());
      setCartMessage(t('product.added'));
    } catch (err) {
      setCartMessage(known(err.message) || t('product.addFailed'));
    }
  };

  const handleShare = () => {
    setShareOpen(true);
  };

  const handleCommander = () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrder'));
      return;
    }
    if (!activeProduct || !validateSelection()) return;
    setBuyNowItem({
      productId: activeProduct.id,
      colorId: selectedColor?.id ?? null,
      colorName: selectedColor?.name ?? '',
      size: selectedSize ?? null,
      quantity,
      name: activeProduct.name,
      price: getEffectivePrice(activeProduct),
      image: mainImage || activeProduct.mainImage,
      details: buildDetails(),
    });
    setBuyNowModalOpen(true);
  };

  if (loading) {
    return (
      <main className="product_page_wrapper">
        <p style={{ padding: 40, textAlign: 'center' }}>{t('common.loading')}</p>
      </main>
    );
  }

  // Hidden guard: only non-admins see the "Not available" screen for hidden products
  if (!product || (product.isHidden && !isAdmin)) {
    return (
      <main className="product_page_wrapper">
        <div className="product_unavailable">
          <p>{t('product.unavailable')}</p>
          <Link to="/" className="collection_btn" style={{ display: 'inline-block', marginTop: 16 }}>
            {t('notfound.home')}
          </Link>
        </div>
      </main>
    );
  }

  const isHidden = isEditing
    ? draft?.isHidden
    : product.isHidden === true || product.is_active === false;

  return (
    <>
      {/* ==========================================================================
         Admin Product Control Bar
         ========================================================================== */}
      {isAdmin && (
        <div className="admin_product_bar">
          <div className="admin_product_bar_inner">
            <div className="admin_product_bar_left">
              <button
                type="button"
                className="admin_visibility_toggle_btn"
                onClick={handleToggleVisibility}
                disabled={saving}
              >
                {isHidden ? 'Rendre visible' : 'Masquer du site'}
              </button>
              <span className={`admin_visibility_badge ${isHidden ? 'hidden' : 'visible'}`}>
                {isHidden ? '● Masqué du site' : '● Visible sur le site'}
              </span>
            </div>

            <div className="admin_product_bar_right">
              <button
                type="button"
                className={`admin_bar_btn admin_bar_btn_edit ${isEditing ? 'active' : ''}`}
                onClick={() => {
                  if (isEditing) {
                    exitEditMode();
                  } else {
                    enterEditMode();
                  }
                }}
                disabled={saving}
              >
                {isEditing ? "Annuler l'édition" : 'Modifier'}
              </button>

              {isEditing && (
                <button
                  type="button"
                  className="admin_bar_btn admin_bar_btn_save"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              )}

              <button
                type="button"
                className="admin_bar_btn admin_bar_btn_delete"
                onClick={handleDelete}
                disabled={saving}
              >
                Supprimer
              </button>
            </div>
          </div>

          {adminMessage.text && (
            <div className={`admin_product_bar_msg ${adminMessage.type}`}>
              {adminMessage.text}
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
         Product Page Main Layout
         ========================================================================== */}
      <main className="product_page_wrapper">
        {/* Vertical Thumbnails Column (Left) */}
        <div className="thumbnails_vertical_container">
          <button
            type="button"
            className="scroll_arrow"
            onClick={() => handleVerticalArrow('up')}
            aria-label={t('marquee.up')}
          >
            <span className="scroll_arrow_icon_vertical">❮</span>
          </button>

          <div className="vertical_thumbnails_track" ref={verticalTrackRef}>
            {isEditing && draft?.colors?.length > 0 ? (
              // Edit-mode vertical image sequence by color
              draft.colors.map((color, colorIdx) => {
                const colorThumb = color.thumbnail || color.images?.[0] || color.image;
                const galleryImgs = color.gallery || (color.images?.length > 1 ? color.images.slice(1) : []);

                return (
                  <div key={color.id || colorIdx} style={{ display: 'contents' }}>
                    {/* Color Thumbnail in vertical track (No gallery overlay per Requirement 7) */}
                    {colorThumb && (
                      <button
                        type="button"
                        className={`thumb_box_vertical${
                          mainImage === colorThumb && selectedColor?.id === color.id ? ' active' : ''
                        }`}
                        onClick={() =>
                          handleThumbnailSelect(
                            { src: colorThumb, colorId: color.id, color, isThumbnail: true },
                            allThumbnails.findIndex((t) => t.src === colorThumb && t.colorId === color.id),
                          )
                        }
                      >
                        <img src={colorThumb} alt="" />
                      </button>
                    )}

                    {/* Gallery Images for this color (With overlay per Requirement 6) */}
                    {galleryImgs.map((galleryImg, galleryIdx) => {
                      const isMain = draft.mainImage === galleryImg;
                      const isSelected = mainImage === galleryImg && selectedColor?.id === color.id;

                      return (
                        <div
                          key={`${galleryImg}-${galleryIdx}`}
                          className={`thumb_box_vertical${isSelected ? ' active' : ''}`}
                          onClick={() =>
                            handleThumbnailSelect(
                              { src: galleryImg, colorId: color.id, color, isGallery: true, galleryIdx },
                              allThumbnails.findIndex((t) => t.src === galleryImg && t.colorId === color.id),
                            )
                          }
                        >
                          <div className="admin_image_overlay">
                            {/* Supprimer Gallery Image */}
                            <button
                              type="button"
                              className="admin_overlay_btn admin_overlay_btn_delete"
                              title="Supprimer l'image"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveGalleryImage(colorIdx, galleryIdx);
                              }}
                            >
                              Supprimer
                            </button>

                            {/* Modifier Gallery Image */}
                            <label
                              className="admin_overlay_btn admin_overlay_btn_edit"
                              title="Remplacer l'image"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Modifier
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (f) await handleReplaceGalleryImage(colorIdx, galleryIdx, f);
                                  e.target.value = '';
                                }}
                                hidden
                              />
                            </label>

                            {/* Principale Gallery Image */}
                            <button
                              type="button"
                              className={`admin_overlay_btn admin_overlay_btn_primary ${isMain ? 'is_primary' : ''}`}
                              disabled={isMain}
                              title={isMain ? 'Image principale actuelle' : 'Définir comme principale'}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isMain) updateDraftField('mainImage', galleryImg);
                              }}
                            >
                              Principale
                            </button>
                          </div>
                          <img src={galleryImg} alt="" />
                        </div>
                      );
                    })}

                    {/* Add Gallery Image for this specific color (Requirement 8) */}
                    <label
                      className="thumb_box_vertical admin_add_gallery_box"
                      title={`Ajouter une image galerie pour ${color.name || 'cette couleur'}`}
                    >
                      <img src="/pictures/add.png" alt="Ajouter" className="admin_add_gallery_icon" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) await handleAddGalleryImage(colorIdx, f);
                          e.target.value = '';
                        }}
                        hidden
                      />
                    </label>
                  </div>
                );
              })
            ) : (
              // Normal Customer view vertical images
              allThumbnails.map((thumb, index) => {
                const isSelected =
                  mainImage === thumb.src &&
                  (thumb.colorId && selectedColor?.id ? thumb.colorId === selectedColor.id : true);
                return (
                  <button
                    key={`${thumb.src}-${thumb.colorId || ''}-${index}`}
                    type="button"
                    className={`thumb_box_vertical${isSelected ? ' active' : ''}`}
                    onClick={() => handleThumbnailSelect(thumb, index)}
                  >
                    <img
                      src={imageVariantPath(thumb.src, 'card')}
                      alt={photoAlt(thumb)}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            className="scroll_arrow"
            onClick={() => handleVerticalArrow('down')}
            aria-label={t('marquee.down')}
          >
            <span className="scroll_arrow_icon_vertical">❯</span>
          </button>

        </div>

        {/* Main Featured Zoomable Image and Section Actions */}
        <div className="main_image_column">
          <div
            className="main_image_container"
            onClick={(e) => {
              const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - top) / height) * 100));
              setZoomPos({ x, y });
              setIsZoomed((prev) => !prev);
            }}
            onMouseMove={(e) => {
              if (!isZoomed) return;
              const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - top) / height) * 100));
              setZoomPos({ x, y });
            }}
            onMouseLeave={() => setIsZoomed(false)}
          >
            <ProductBadges product={activeProduct} />
            <img
              className="main_product_img"
              src={imageVariantPath(mainImage || activeProduct.mainImage, 'large')}
              alt={photoAlt(mainImageThumb)}
              fetchPriority="high"
              decoding="async"
              style={{
                transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                transform: isZoomed ? 'scale(2.2)' : 'scale(1)',
                transition: isZoomed
                  ? 'transform-origin 0.05s ease-out, transform 0.15s ease-out'
                  : 'transform 0.25s ease-out',
                cursor: isZoomed ? 'zoom-out' : 'zoom-in',
              }}
            />
          </div>

          <div className="product_section_actions">
            <button
              type="button"
              className="product_section_btn"
              onClick={() => scrollToSection('product_videos_section')}
            >
              {t('product.seeVideo')}
            </button>
            <button
              type="button"
              className="product_section_btn"
              onClick={() => scrollToSection('product_reviews_container')}
            >
              {t('product.seeReviews')}
            </button>
          </div>
        </div>

        {/* Product Details Panel (Right) */}
        <div className="product_info_panel">
          {/* Product Title (Inline editable in edit mode) */}
          {isEditing ? (
            <input
              type="text"
              className="admin_inline_title"
              value={draft.name}
              placeholder="Nom du produit"
              onChange={(e) => updateDraftField('name', e.target.value)}
            />
          ) : (
            <h1 className="product_title">{productName(activeProduct, locale)}</h1>
          )}

          <h2 className="section_subtitle">{t('product.details')}</h2>

          {/* Product Description (Inline editable in edit mode) */}
          {isEditing ? (
            <textarea
              className="admin_inline_desc"
              value={draft.description}
              placeholder="Description du produit..."
              onChange={(e) => updateDraftField('description', e.target.value)}
            />
          ) : (
            <p className="product_description">{productDescription(activeProduct, locale)}</p>
          )}

          {isEditing && (
            <>
              <input
                type="text"
                className="admin_inline_title"
                dir="rtl"
                lang="ar"
                value={draft.nameAr || ''}
                placeholder="الاسم بالعربية (اختياري)"
                onChange={(e) => updateDraftField('nameAr', e.target.value)}
              />
              <textarea
                className="admin_inline_desc"
                dir="rtl"
                lang="ar"
                value={draft.descriptionAr || ''}
                placeholder="الوصف بالعربية (اختياري)"
                onChange={(e) => updateDraftField('descriptionAr', e.target.value)}
              />
            </>
          )}

          {/* Color Section */}
          {(activeProduct.colors?.length > 0 || isEditing) && (
            <div className="color_section">
              <div className="color_header_line">
                <span className="section_subtitle" style={{ marginBottom: 0 }}>
                  {t('product.color')}
                </span>
                {isEditing && selectedColor ? (
                  <input
                    type="text"
                    className="admin_inline_color_name_input"
                    value={selectedColor.name || ''}
                    placeholder="Nom de la couleur"
                    maxLength={20}
                    onChange={(e) => {
                      const val = e.target.value.slice(0, 20);
                      const colorIdx = draft.colors.findIndex(
                        (c, i) => c === selectedColor || c.id === selectedColor.id || `color-${i}` === selectedColor.id,
                      );
                      if (colorIdx !== -1) {
                        const newId = slugify(val) || `color-${colorIdx}`;
                        updateDraftColor(colorIdx, 'name', val);
                        setSelectedColor((prev) => ({
                          ...prev,
                          name: val,
                          id: newId,
                        }));
                      }
                    }}
                  />
                ) : (
                  <span className="selected_value_text">
                    {selectedColor?.name ? colorLabel(selectedColor.name, activeProduct) : t('product.chooseColor')}
                  </span>
                )}
                {isEditing && selectedColor && (
                  <input
                    type="text"
                    className="admin_inline_color_name_input"
                    dir="rtl"
                    lang="ar"
                    value={selectedColor.nameAr || ''}
                    placeholder="اسم اللون بالعربية (اختياري)"
                    maxLength={30}
                    onChange={(e) => {
                      const val = e.target.value.slice(0, 30);
                      const colorIdx = draft.colors.findIndex(
                        (c, i) => c === selectedColor || c.id === selectedColor.id || `color-${i}` === selectedColor.id,
                      );
                      if (colorIdx !== -1) {
                        updateDraftColor(colorIdx, 'nameAr', val);
                        setSelectedColor((prev) => ({ ...prev, nameAr: val }));
                      }
                    }}
                  />
                )}
              </div>

              <div className="color_carousel_wrapper">
                <button
                  type="button"
                  className="scroll_arrow"
                  onClick={() => handleHorizontalArrow('left')}
                  aria-label={t('marquee.left')}
                >
                  ❮
                </button>

                <div className="horizontal_colors_track" ref={colorTrackRef}>
                  {isEditing && draft ? (
                    // Edit mode horizontal color thumbnails
                    <>
                      {draft.colors.map((color, colorIdx) => {
                        const colorMainImage =
                          color.thumbnail || color.images?.[0] || color.image || '';
                        const isMain = draft.mainImage === color.thumbnail;

                        if (colorMainImage) {
                          return (
                            <div
                              key={color.id || colorIdx}
                              className={`color_thumb_box${
                                selectedColor?.id === color.id ? ' active' : ''
                              }`}
                              onClick={() => handleColorSelect(color)}
                              title={color.name}
                            >
                              <div className="admin_image_overlay">
                                {/* Supprimer la couleur (Requirement 9) */}
                                <button
                                  type="button"
                                  className="admin_overlay_btn admin_overlay_btn_delete"
                                  title="Supprimer toute la couleur"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveColor(colorIdx);
                                  }}
                                >
                                  Supprimer
                                </button>

                                {/* Modifier la miniature de la couleur (Requirement 9) */}
                                <label
                                  className="admin_overlay_btn admin_overlay_btn_edit"
                                  title="Remplacer la miniature"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Modifier
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={async (e) => {
                                      const f = e.target.files?.[0];
                                      if (f) await handleReplaceThumbnail(colorIdx, f);
                                      e.target.value = '';
                                    }}
                                    hidden
                                  />
                                </label>

                                {/* Principale miniature (Requirement 9) */}
                                <button
                                  type="button"
                                  className={`admin_overlay_btn admin_overlay_btn_primary ${
                                    isMain ? 'is_primary' : ''
                                  }`}
                                  disabled={isMain}
                                  title={
                                    isMain
                                      ? 'Image principale actuelle'
                                      : 'Définir comme principale'
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isMain && color.thumbnail) {
                                      updateDraftField('mainImage', color.thumbnail);
                                    }
                                  }}
                                >
                                  Principale
                                </button>
                              </div>
                              <img src={colorMainImage} alt={color.name} />
                            </div>
                          );
                        }

                        // Placeholder for new empty color thumbnail
                        return (
                          <label
                            key={color.id || colorIdx}
                            className={`color_thumb_box admin_add_color_box${
                              selectedColor?.id === color.id ? ' active' : ''
                            }`}
                            title="Téléverser une miniature"
                            onClick={() => handleColorSelect(color)}
                          >
                            <img
                              src="/pictures/add.png"
                              alt="Ajouter"
                              className="admin_add_color_icon"
                            />
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (f) await handleUploadThumbnail(colorIdx, f);
                                e.target.value = '';
                              }}
                              hidden
                            />
                          </label>
                        );
                      })}

                      {/* Add Color Button (Requirement 10) */}
                      <button
                        type="button"
                        className="color_thumb_box admin_add_color_box"
                        title="Ajouter une nouvelle couleur"
                        onClick={handleAddColor}
                      >
                        <img
                          src="/pictures/add.png"
                          alt="+ Couleur"
                          className="admin_add_color_icon"
                        />
                      </button>
                    </>
                  ) : (
                    // Customer view horizontal color swatches
                    activeProduct.colors.map((color) => {
                      const colorMainImage =
                        color.thumbnail || color.images?.[0] || color.image || activeProduct.mainImage;
                      const isColorUnavailable =
                        activeProduct.sizes?.length > 0
                          ? selectedSize
                            ? getAvailableStock(activeProduct, color.id, selectedSize) <= 0
                            : activeProduct.sizes.every(
                                (s) => getAvailableStock(activeProduct, color.id, s) <= 0,
                              )
                          : getAvailableStock(activeProduct, color.id, null) <= 0;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          className={`color_thumb_box${
                            selectedColor?.id === color.id ? ' active' : ''
                          }${isColorUnavailable ? ' unavailable' : ''}`}
                          onClick={() => handleColorSelect(color)}
                          title={isColorUnavailable ? t('product.colorUnavailable', { name: colorLabel(color.name, activeProduct) }) : colorLabel(color.name, activeProduct)}
                        >
                          <img src={colorMainImage} alt={colorLabel(color.name, activeProduct)} />
                        </button>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  className="scroll_arrow"
                  onClick={() => handleHorizontalArrow('right')}
                  aria-label={t('marquee.right')}
                >
                  ❯
                </button>
              </div>
            </div>
          )}

          {/* Sizes Section */}
          {(activeProduct.sizes?.length > 0 || isEditing) && (
            <div className="size_section">
              <div className="color_header_line">
                <span className="section_subtitle" style={{ marginBottom: 0 }}>
                  {t('product.sizeLabel')}
                </span>
                <span className="selected_value_text">
                  {selectedSize ? t('product.sizeValue', { size: selectedSize }) : t('product.chooseSize')}
                </span>
              </div>

              <div className="sizes_grid">
                {isEditing && draft ? (
                  // Edit mode sizes with inline inputs and delete buttons
                  <>
                    {draft.sizes.map((size, i) => (
                      <div key={i} className="admin_size_box_editable">
                        <input
                          type="text"
                          className="admin_size_input"
                          value={size}
                          placeholder="38"
                          maxLength={2}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          onChange={(e) => handleUpdateSize(i, e.target.value)}
                        />
                        <button
                          type="button"
                          className="admin_size_remove_btn"
                          title="Supprimer la taille"
                          onClick={() => handleRemoveSize(i)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {/* Add Size Button (Requirement 11) */}
                    <button
                      type="button"
                      className="admin_add_size_btn"
                      title="Ajouter une taille"
                      onClick={handleAddSize}
                    >
                      +
                    </button>
                  </>
                ) : (
                  // Customer view size boxes
                  activeProduct.sizes.map((size) => {
                    const isSizeUnavailable =
                      activeProduct.colors?.length > 0
                        ? selectedColor
                          ? getAvailableStock(activeProduct, selectedColor.id, size) <= 0
                          : activeProduct.colors.every(
                              (c) => getAvailableStock(activeProduct, c.id, size) <= 0,
                            )
                        : getAvailableStock(activeProduct, null, size) <= 0;
                    return (
                      <button
                        key={size}
                        type="button"
                        className={`size_box${isSizeUnavailable ? ' unavailable' : ''}`}
                        style={selectedSize === size ? { backgroundColor: '#000', color: '#fff' } : undefined}
                        onClick={() => {
                          setSelectedSize(size);
                          setCartMessage('');
                        }}
                        title={isSizeUnavailable ? t('product.sizeUnavailable', { size }) : t('product.sizeValue', { size })}
                      >
                        {size}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Stock par variante Collapsible Section (Requirement 12) */}
          {isEditing && draft && (
            <div className="admin_stock_collapsible">
              <button
                type="button"
                className="admin_stock_header"
                onClick={() => setStockExpanded((prev) => !prev)}
              >
                <span>Stock par variante</span>
                <span className={`admin_stock_chevron ${stockExpanded ? 'open' : ''}`}>
                  {stockExpanded ? '▼' : '▶'}
                </span>
              </button>

              {stockExpanded && (
                <div className="admin_stock_content">
                  {(() => {
                    const stockMatrix = buildStockMatrix(draft);
                    if (stockMatrix.length === 0) {
                      return (
                        <p style={{ fontSize: 13, color: '#666' }}>
                          Ajoutez des couleurs et tailles pour gérer le stock.
                        </p>
                      );
                    }
                    return (
                      <table className="admin_stock_table">
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
                                  value={draft.stock[key] ?? 0}
                                  onChange={(e) => handleUpdateStock(key, e.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Collection Image Editing Card (Requirement 13) */}
          {isEditing && draft && (
            <div className="admin_collection_edit_card">
              <div className="admin_collection_edit_left">
                {draft.collectionImage ? (
                  <img
                    src={draft.collectionImage}
                    alt="Collection"
                    className="admin_collection_thumb_preview"
                  />
                ) : (
                  <div
                    className="admin_collection_thumb_preview"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: '#888',
                    }}
                  >
                    Aucune
                  </div>
                )}
                <div>
                  <strong style={{ fontSize: 13, display: 'block', color: '#111827' }}>
                    Image de collection (accueil)
                  </strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    Utilisée pour le catalogue et les cartes de recommandation
                  </span>
                </div>
              </div>
              <label className="admin_collection_upload_btn">
                {draft.collectionImage ? 'Remplacer' : 'Téléverser'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await handleUploadCollectionImage(f);
                    e.target.value = '';
                  }}
                  hidden
                />
              </label>
            </div>
          )}

          {/* Product Videos Editing Card (Admin) */}
          {isEditing && draft && (
            <div className="admin_videos_edit_card">
              <div className="admin_videos_header">
                <div>
                  <strong style={{ fontSize: 13, display: 'block', color: '#111827' }}>
                    Vidéos du produit ({draft.videos?.length || 0})
                  </strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    Affichées dans la section vidéo (format 9:16)
                  </span>
                </div>
                <label className="admin_collection_upload_btn">
                  {videoUploading ? 'Téléversement...' : '+ Ajouter une vidéo'}
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/ogg,video/quicktime"
                    disabled={videoUploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) await handleUploadVideo(f);
                      e.target.value = '';
                    }}
                    hidden
                  />
                </label>
              </div>

              {draft.videos?.length > 0 && (
                <div className="admin_videos_list">
                  {draft.videos.map((v, i) => (
                    <div key={v.id || i} className="admin_video_item">
                      <div className="admin_video_item_left">
                        <video src={v.videoUrl} className="admin_video_item_preview" muted preload="metadata" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
                          Vidéo {i + 1}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="admin_video_delete_btn"
                        onClick={() => setVideoToDelete(v)}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Price & Discount Section (Inline editable in edit mode - Requirement 5) */}
          {isEditing && draft ? (
            <div className="admin_price_edit_container">
              <div className="admin_price_row">
                <div className="admin_price_field">
                  <label>Prix (TND):</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    className="admin_inline_num_input"
                    value={draft.price}
                    onChange={(e) => updateDraftField('price', e.target.value)}
                  />
                </div>
                <div className="admin_price_field">
                  <label>Remise (TND):</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    className="admin_inline_num_input"
                    value={draft.discount ?? 0}
                    onChange={(e) => updateDraftField('discount', e.target.value)}
                  />
                </div>
              </div>
              {Number(draft.discount) > 0 && (
                <div className="admin_discount_preview_text">
                  Prix effectif après remise : <strong>{formatPrice(getEffectivePrice(draft))}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="price_section">
              <span className="price_label">{t('product.price')}</span>
              <ProductPrice product={activeProduct} size="large" />
            </div>
          )}

          {/* Action Row, Stock, Buy Now, Guarantees — hidden in edit mode */}
          {!isEditing && (
            <>
              {/* Action Row */}
              <div className="action_row">
                <div className="quantity_wrapper">
                  <div className="quantity_box">
                    <button
                      type="button"
                      className="qty_btn"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    >
                      -
                    </button>
                    <input type="text" value={quantity} readOnly className="qty_input" />
                    <button
                      type="button"
                      className="qty_btn"
                      onClick={() => setQuantity((q) => Math.min(q + 1, Math.max(availableStock, 1)))}
                    >
                      +
                    </button>
                  </div>
                  <span className="qty_label">{t('product.qty')}</span>
                </div>

                <button type="button" className="add_to_cart_btn" onClick={handleAddToCart}>
                  {t('product.addToCart')}
                </button>

                <button
                  type="button"
                  className={`icon_action_btn${isFav ? ' icon_action_btn_active' : ''}`}
                  onClick={() => {
                    if (isAdmin) {
                      setCartMessage(t('product.adminFav'));
                      return;
                    }
                    toggleFavorite({
                      productId: activeProduct.id,
                      variantId: currentVariant?.id ?? null,
                      colorId: selectedColor?.id ?? null,
                      size: selectedSize ?? null,
                    });
                  }}
                >
                  <div className="custom_icon_gap">
                    <img src="/pictures/heart.png" alt={t('product.fav')} />
                  </div>
                  <span>{isFav ? t('product.favAdded') : t('product.fav')}</span>
                </button>

                <button type="button" className="icon_action_btn" onClick={handleShare}>
                  <div className="custom_icon_gap">
                    <img src="/pictures/share.png" alt={t('product.share')} />
                  </div>
                  <span>{t('product.share')}</span>
                </button>
              </div>

              {cartMessage && <p className="stock_status_text stock_status_message">{cartMessage}</p>}

              <p
                className={`stock_status_text stock_${
                  stockStatus.status || (stockStatus.inStock ? 'available' : 'out')
                }${stockStatus.inStock ? '' : ' out-of-stock'}`}
              >
                <span className="stock_bullet">•</span> {t('product.stockLabel')} {stockText}
              </p>

              <button type="button" className="buy_now_btn" onClick={handleCommander}>
                {t('product.order')}
              </button>

              <div className="guarantee_row">
                <div className="badge_icon_gap">
                  <img src="/pictures/truckdilevery.png" alt={t('product.deliveryAlt')} />
                </div>
                <span>{t('product.delivery')}</span>
              </div>

              <div className="guarantee_row">
                <div className="badge_icon_gap">
                  <img src="/pictures/echange.png" alt={t('product.exchangeAlt')} />
                </div>
                <span>{t('product.exchange')}</span>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ==========================================================================
         Product Videos Showcase Section
         ========================================================================== */}
      {activeProduct?.videos?.length > 0 && (
        <section className="product_videos_section" id="product_videos_section" aria-label={t('product.videosTitle')}>
          <h2 className="product_videos_title">{t('product.videosTitle')}</h2>

          {/* Main 9:16 Video Container with custom restricted controls (Play/Pause & Seekbar ONLY) */}
          <ProductVideoPlayer
            videoUrl={activeProduct.videos[selectedVideoIdx]?.videoUrl}
          />

          {/* Horizontal Video Carousel with left/right arrows */}
          {activeProduct.videos.length > 1 && (
            <div className="product_video_carousel_wrapper">
              <button
                type="button"
                className="scroll_arrow"
                onClick={() => handleVideoArrow('left')}
                disabled={selectedVideoIdx === 0}
                aria-label={t('product.videoPrev')}
              >
                ❮
              </button>

              <div className="product_video_track" ref={videoTrackRef}>
                {activeProduct.videos.map((vid, idx) => {
                  const isActive = idx === selectedVideoIdx;
                  return (
                    <button
                      key={vid.id || idx}
                      type="button"
                      className={`product_video_thumb_box${isActive ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedVideoIdx(idx);
                        if (videoTrackRef.current) {
                          const buttons = videoTrackRef.current.querySelectorAll('.product_video_thumb_box');
                          if (buttons[idx]) {
                            buttons[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                          }
                        }
                      }}
                      aria-label={t('product.videoN', { n: idx + 1 })}
                    >
                      <video src={vid.videoUrl} muted preload="metadata" />
                      <span className="product_video_thumb_play_icon">▶</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="scroll_arrow"
                onClick={() => handleVideoArrow('right')}
                disabled={selectedVideoIdx === activeProduct.videos.length - 1}
                aria-label={t('product.videoNext')}
              >
                ❯
              </button>
            </div>
          )}
        </section>
      )}

      <ProductReviewsSection productId={activeProduct.id} />

      {recommendations.length > 0 && (
        <section className="recommendations_section">
          <h2 className="recommendations_title">{t('product.recommended')}</h2>

          <div className="recommendations_grid">
            {recommendations.map((rec) => (
              <div key={rec.id} className={`product_card${rec.isHidden ? ' product_card--hidden' : ''}`}>
                <Link to={productPath(rec)} className="product_card_link">
                  <div className="product_card_img_wrapper">
                    <ProductBadges product={rec} />
                    <img
                      src={imageVariantPath(rec.collectionImage || rec.mainImage, 'card')}
                      alt={productName(rec, locale)}
                      className="product_card_img"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <h3 className="product_card_title">{productName(rec, locale)}</h3>
                  <p className="product_card_price">
                    <ProductPrice product={rec} size="small" />
                  </p>
                </Link>
              </div>
            ))}
          </div>

          <div className="recommendations_cta_wrapper">
            <Link to={`/collection/${activeProduct.category}`} className="collection_btn">
              {t(activeProduct.category === 'femme' ? 'collection.fullWomen' : 'collection.fullKids')}
            </Link>
          </div>
        </section>
      )}

      <BuyNowModal
        isOpen={buyNowModalOpen}
        onClose={() => setBuyNowModalOpen(false)}
        buyNowItem={buyNowItem}
      />

      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        product={activeProduct}
        image={mainImage || activeProduct?.mainImage}
        price={getEffectivePrice(activeProduct)}
      />

      {/* Video Delete Confirmation Modal */}
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
    </>
  );
}
