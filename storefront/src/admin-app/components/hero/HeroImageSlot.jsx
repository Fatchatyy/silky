import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { adminApi as api } from '../../../admin/adminApi';
import { heroUploads } from './heroUploads';
import '../../styles/hero-editor.css';

export default function HeroImageSlot({
  imageUrl,
  imagePos = { x: 50, y: 50, zoom: 100 },
  onImageChange,
  onPositionChange,
  children,
  className = '',
  style = {},
}) {
  const [uploading, setUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const slotRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, startX: 50, startY: 50 });

  const posX = typeof imagePos?.x === 'number' ? imagePos.x : 50;
  const posY = typeof imagePos?.y === 'number' ? imagePos.y : 50;
  const zoom = typeof imagePos?.zoom === 'number' ? imagePos.zoom : 100;

  const handleFileSelect = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.uploadThemeImage(formData);
      if (res?.url) {
        onImageChange(heroUploads.track(res.url));
      }
    } catch (err) {
      console.error('Failed to upload hero image:', err);
      // The server refused the file itself (wrong content, too large...): say so instead of embedding it as a data URL.
      if (err?.status >= 400 && err?.status < 500) {
        window.alert(err.message);
        return;
      }
      // Fallback to data URL if local test or offline
      const reader = new FileReader();
      reader.onload = (e) => onImageChange(e.target.result);
      reader.readAsDataURL(file);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    setIsEditing(false);
    onImageChange('');
    onPositionChange?.({ x: 50, y: 50, zoom: 100 });
  };

  const imagePosRef = useRef({ x: posX, y: posY, zoom });
  useEffect(() => {
    imagePosRef.current = { x: posX, y: posY, zoom };
  }, [posX, posY, zoom]);

  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  // Non-passive wheel event listener on slot element to reliably prevent page scroll
  useEffect(() => {
    const slotEl = slotRef.current;
    if (!slotEl) return;

    const handleNativeWheel = (e) => {
      if (!isEditing || !imageUrl) return;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY < 0 ? 5 : -5;
      const currentZoom = imagePosRef.current?.zoom ?? 100;
      const newZoom = Math.max(100, Math.min(300, currentZoom + delta));
      onPositionChangeRef.current?.({
        x: imagePosRef.current?.x ?? 50,
        y: imagePosRef.current?.y ?? 50,
        zoom: newZoom,
      });
    };

    slotEl.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      slotEl.removeEventListener('wheel', handleNativeWheel);
    };
  }, [isEditing, imageUrl]);

  // Drag start
  const handleMouseDown = (e) => {
    if (!isEditing || !imageUrl) return;
    // Don't drag if clicking buttons, inputs or banners
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.hero_image_direct_edit_banner')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: posX,
      startY: posY,
    };
  };

  // Drag move & Drag end
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!slotRef.current) return;
      const rect = slotRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartRef.current.clientX;
      const deltaY = e.clientY - dragStartRef.current.clientY;

      // Calculate shift in percentage relative to slot dimensions
      const width = rect.width || 400;
      const height = rect.height || 400;

      const shiftX = (deltaX / width) * 100;
      const shiftY = (deltaY / height) * 100;

      // Invert delta so dragging image left moves background focal point
      const nextX = Math.max(0, Math.min(100, dragStartRef.current.startX - shiftX));
      const nextY = Math.max(0, Math.min(100, dragStartRef.current.startY - shiftY));

      onPositionChange?.({
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
        zoom,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, zoom, onPositionChange]);

  const imageTransformStyle = {
    backgroundImage: imageUrl ? `url(${mediaUrl(imageUrl)})` : 'none',
    backgroundPosition: `${posX}% ${posY}%`,
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
    transformOrigin: `${posX}% ${posY}%`,
  };

  const isCustomized = posX !== 50 || posY !== 50 || zoom !== 100;

  return (
    <div
      ref={slotRef}
      className={`hero_image_slot ${className}${isEditing ? ' is_editing_image' : ''}`}
      style={style}
      onMouseDown={handleMouseDown}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFileSelect(e.target.files?.[0])}
      />

      {imageUrl ? (
        <>
          <div
            className="hero_image_slot_bg"
            style={{
              ...imageTransformStyle,
              cursor: isEditing ? (isDragging ? 'grabbing' : 'grab') : 'default',
            }}
          />

          {/* Active In-Place Image Editing Banner */}
          {isEditing && (
            <div className="hero_image_direct_edit_banner">
              <span className="hero_image_direct_edit_text">
                🎯 Glissez pour déplacer · Molette pour zoomer ({zoom}%)
              </span>
              {isCustomized && (
                <button
                  type="button"
                  className="hero_image_direct_edit_reset_btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPositionChange?.({ x: 50, y: 50, zoom: 100 });
                  }}
                >
                  Réinitialiser
                </button>
              )}
              <button
                type="button"
                className="hero_image_direct_edit_done_btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(false);
                }}
              >
                ✓ Terminer
              </button>
            </div>
          )}

          {/* Hover Overlay with Supprimer / Modifier / Remplacer when not in editing mode */}
          {!isEditing && (
            <div className="hero_image_hover_overlay">
              <button
                type="button"
                className="hero_overlay_action_btn delete"
                title="Supprimer l'image"
                onClick={handleRemove}
              >
                Supprimer
              </button>
              <button
                type="button"
                className="hero_overlay_action_btn edit"
                title="Ajuster directement dans le miniature"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
              >
                Modifier
              </button>
              <button
                type="button"
                className="hero_overlay_action_btn replace"
                title="Remplacer l'image"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Remplacer
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          className="hero_image_slot_empty"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <img src="/pictures/add.png" alt="Ajouter" className="hero_add_icon" />
          <span className="hero_add_text">
            {uploading ? 'Téléchargement...' : 'Ajouter une image'}
          </span>
        </div>
      )}

      {/* Children content (like CTA buttons, text, overlays) */}
      {children}
    </div>
  );
}
