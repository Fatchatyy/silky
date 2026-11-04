import { mediaUrl } from '@shared/media';
import { useEffect, useState } from 'react';
import { formatPrice } from '@shared/formatPrice';
import { useT } from '../i18n/useT';
import { productName as productNameOf } from '@shared/productText';

export default function ShareModal({ isOpen, onClose, product, image, price }) {
  const { t, locale } = useT();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentUrl(window.location.href);
    }
  }, [isOpen]);

  // Lock body scroll when modal is open and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  const shownName = productNameOf(product, locale) || t('share.unnamed');
  const shareText = t('share.text', { name: shownName, url: currentUrl });
  const encodedUrl = encodeURIComponent(currentUrl);
  const encodedText = encodeURIComponent(shareText);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = currentUrl;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setFeedback(t('share.copiedClipboard'));
      setTimeout(() => {
        setCopied(false);
        setFeedback('');
      }, 3500);
    } catch {
      setFeedback(t('share.copyFailed'));
      setTimeout(() => setFeedback(''), 3500);
    }
  };

  const handleWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodedText}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
  };

  const handleMessenger = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      }
    } catch {
      /* clipboard write optional */
    }
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (isMobile) {
      window.location.href = `fb-messenger://share/?link=${encodedUrl}`;
      setTimeout(() => {
        const webUrl = `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=291494419107518&redirect_uri=${encodedUrl}`;
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }, 500);
    } else {
      const webUrl = `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=291494419107518&redirect_uri=${encodedUrl}`;
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleInstagram = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      }
      setCopied(true);
      setFeedback(t('share.copiedInstagram'));
      setTimeout(() => {
        setCopied(false);
        setFeedback('');
      }, 4000);
    } catch {
      setFeedback(t('share.openingInstagram'));
      setTimeout(() => setFeedback(''), 3000);
    }
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
  };

  const handleTikTok = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      }
      setCopied(true);
      setFeedback(t('share.copiedTikTok'));
      setTimeout(() => {
        setCopied(false);
        setFeedback('');
      }, 4000);
    } catch {
      setFeedback(t('share.openingTikTok'));
      setTimeout(() => setFeedback(''), 3000);
    }
    window.open('https://www.tiktok.com/', '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: shownName,
          text: t('share.shortText', { name: shownName }),
          url: currentUrl,
        });
      } catch {
        /* user cancelled */
      }
    }
  };

  const hasNativeShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  return (
    <div
      className="share-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div className="share-modal-card">
        <div className="share-modal-header">
          <h2 id="share-modal-title" className="share-modal-title">
            {t('share.title')}
          </h2>
          <button
            type="button"
            className="share-modal-close-btn"
            onClick={onClose}
            aria-label={t('share.close')}
          >
            &times;
          </button>
        </div>

        {/* Product mini preview card */}
        <div className="share-modal-product-preview">
          {image && (
            <img
              src={mediaUrl(image)}
              alt={shownName}
              className="share-modal-product-img"
            />
          )}
          <div className="share-modal-product-info">
            <span className="share-modal-product-name">{shownName}</span>
            {price !== undefined && price !== null && (
              <span className="share-modal-product-price">
                {typeof price === 'number' ? formatPrice(price) : price}
              </span>
            )}
          </div>
        </div>

        {/* Quick URL Copy Bar */}
        <div className="share-modal-copy-box">
          <input
            type="text"
            readOnly
            value={currentUrl}
            className="share-modal-copy-input"
            onClick={(e) => e.target.select()}
            aria-label={t('share.linkLabel')}
          />
          <button
            type="button"
            className={`share-modal-copy-btn ${copied ? 'share-modal-copy-btn--success' : ''}`}
            onClick={handleCopyLink}
          >
            {copied ? t('share.copiedShort') : t('share.copy')}
          </button>
        </div>

        {feedback && (
          <div className="share-modal-feedback-banner" role="status">
            {feedback}
          </div>
        )}

        {/* Social Share Grid */}
        <div className="share-modal-grid">
          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleCopyLink}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/copylink.png" alt={t('share.copyLinkAlt')} className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">
              {copied ? t('share.copiedLabel') : t('share.copyLinkAlt')}
            </span>
          </button>

          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleWhatsApp}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/whatsapp.png" alt="WhatsApp" className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">WhatsApp</span>
          </button>

          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleMessenger}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/messenger.png" alt="Messenger" className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">Messenger</span>
          </button>

          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleInstagram}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/instagram.png" alt="Instagram" className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">Instagram</span>
          </button>

          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleTikTok}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/tiktok.png" alt="TikTok" className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">TikTok</span>
          </button>

          <button
            type="button"
            className="share-modal-item-btn"
            onClick={handleFacebook}
          >
            <div className="share-modal-item-icon-wrapper">
              <img src="/pictures/facebook.png" alt="Facebook" className="share-modal-item-icon" />
            </div>
            <span className="share-modal-item-label">Facebook</span>
          </button>

          {hasNativeShare && (
            <button
              type="button"
              className="share-modal-item-btn share-modal-item-btn--native"
              onClick={handleNativeShare}
            >
              <div className="share-modal-item-icon-wrapper">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </div>
              <span className="share-modal-item-label">{t('share.more')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
