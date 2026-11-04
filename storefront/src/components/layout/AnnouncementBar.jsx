import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { withIsland } from '../../lib/island';

const DEFAULT_ANNOUNCEMENTS = [
  { text: 'Livraison sur toute la Tunisie!', bold: false, italic: false, underline: false },
  { text: 'Livraison rapide en 24/48 heures', bold: false, italic: false, underline: false },
  { text: 'Qualité garantie', bold: false, italic: false, underline: false },
  { text: 'Promotions speciales et Offres exclusives!', bold: false, italic: false, underline: false },
  { text: 'Service client disponible 24/7', bold: false, italic: false, underline: false },
];

const SPEED_PX_PER_SEC = 40;

function Flag() {
  return <img src="/pictures/tnflag.jpg" alt="" className="flag_img" aria-hidden="true" />;
}

function AnnouncementTrack({ phrases, repeat = 1 }) {
  const items = [];
  for (let r = 0; r < repeat; r++) {
    phrases.forEach((item, i) => {
      const text = typeof item === 'string' ? item : (item?.text || '');
      const isBold = typeof item === 'object' && Boolean(item?.bold);
      const isItalic = typeof item === 'object' && Boolean(item?.italic);
      const isUnderline = typeof item === 'object' && Boolean(item?.underline);

      items.push(<Flag key={`flag-${r}-${i}`} />);
      items.push(
        <span
          key={`phrase-${r}-${i}`}
          className="announcement_text"
          style={{
            fontWeight: isBold ? 700 : 'normal',
            fontStyle: isItalic ? 'italic' : 'normal',
            textDecoration: isUnderline ? 'underline' : 'none',
          }}
        >
          {text}
        </span>,
      );
    });
  }
  return items;
}

function AnnouncementBar({ theme }) {
  const { t } = useT();
  const announcements = theme?.announcements !== undefined
    ? theme.announcements
    : DEFAULT_ANNOUNCEMENTS;
  const isHidden = Boolean(theme?.announcementsHidden);

  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [duration, setDuration] = useState(45);

  useEffect(() => {
    if (isHidden || !Array.isArray(announcements) || announcements.length === 0) {
      return;
    }

    const updateMeasurements = () => {
      if (!measureRef.current || !containerRef.current) return;
      const baseWidth = measureRef.current.offsetWidth || measureRef.current.getBoundingClientRect().width;
      const containerWidth = containerRef.current.offsetWidth || window.innerWidth || 1200;

      if (baseWidth <= 0) return;

      const neededRepeats = Math.max(1, Math.ceil(containerWidth / baseWidth));
      const sequenceWidth = baseWidth * neededRepeats;
      const calculatedDuration = Math.max(4, sequenceWidth / SPEED_PX_PER_SEC);

      setRepeatCount(neededRepeats);
      setDuration(calculatedDuration);
    };

    updateMeasurements();

    const resizeObserver = new ResizeObserver(() => {
      updateMeasurements();
    });

    if (containerRef.current) resizeObserver.observe(containerRef.current);
    if (measureRef.current) resizeObserver.observe(measureRef.current);

    window.addEventListener('resize', updateMeasurements);
    if (document.fonts?.ready) {
      document.fonts.ready.then(updateMeasurements);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [announcements, isHidden]);

  if (isHidden || !Array.isArray(announcements) || announcements.length === 0) {
    return null;
  }

  return (
    <div id="top" ref={containerRef} className="announcement_bar" aria-label={t('announcements.label')}>
      {/* Hidden element to measure base sequence width based on actual rendered styles */}
      <div
        ref={measureRef}
        className="announcement_sequence"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          top: -9999,
          left: -9999,
        }}
        aria-hidden="true"
      >
        <AnnouncementTrack phrases={announcements} repeat={1} />
      </div>

      <div className="announcement_marquee">
        <div
          className="announcement_marquee_track"
          style={{ animationDuration: `${duration}s` }}
        >
          <div className="announcement_sequence">
            <AnnouncementTrack phrases={announcements} repeat={repeatCount} />
          </div>
          <div className="announcement_sequence" aria-hidden="true">
            <AnnouncementTrack phrases={announcements} repeat={repeatCount} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default withIsland(AnnouncementBar);
