import { mediaUrl } from '@shared/media';
import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { api } from '../lib/apiClient';
import InfiniteMarquee from './InfiniteMarquee';
import { calculateRatingSummary } from '../utils/ratings';
import { useT } from '../i18n/useT';

export default function ReviewsSection({ ratingText, layout = 'default' }) {
  const { t, known } = useT();
  const [gallery, setGallery] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [ratingSummary, setRatingSummary] = useState(null);

  useEffect(() => {
    api
      .getPublishedReviews()
      .then(({ reviews: published, gallery: galleryItems, summary }) => {
        setGallery(galleryItems || []);
        setReviews(published || []);
        if (published?.length) {
          setRatingSummary(summary || calculateRatingSummary(published));
        } else {
          setRatingSummary(null);
        }
      })
      .catch(() => {
        setGallery([]);
        setReviews([]);
        setRatingSummary(null);
      });
  }, []);

  const renderRatingSummary = () => {
    if (ratingText) return ratingText;
    if (!ratingSummary || ratingSummary.count === 0) {
      return (
        <>
          {t('reviews.none')}
          <br />
          {t('reviews.beFirst')}
        </>
      );
    }
    const { average, label, count } = ratingSummary;
    return (
      <>
        <strong>{average}/5 {known(label)}</strong>
        <br />
        {t('reviews.count', { count })}
      </>
    );
  };

  const galleryItemsToRender = gallery.slice(0, 10);
  const reviewsToRender = reviews.slice(0, 15);

  return (
    <section className={`reviews_section${layout === 'leave-review' ? ' reviews_section_leave_page' : ''}`}>
      {layout === 'leave-review' ? (
        <div className="rating_summary rating_summary_centered">{renderRatingSummary()}</div>
      ) : (
        <div className="reviews_header">
          <div className="rating_summary">{renderRatingSummary()}</div>

          <div className="reviews_title_container">
            <h2 className="reviews_title">{t('reviews.heading')}</h2>
            <Link to="/leave-review" className="reviews_logo_link">
              <img src="/pictures/avis.png" alt={t('reviews.logoAlt')} className="reviews_main_img" />
            </Link>
          </div>

          <div className="leave_review_container">
            <Link to="/leave-review" className="leave_review_link">
              {t('reviews.leave')}
            </Link>
          </div>
        </div>
      )}

      <div className="reviews_content_grid">
        {galleryItemsToRender.length > 0 && (
          <div className="horizontal_gallery_wrapper">
            <InfiniteMarquee className="gallery_marquee" orientation="horizontal" speed={30} stepAmount={255}>
              {galleryItemsToRender.map((image, index) => (
                <div key={image.id || image.src || index} className="gallery_image_item">
                  <img src={mediaUrl(image.src)} alt={image.alt || t('reviews.photoAlt', { n: index + 1 })} className="review_gallery_img" draggable={false} loading="lazy" decoding="async" />
                </div>
              ))}
            </InfiniteMarquee>
          </div>
        )}

        {reviewsToRender.length > 0 && (
          <div className="vertical_reviews_wrapper">
            <InfiniteMarquee className="reviews_text_marquee" orientation="vertical" speed={30} stepAmount={120}>
              {reviewsToRender.map((review, index) => (
                <div key={review.id || index} className="review_text_card review_marquee_item">
                  <div className="review_account_name">{review.authorName || review.name}</div>
                  <div className="review_body">{review.body}</div>
                </div>
              ))}
            </InfiniteMarquee>
          </div>
        )}
      </div>
    </section>
  );
}



