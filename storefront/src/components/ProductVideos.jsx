// Product videos showcase (player with play/pause and seek bar only, thumbnail carousel). Ported from the old
// src/pages/Product.jsx; the markup and classes are unchanged.
import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { useT } from '../i18n/useT';
import { useAuth } from '../stores/auth';
import { withIsland } from '../lib/island';

function formatVideoTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function ProductVideoPlayer({ videoUrl }) {
  const { t } = useT();
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
      playPromise.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
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
      if (videoRef.current.duration && !duration) setDuration(videoRef.current.duration);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration || 0);
  };

  const handleSeek = (e) => {
    if (!progressRef.current || !videoRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percentage * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="product_video_main_container" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <video
        ref={videoRef}
        src={mediaUrl(videoUrl)}
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

      {!isPlaying && (
        <button type="button" className="product_video_center_play" onClick={togglePlayPause} aria-label={t('product.videoPlay')}>
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      <div className={`product_video_controls_overlay${!isPlaying || isHovered ? ' visible' : ''}`}>
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
            <div className="product_video_progress_bar" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <span className="product_video_time">
          {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
        </span>
      </div>
    </div>
  );
}

function ProductVideos({ videos }) {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const [selectedVideoIdx, setSelectedVideoIdx] = useState(0);
  const videoTrackRef = useRef(null);

  // The admin's inline editor draws its own videos section (with upload and delete).
  if (!videos?.length || isAdmin) return null;

  const showThumb = (idx) => {
    setSelectedVideoIdx(idx);
    if (videoTrackRef.current) {
      const buttons = videoTrackRef.current.querySelectorAll('.product_video_thumb_box');
      if (buttons[idx]) buttons[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  };

  return (
    <section className="product_videos_section" id="product_videos_section" aria-label={t('product.videosTitle')}>
      <h2 className="product_videos_title">{t('product.videosTitle')}</h2>

      <ProductVideoPlayer videoUrl={videos[selectedVideoIdx]?.videoUrl} />

      {videos.length > 1 && (
        <div className="product_video_carousel_wrapper">
          <button
            type="button"
            className="scroll_arrow"
            onClick={() => showThumb(Math.max(0, selectedVideoIdx - 1))}
            disabled={selectedVideoIdx === 0}
            aria-label={t('product.videoPrev')}
          >
            ❮
          </button>
          <div className="product_video_track" ref={videoTrackRef}>
            {videos.map((vid, idx) => (
              <button
                key={vid.id || idx}
                type="button"
                className={`product_video_thumb_box${idx === selectedVideoIdx ? ' active' : ''}`}
                onClick={() => showThumb(idx)}
                aria-label={t('product.videoN', { n: idx + 1 })}
              >
                <video src={mediaUrl(vid.videoUrl)} muted preload="metadata" />
                <span className="product_video_thumb_play_icon">▶</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="scroll_arrow"
            onClick={() => showThumb(Math.min(videos.length - 1, selectedVideoIdx + 1))}
            disabled={selectedVideoIdx === videos.length - 1}
            aria-label={t('product.videoNext')}
          >
            ❯
          </button>
        </div>
      )}
    </section>
  );
}

export default withIsland(ProductVideos);
