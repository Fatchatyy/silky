import { useEffect, useRef, useState } from 'react';
import HeroImageSlot from './HeroImageSlot';
import HeroButtonEditor from './HeroButtonEditor';
import '../../styles/hero-editor.css';

const DESKTOP_REF_HEIGHT = 625;

export default function HeroEditorModal({
  heroConfig,
  onSave,
  onCancel,
}) {
  // Deep clone initial heroConfig into local draft
  const [draft, setDraft] = useState(() => {
    return JSON.parse(JSON.stringify(heroConfig));
  });

  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200
  );
  const previewWrapperRef = useRef(null);
  const [scale, setScale] = useState(0.85);

  const templateType = draft.templateType || 'option1';

  // State for slide index (Option 3)
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  // State for which button is currently being edited via popover: 'opt1_left', 'opt1_right', 'opt2_btn', 'opt3_btn'
  const [activeEditingBtn, setActiveEditingBtn] = useState(null);

  // Lock document body scroll while Hero Editor Modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Responsive scale & live viewport width synchronization
  useEffect(() => {
    const updateGeometry = () => {
      const currentVw = (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200;
      setViewportWidth(currentVw);
      if (previewWrapperRef.current) {
        const wrapperWidth = previewWrapperRef.current.clientWidth || 1000;
        const nextScale = wrapperWidth / currentVw;
        setScale(nextScale);
      }
    };

    updateGeometry();
    const resizeObserver = new ResizeObserver(updateGeometry);
    if (previewWrapperRef.current) {
      resizeObserver.observe(previewWrapperRef.current);
    }
    window.addEventListener('resize', updateGeometry);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateGeometry);
    };
  }, []);

  /* ==========================================================================
     Option 1 Helpers
     ========================================================================== */
  const opt1 = draft.option1 || {};

  const handleOpt1Change = (key, value) => {
    setDraft((prev) => ({
      ...prev,
      option1: {
        ...prev.option1,
        [key]: value,
      },
    }));
  };

  const handleOpt1ButtonUpdate = (side, buttonData) => {
    setDraft((prev) => ({
      ...prev,
      option1: {
        ...prev.option1,
        [`${side}Button`]: buttonData,
      },
    }));
    setActiveEditingBtn(null);
  };

  const handleOpt1ButtonDelete = (side) => {
    setDraft((prev) => ({
      ...prev,
      option1: {
        ...prev.option1,
        [`${side}Button`]: {
          ...prev.option1?.[`${side}Button`],
          visible: false,
        },
      },
    }));
  };

  const handleOpt1ButtonRestore = (side) => {
    setDraft((prev) => ({
      ...prev,
      option1: {
        ...prev.option1,
        [`${side}Button`]: {
          ...prev.option1?.[`${side}Button`],
          visible: true,
        },
      },
    }));
  };

  /* ==========================================================================
     Option 2 Helpers
     ========================================================================== */
  const opt2 = draft.option2 || {};

  const handleOpt2Change = (key, value) => {
    setDraft((prev) => ({
      ...prev,
      option2: {
        ...prev.option2,
        [key]: value,
      },
    }));
  };

  const handleToggleOpt2Position = () => {
    const nextPos = opt2.textPosition === 'right' ? 'left' : 'right';
    handleOpt2Change('textPosition', nextPos);
  };

  const handleOpt2ButtonUpdate = (buttonData) => {
    handleOpt2Change('button', buttonData);
    setActiveEditingBtn(null);
  };

  const handleOpt2ButtonDelete = () => {
    handleOpt2Change('button', { ...opt2.button, visible: false });
  };

  const handleOpt2ButtonRestore = () => {
    handleOpt2Change('button', { ...opt2.button, visible: true });
  };

  /* ==========================================================================
     Option 3 (Carousel) Helpers
     ========================================================================== */
  const slides = draft.option3?.slides || [];
  const currentSlide = slides[activeSlideIdx] || slides[0] || {};

  const handleCurrentSlideChange = (key, value) => {
    setDraft((prev) => {
      const nextSlides = [...(prev.option3?.slides || [])];
      nextSlides[activeSlideIdx] = {
        ...nextSlides[activeSlideIdx],
        [key]: value,
      };
      return {
        ...prev,
        option3: {
          ...prev.option3,
          slides: nextSlides,
        },
      };
    });
  };

  const handleToggleSlidePosition = () => {
    const nextPos = currentSlide.textPosition === 'right' ? 'left' : 'right';
    handleCurrentSlideChange('textPosition', nextPos);
  };

  const handleAddSlide = () => {
    if (slides.length >= 5) return;
    const newIdx = slides.length + 1;
    const newSlide = {
      id: `slide-${Date.now()}`,
      mainText: `Nouvelle collection ${newIdx}`,
      smallText: 'Tendances & qualité au meilleur prix',
      image: '/pictures/femme_example.jpg',
      imagePos: { x: 50, y: 50, zoom: 100 },
      textPosition: newIdx % 2 === 0 ? 'right' : 'left',
      button: { text: 'Découvrir', destination: '/collection/femme', visible: true },
    };
    setDraft((prev) => ({
      ...prev,
      option3: {
        ...prev.option3,
        slides: [...(prev.option3?.slides || []), newSlide],
      },
    }));
    setActiveSlideIdx(slides.length);
  };

  const handleRemoveSlide = () => {
    if (slides.length <= 2) return;
    setDraft((prev) => {
      const nextSlides = (prev.option3?.slides || []).filter((_, i) => i !== activeSlideIdx);
      return {
        ...prev,
        option3: {
          ...prev.option3,
          slides: nextSlides,
        },
      };
    });
    setActiveSlideIdx((prev) => Math.max(0, prev - 1));
  };

  const handleSlideButtonUpdate = (buttonData) => {
    handleCurrentSlideChange('button', buttonData);
    setActiveEditingBtn(null);
  };

  const handleSlideButtonDelete = () => {
    handleCurrentSlideChange('button', { ...currentSlide.button, visible: false });
  };

  const handleSlideButtonRestore = () => {
    handleCurrentSlideChange('button', { ...currentSlide.button, visible: true });
  };

  /* ==========================================================================
     Submit / Save / Cancel
     ========================================================================== */
  const handleSave = () => {
    onSave(draft);
  };

  return (
    <div className="hero_editor_modal_overlay" onClick={onCancel}>
      <div
        className="hero_editor_modal_card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="hero_editor_header">
          <h2>
            Éditeur Hero —{' '}
            {templateType === 'option1' && 'Option 1 (Deux Images)'}
            {templateType === 'option2' && 'Option 2 (Image Unique)'}
            {templateType === 'option3' && 'Option 3 (Carrousel Hero)'}
          </h2>
          <button
            type="button"
            className="hero_editor_close_btn"
            onClick={onCancel}
            aria-label="Fermer l'éditeur"
          >
            ✕
          </button>
        </div>

        {/* Modal Body / Scaled Live Desktop Preview */}
        <div className="hero_editor_body">
          <div
            ref={previewWrapperRef}
            className="hero_editor_preview_wrapper"
            style={{
              height: `${Math.round(DESKTOP_REF_HEIGHT * scale)}px`,
              minHeight: 'unset',
            }}
          >
            {/* Live Viewport Desktop Canvas (Uniformly Scaled Down) */}
            <div
              style={{
                width: `${viewportWidth}px`,
                height: `${DESKTOP_REF_HEIGHT}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
                boxSizing: 'border-box',
              }}
            >
              {/* -------------------------------------------------------------
                  OPTION 1 DESKTOP LIVE PREVIEW
                  ------------------------------------------------------------- */}
              {templateType === 'option1' && (
                <div className="hero_container" style={{ width: '100%', height: '100%', minHeight: '625px' }}>
                  {/* Editable Text Overlay - Exact Desktop Positioning */}
                  <div
                    className="hero_text_overlay"
                    style={{ pointerEvents: 'auto', zIndex: 10 }}
                  >
                    <input
                      type="text"
                      className="hero_editable_text_input hero_editable_title"
                      value={opt1.mainText ?? 'Découvrez nos collections'}
                      onChange={(e) => handleOpt1Change('mainText', e.target.value)}
                      placeholder="Grand titre principal..."
                    />
                    <input
                      type="text"
                      className="hero_editable_text_input hero_editable_subtitle"
                      value={opt1.smallText ?? 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix'}
                      onChange={(e) => handleOpt1Change('smallText', e.target.value)}
                      placeholder="Petit sous-titre..."
                    />
                  </div>

                  {/* Left Box Image Slot */}
                  <HeroImageSlot
                    className="hero_box left"
                    imageUrl={opt1.leftImage}
                    imagePos={opt1.leftImagePos}
                    onImageChange={(url) => handleOpt1Change('leftImage', url)}
                    onPositionChange={(pos) => handleOpt1Change('leftImagePos', pos)}
                  >
                    {/* Left Button with Hover Actions */}
                    <div className="hero_button_interactive_wrapper" style={{ zIndex: 2 }}>
                      {opt1.leftButton?.visible ? (
                        <>
                          <div className="hero_btn_hover_controls">
                            <button
                              type="button"
                              className="hero_btn_control_pill edit"
                              onClick={() => setActiveEditingBtn(activeEditingBtn === 'opt1_left' ? null : 'opt1_left')}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="hero_btn_control_pill delete"
                              onClick={() => handleOpt1ButtonDelete('left')}
                            >
                              Supprimer
                            </button>
                          </div>
                          <span className="cta_button" style={{ display: 'inline-block' }}>
                            {opt1.leftButton?.text || 'Femme'}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="hero_button_deleted_placeholder"
                          onClick={() => handleOpt1ButtonRestore('left')}
                        >
                          + Ajouter le bouton
                        </button>
                      )}

                      {activeEditingBtn === 'opt1_left' && (
                        <HeroButtonEditor
                          button={opt1.leftButton}
                          onSave={(btn) => handleOpt1ButtonUpdate('left', btn)}
                          onCancel={() => setActiveEditingBtn(null)}
                        />
                      )}
                    </div>
                  </HeroImageSlot>

                  {/* Right Box Image Slot */}
                  <HeroImageSlot
                    className="hero_box right"
                    imageUrl={opt1.rightImage}
                    imagePos={opt1.rightImagePos}
                    onImageChange={(url) => handleOpt1Change('rightImage', url)}
                    onPositionChange={(pos) => handleOpt1Change('rightImagePos', pos)}
                  >
                    {/* Right Button with Hover Actions */}
                    <div className="hero_button_interactive_wrapper" style={{ zIndex: 2 }}>
                      {opt1.rightButton?.visible ? (
                        <>
                          <div className="hero_btn_hover_controls">
                            <button
                              type="button"
                              className="hero_btn_control_pill edit"
                              onClick={() => setActiveEditingBtn(activeEditingBtn === 'opt1_right' ? null : 'opt1_right')}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="hero_btn_control_pill delete"
                              onClick={() => handleOpt1ButtonDelete('right')}
                            >
                              Supprimer
                            </button>
                          </div>
                          <span className="cta_button" style={{ display: 'inline-block' }}>
                            {opt1.rightButton?.text || 'Enfant'}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="hero_button_deleted_placeholder"
                          onClick={() => handleOpt1ButtonRestore('right')}
                        >
                          + Ajouter le bouton
                        </button>
                      )}

                      {activeEditingBtn === 'opt1_right' && (
                        <HeroButtonEditor
                          button={opt1.rightButton}
                          onSave={(btn) => handleOpt1ButtonUpdate('right', btn)}
                          onCancel={() => setActiveEditingBtn(null)}
                        />
                      )}
                    </div>
                  </HeroImageSlot>
                </div>
              )}

              {/* -------------------------------------------------------------
                  OPTION 2 DESKTOP LIVE PREVIEW
                  ------------------------------------------------------------- */}
              {templateType === 'option2' && (
                <HeroImageSlot
                  className="hero_single_container"
                  imageUrl={opt2.image}
                  imagePos={opt2.imagePos}
                  onImageChange={(url) => handleOpt2Change('image', url)}
                  onPositionChange={(pos) => handleOpt2Change('imagePos', pos)}
                  style={{ width: '100%', height: '100%', minHeight: '625px' }}
                >
                  <div
                    className={`hero_single_content ${opt2.textPosition === 'right' ? 'right' : 'left'}`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <input
                      type="text"
                      className="hero_editable_text_input hero_single_editable_title"
                      value={opt2.mainText ?? 'Découvrez nos collections'}
                      onChange={(e) => handleOpt2Change('mainText', e.target.value)}
                      placeholder="Grand titre principal..."
                      style={{
                        textAlign: opt2.textPosition === 'right' ? 'right' : 'left',
                      }}
                    />
                    <input
                      type="text"
                      className="hero_editable_text_input hero_single_editable_subtitle"
                      value={opt2.smallText ?? 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix'}
                      onChange={(e) => handleOpt2Change('smallText', e.target.value)}
                      placeholder="Petit sous-titre..."
                      style={{
                        textAlign: opt2.textPosition === 'right' ? 'right' : 'left',
                      }}
                    />

                    {/* Option 2 Button with Hover Actions */}
                    <div className="hero_button_interactive_wrapper">
                      {opt2.button?.visible ? (
                        <>
                          <div className="hero_btn_hover_controls">
                            <button
                              type="button"
                              className="hero_btn_control_pill edit"
                              onClick={() => setActiveEditingBtn(activeEditingBtn === 'opt2_btn' ? null : 'opt2_btn')}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="hero_btn_control_pill delete"
                              onClick={handleOpt2ButtonDelete}
                            >
                              Supprimer
                            </button>
                          </div>
                          <span className="cta_button" style={{ display: 'inline-block' }}>
                            {opt2.button?.text || 'Découvrir'}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="hero_button_deleted_placeholder"
                          onClick={handleOpt2ButtonRestore}
                        >
                          + Ajouter le bouton
                        </button>
                      )}

                      {activeEditingBtn === 'opt2_btn' && (
                        <HeroButtonEditor
                          button={opt2.button}
                          onSave={handleOpt2ButtonUpdate}
                          onCancel={() => setActiveEditingBtn(null)}
                        />
                      )}
                    </div>
                  </div>
                </HeroImageSlot>
              )}

              {/* -------------------------------------------------------------
                  OPTION 3 DESKTOP LIVE PREVIEW
                  ------------------------------------------------------------- */}
              {templateType === 'option3' && (
                <div className="hero_carousel_wrapper" style={{ width: '100%', height: '100%', minHeight: '625px' }}>
                  {/* Left/Right Carousel Nav Arrows inside Editor */}
                  <button
                    type="button"
                    className="hero_carousel_arrow hero_carousel_arrow_left"
                    onClick={() => setActiveSlideIdx((prev) => (prev > 0 ? prev - 1 : slides.length - 1))}
                    aria-label="Diapositive précédente"
                    style={{ zIndex: 30 }}
                  >
                    ❮
                  </button>
                  <button
                    type="button"
                    className="hero_carousel_arrow hero_carousel_arrow_right"
                    onClick={() => setActiveSlideIdx((prev) => (prev < slides.length - 1 ? prev + 1 : 0))}
                    aria-label="Diapositive suivante"
                    style={{ zIndex: 30 }}
                  >
                    ❯
                  </button>

                  {/* Current Slide Image Slot */}
                  <HeroImageSlot
                    className="hero_carousel_slide hero_single_container"
                    imageUrl={currentSlide.image}
                    imagePos={currentSlide.imagePos}
                    onImageChange={(url) => handleCurrentSlideChange('image', url)}
                    onPositionChange={(pos) => handleCurrentSlideChange('imagePos', pos)}
                    style={{ width: '100%', height: '100%', minHeight: '625px' }}
                  >
                    <div
                      className={`hero_single_content ${currentSlide.textPosition === 'right' ? 'right' : 'left'}`}
                      style={{ pointerEvents: 'auto' }}
                    >
                      <input
                        type="text"
                        className="hero_editable_text_input hero_single_editable_title"
                        value={currentSlide.mainText ?? ''}
                        onChange={(e) => handleCurrentSlideChange('mainText', e.target.value)}
                        placeholder="Grand titre de la diapositive..."
                        style={{
                          textAlign: currentSlide.textPosition === 'right' ? 'right' : 'left',
                        }}
                      />
                      <input
                        type="text"
                        className="hero_editable_text_input hero_single_editable_subtitle"
                        value={currentSlide.smallText ?? ''}
                        onChange={(e) => handleCurrentSlideChange('smallText', e.target.value)}
                        placeholder="Sous-titre..."
                        style={{
                          textAlign: currentSlide.textPosition === 'right' ? 'right' : 'left',
                        }}
                      />

                      {/* Slide Button with Hover Actions */}
                      <div className="hero_button_interactive_wrapper">
                        {currentSlide.button?.visible ? (
                          <>
                            <div className="hero_btn_hover_controls">
                              <button
                                type="button"
                                className="hero_btn_control_pill edit"
                                onClick={() => setActiveEditingBtn(activeEditingBtn === 'opt3_btn' ? null : 'opt3_btn')}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="hero_btn_control_pill delete"
                                onClick={handleSlideButtonDelete}
                              >
                                Supprimer
                              </button>
                            </div>
                            <span className="cta_button" style={{ display: 'inline-block' }}>
                              {currentSlide.button?.text || 'Découvrir'}
                            </span>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="hero_button_deleted_placeholder"
                            onClick={handleSlideButtonRestore}
                          >
                            + Ajouter le bouton
                          </button>
                        )}

                        {activeEditingBtn === 'opt3_btn' && (
                          <HeroButtonEditor
                            button={currentSlide.button}
                            onSave={handleSlideButtonUpdate}
                            onCancel={() => setActiveEditingBtn(null)}
                          />
                        )}
                      </div>
                    </div>
                  </HeroImageSlot>

                  {/* Carousel Dots Preview */}
                  {slides.length > 1 && (
                    <div className="hero_carousel_dots" style={{ zIndex: 20 }}>
                      {slides.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`hero_carousel_dot${activeSlideIdx === idx ? ' active' : ''}`}
                          onClick={() => setActiveSlideIdx(idx)}
                          aria-label={`Aller à la diapositive ${idx + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="hero_editor_footer">
          <div className="hero_editor_footer_left">
            {/* Option 2: Position Toggle */}
            {templateType === 'option2' && (
              <button
                type="button"
                className="admin-btn secondary sm"
                onClick={handleToggleOpt2Position}
              >
                ↔ Changer position (actuel : {opt2.textPosition === 'right' ? 'Droite' : 'Gauche'})
              </button>
            )}

            {/* Option 3: Slide Controls & Position Toggle */}
            {templateType === 'option3' && (
              <div className="hero_editor_slide_controls">
                <span className="hero_slide_indicator">
                  Diapositive <strong>{activeSlideIdx + 1}</strong> / {slides.length}
                </span>

                <button
                  type="button"
                  className="admin-btn secondary sm"
                  onClick={handleToggleSlidePosition}
                >
                  ↔ Position ({currentSlide.textPosition === 'right' ? 'Droite' : 'Gauche'})
                </button>

                {slides.length < 5 && (
                  <button
                    type="button"
                    className="admin-btn secondary sm"
                    onClick={handleAddSlide}
                  >
                    + Ajouter une diapositive
                  </button>
                )}

                {slides.length > 2 && (
                  <button
                    type="button"
                    className="admin-btn danger sm"
                    onClick={handleRemoveSlide}
                  >
                    Supprimer cette diapositive
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="hero_editor_footer_right">
            <button
              type="button"
              className="admin-btn secondary"
              onClick={onCancel}
            >
              Annuler
            </button>
            <button
              type="button"
              className="admin-btn primary"
              onClick={handleSave}
            >
              Sauvegarder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
