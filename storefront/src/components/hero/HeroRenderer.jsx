import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../lib/router';
import { mediaVariantUrl as imageVariantPath } from '@shared/media';
import { useT } from '../../i18n/useT';

const AUTO_ADVANCE_MS = 5000;

function getImageBgStyle(imageUrl, pos) {
  if (!imageUrl) return { backgroundImage: 'none' };
  const posX = typeof pos?.x === 'number' ? pos.x : 50;
  const posY = typeof pos?.y === 'number' ? pos.y : 50;
  const zoom = typeof pos?.zoom === 'number' ? Math.max(100, Math.min(300, pos.zoom)) : 100;
  return {
    backgroundImage: `url(${imageVariantPath(imageUrl, 'large')})`,
    backgroundPosition: `${posX}% ${posY}%`,
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
    transformOrigin: `${posX}% ${posY}%`,
  };
}

export default function HeroRenderer({ heroConfig: propConfig, theme }) {
  const { t, known, locale } = useT();
  // The text of the page language: the Arabic version the admin wrote when there is one, else the French text (translated
  // by `known` when it is one of the shop's standard phrases).
  const pick = (fr, ar) => (locale === 'ar' && typeof ar === 'string' && ar.trim() ? ar.trim() : known(fr));

  // Prefer passed prop (useful for live preview), fallback to theme.heroConfig or legacy theme properties
  const config = propConfig || theme?.heroConfig || {
    templateType: 'option1',
    option1: {
      mainText: 'Découvrez nos collections',
      smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
      leftImage: theme?.heroLeftImage || '/pictures/femme_example.jpg',
      rightImage: theme?.heroRightImage || '/pictures/enfant_example.jpg',
      leftButton: { text: 'Femme', destination: '/collection/femme', visible: true },
      rightButton: { text: 'Enfant', destination: '/collection/enfant', visible: true },
    },
  };

  const templateType = config.templateType || 'option1';

  /* ==========================================================================
     Option 3: Carousel Hero state & timer
     ========================================================================== */
  const slides = (config.option3?.slides?.length >= 2 ? config.option3.slides : [
    {
      id: 'slide-1',
      mainText: 'Découvrez nos collections',
      smallText: 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix',
      image: theme?.heroLeftImage || '/pictures/femme_example.jpg',
      textPosition: 'left',
      button: { text: 'Femme', destination: '/collection/femme', visible: true },
    },
    {
      id: 'slide-2',
      mainText: 'Nouvelle collection enfant',
      smallText: 'Tendances & qualité au meilleur prix',
      image: theme?.heroRightImage || '/pictures/enfant_example.jpg',
      textPosition: 'right',
      button: { text: 'Enfant', destination: '/collection/enfant', visible: true },
    },
  ]);

  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const goToSlide = useCallback((index) => {
    if (!slides.length) return;
    setActiveSlideIdx(((index % slides.length) + slides.length) % slides.length);
  }, [slides.length]);

  const nextSlide = useCallback(() => goToSlide(activeSlideIdx + 1), [activeSlideIdx, goToSlide]);
  const prevSlide = useCallback(() => goToSlide(activeSlideIdx - 1), [activeSlideIdx, goToSlide]);

  useEffect(() => {
    if (templateType !== 'option3' || isPaused || slides.length < 2) return;
    const timer = setInterval(() => {
      setActiveSlideIdx((i) => (i + 1) % slides.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [templateType, isPaused, slides.length]);

  /* ==========================================================================
     Option 1: Two-Image Hero
     ========================================================================== */
  if (templateType === 'option1') {
    const opt1 = config.option1 || {};
    const leftImg = opt1.leftImage !== undefined ? opt1.leftImage : (theme?.heroLeftImage || '/pictures/femme_example.jpg');
    const rightImg = opt1.rightImage !== undefined ? opt1.rightImage : (theme?.heroRightImage || '/pictures/enfant_example.jpg');
    const mainText = opt1.mainText !== undefined ? opt1.mainText : 'Découvrez nos collections';
    const smallText = opt1.smallText !== undefined ? opt1.smallText : 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix';
    const leftBtn = opt1.leftButton || { text: 'Femme', destination: '/collection/femme', visible: true };
    const rightBtn = opt1.rightButton || { text: 'Enfant', destination: '/collection/enfant', visible: true };

    return (
      <main className="hero_container" aria-label={t('hero.banner')}>
        {(mainText || smallText) && (
          <div className="hero_text_overlay">
            {mainText && <h1>{pick(mainText, opt1.mainTextAr)}</h1>}
            {smallText && <p>{pick(smallText, opt1.smallTextAr)}</p>}
          </div>
        )}

        <section className="hero_box left">
          <div
            className="hero_box_bg"
            style={getImageBgStyle(leftImg, opt1.leftImagePos)}
          />
          {leftBtn.visible && leftBtn.text && (
            <Link to={leftBtn.destination || '/collection/femme'} className="cta_button">
              {pick(leftBtn.text, leftBtn.textAr)}
            </Link>
          )}
        </section>

        <section className="hero_box right">
          <div
            className="hero_box_bg"
            style={getImageBgStyle(rightImg, opt1.rightImagePos)}
          />
          {rightBtn.visible && rightBtn.text && (
            <Link to={rightBtn.destination || '/collection/enfant'} className="cta_button">
              {pick(rightBtn.text, rightBtn.textAr)}
            </Link>
          )}
        </section>
      </main>
    );
  }

  /* ==========================================================================
     Option 2: Single Image Hero
     ========================================================================== */
  if (templateType === 'option2') {
    const opt2 = config.option2 || {};
    const img = opt2.image !== undefined ? opt2.image : (theme?.heroLeftImage || '/pictures/femme_example.jpg');
    const mainText = opt2.mainText !== undefined ? opt2.mainText : 'Découvrez nos collections';
    const smallText = opt2.smallText !== undefined ? opt2.smallText : 'Vêtements de trés haute qualité, trendy & classic au meilleurs prix';
    const position = opt2.textPosition === 'right' ? 'right' : 'left';
    const btn = opt2.button || { text: 'Découvrir', destination: '/collection/femme', visible: true };

    return (
      <main className="hero_single_container" aria-label={t('hero.banner')}>
        <div
          className="hero_single_bg"
          style={getImageBgStyle(img, opt2.imagePos)}
        />
        <div className={`hero_single_content ${position}`}>
          {mainText && <h1>{pick(mainText, opt2.mainTextAr)}</h1>}
          {smallText && <p>{pick(smallText, opt2.smallTextAr)}</p>}
          {btn.visible && btn.text && (
            <Link to={btn.destination || '/collection/femme'} className="cta_button">
              {pick(btn.text, btn.textAr)}
            </Link>
          )}
        </div>
      </main>
    );
  }

  /* ==========================================================================
     Option 3: Carousel Hero
     ========================================================================== */
  return (
    <main
      className="hero_carousel_wrapper"
      aria-label={t('hero.carousel')}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setIsPaused(false);
      }}
    >
      <div
        className="hero_carousel_track"
        style={{
          transform: `translateX(-${activeSlideIdx * 100}%)`,
        }}
      >
        {slides.map((slide, idx) => {
          const position = slide.textPosition === 'right' ? 'right' : 'left';
          const btn = slide.button || { text: 'Découvrir', destination: '/collection/femme', visible: true };
          const img = slide.image || '/pictures/femme_example.jpg';
          // The first slide's title is the home page's main heading; later slides use h2 so the page has one h1.
          const SlideHeading = idx === 0 ? 'h1' : 'h2';

          return (
            <div
              key={slide.id || `slide-${idx}`}
              className="hero_carousel_slide hero_single_container"
            >
              <div
                className="hero_single_bg"
                style={getImageBgStyle(img, slide.imagePos)}
              />
              <div className={`hero_single_content ${position}`}>
                {slide.mainText && <SlideHeading>{pick(slide.mainText, slide.mainTextAr)}</SlideHeading>}
                {slide.smallText && <p>{pick(slide.smallText, slide.smallTextAr)}</p>}
                {btn.visible && btn.text && (
                  <Link to={btn.destination || '/collection/femme'} className="cta_button">
                    {pick(btn.text, btn.textAr)}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {slides.length > 1 && (
        <>
          <button
            type="button"
            className="hero_carousel_arrow hero_carousel_arrow_left"
            onClick={prevSlide}
            aria-label={t('hero.prev')}
          >
            ❮
          </button>
          <button
            type="button"
            className="hero_carousel_arrow hero_carousel_arrow_right"
            onClick={nextSlide}
            aria-label={t('hero.next')}
          >
            ❯
          </button>

          <div className="hero_carousel_dots">
            {slides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`hero_carousel_dot${activeSlideIdx === idx ? ' active' : ''}`}
                onClick={() => goToSlide(idx)}
                aria-label={t('hero.goTo', { n: idx + 1 })}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
