import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';

export default function InfiniteMarquee({
  children,
  orientation = 'horizontal', // 'horizontal' | 'vertical'
  direction = 'normal', // 'normal' (left/top) or 'reverse'
  speed = 30, // pixels per second matching announcement bar
  stepAmount,
  showArrows = true,
  className = '',
}) {
  const { t } = useT();
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const sequenceRef = useRef(null);
  const posRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef(0);
  const startPosRef = useRef(0);
  const dragMovedRef = useRef(false);
  const justDraggedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const isVertical = orientation === 'vertical';

  const updateTransform = useCallback(() => {
    if (!trackRef.current) return;
    if (isVertical) {
      trackRef.current.style.transform = `translate3d(0, -${posRef.current}px, 0)`;
    } else {
      trackRef.current.style.transform = `translate3d(-${posRef.current}px, 0, 0)`;
    }
  }, [isVertical]);

  useEffect(() => {
    let rafId;
    let lastTime = performance.now();

    const step = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (!isDraggingRef.current) {
        const seq = sequenceRef.current;
        const size = seq ? (isVertical ? seq.offsetHeight : seq.offsetWidth) : 0;

        if (size > 0) {
          const moveDir = direction === 'reverse' ? -1 : 1;
          posRef.current += moveDir * speed * dt;

          while (posRef.current >= size) {
            posRef.current -= size;
          }
          while (posRef.current < 0) {
            posRef.current += size;
          }

          updateTransform();
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [speed, isVertical, direction, updateTransform]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e) => {
      if (isVertical) {
        if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && Math.abs(e.deltaY) > 0) {
          const seq = sequenceRef.current;
          const size = seq ? seq.offsetHeight : 0;
          if (size > 0) {
            e.preventDefault();
            posRef.current += e.deltaY;
            while (posRef.current >= size) posRef.current -= size;
            while (posRef.current < 0) posRef.current += size;
            updateTransform();
          }
        }
      } else {
        const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (delta !== 0) {
          const seq = sequenceRef.current;
          const size = seq ? seq.offsetWidth : 0;
          if (size > 0) {
            e.preventDefault();
            posRef.current += delta;
            while (posRef.current >= size) posRef.current -= size;
            while (posRef.current < 0) posRef.current += size;
            updateTransform();
          }
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isVertical, updateTransform]);

  const handleArrowClick = (dirMultiplier) => {
    const seq = sequenceRef.current;
    const size = seq ? (isVertical ? seq.offsetHeight : seq.offsetWidth) : 0;
    if (!size) return;

    const step = stepAmount || (isVertical ? 120 : 255);
    posRef.current += dirMultiplier * step;

    while (posRef.current >= size) {
      posRef.current -= size;
    }
    while (posRef.current < 0) {
      posRef.current += size;
    }

    updateTransform();
  };

  const handlePointerDown = (e) => {
    if (e.target.closest('.ticker_arrow_btn')) return;
    if (e.button !== undefined && e.button !== 0) return;
    isDraggingRef.current = true;
    dragMovedRef.current = false;
    dragStartRef.current = isVertical ? e.clientY : e.clientX;
    startPosRef.current = posRef.current;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return;
    const current = isVertical ? e.clientY : e.clientX;
    const delta = dragStartRef.current - current;
    if (Math.abs(delta) > 3) {
      dragMovedRef.current = true;
    }
    const seq = sequenceRef.current;
    const size = seq ? (isVertical ? seq.offsetHeight : seq.offsetWidth) : 0;

    if (size > 0) {
      let newPos = startPosRef.current + delta;
      while (newPos >= size) {
        newPos -= size;
      }
      while (newPos < 0) {
        newPos += size;
      }
      posRef.current = newPos;
      updateTransform();
    }
  };

  const handlePointerUp = (e) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    if (dragMovedRef.current) {
      justDraggedRef.current = true;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerCancel = (e) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleClickCapture = (e) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  };

  return (
    <div className={`infinite_marquee ${orientation} ${className}`}>
      <div
        ref={viewportRef}
        className={`infinite_marquee_viewport${isDragging ? ' is_dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClickCapture={handleClickCapture}
      >
        <div ref={trackRef} className="infinite_marquee_track">
          <div ref={sequenceRef} className={`infinite_marquee_sequence ${orientation}`}>
            {children}
          </div>
          <div className={`infinite_marquee_sequence ${orientation}`} aria-hidden="true">
            {children}
          </div>
        </div>
      </div>

      {showArrows && (
        <>
          <button
            type="button"
            className={`ticker_arrow_btn ticker_arrow_${isVertical ? 'up' : 'left'}`}
            onClick={(e) => {
              e.stopPropagation();
              handleArrowClick(-1);
            }}
            aria-label={isVertical ? t('marquee.up') : t('marquee.left')}
          >
            <span className={isVertical ? 'ticker_arrow_icon_vertical' : undefined}>❮</span>
          </button>
          <button
            type="button"
            className={`ticker_arrow_btn ticker_arrow_${isVertical ? 'down' : 'right'}`}
            onClick={(e) => {
              e.stopPropagation();
              handleArrowClick(1);
            }}
            aria-label={isVertical ? t('marquee.down') : t('marquee.right')}
          >
            <span className={isVertical ? 'ticker_arrow_icon_vertical' : undefined}>❯</span>
          </button>
        </>
      )}
    </div>
  );
}

