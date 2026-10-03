'use client';

// Adapted from Immersive-Video-Playlist's M3u8Player overlay controls.
import {
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  RectangleHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode, RefObject } from 'react';
import './media-player.css';

const CONTROLS_HIDE_DELAY_MS = 2500;

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

function progressRatio(bar: HTMLDivElement, clientX: number) {
  const rect = bar.getBoundingClientRect();
  return rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
}

export function MediaPlayer({
  videoRef,
  subtitleOffset,
  onAdjustSubtitleOffset,
  expanded,
  onToggleExpanded,
  sidebarOpen = false,
  onToggleSidebar,
  children,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  subtitleOffset: number;
  onAdjustSubtitleOffset: (delta: number) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbing = useRef(false);
  const playing = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [hoveredRatio, setHoveredRatio] = useState<number | null>(null);
  const [controlError, setControlError] = useState('');

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const revealControls = useCallback(() => {
    clearHideTimer();
    setControlsVisible(true);
    if (!playing.current) return;
    hideTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      const keyboardFocus =
        controlsRef.current?.contains(focused) && focused?.matches(':focus-visible');
      if (!scrubbing.current && !keyboardFocus) setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncBuffered = () => {
      const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
      setBufferedRatio(
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, end / video.duration)
          : 0,
      );
    };
    const syncTime = () => {
      if (!scrubbing.current) setCurrentTime(video.currentTime);
      syncBuffered();
    };
    const syncDuration = () => {
      setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
      syncTime();
    };
    const syncVolume = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };
    const onPlay = () => {
      playing.current = true;
      setIsPlaying(true);
      setControlError('');
      revealControls();
    };
    const onPause = () => {
      playing.current = false;
      setIsPlaying(false);
      revealControls();
    };
    const syncMetadata = () => {
      syncDuration();
      syncVolume();
    };
    const listeners = {
      play: onPlay,
      pause: onPause,
      ended: onPause,
      timeupdate: syncTime,
      loadedmetadata: syncMetadata,
      durationchange: syncDuration,
      volumechange: syncVolume,
      progress: syncBuffered,
    };
    for (const [event, listener] of Object.entries(listeners))
      video.addEventListener(event, listener);
    syncMetadata();
    return () => {
      for (const [event, listener] of Object.entries(listeners))
        video.removeEventListener(event, listener);
      clearHideTimer();
    };
  }, [videoRef, clearHideTimer, revealControls]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
      revealControls();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [revealControls]);

  const handlePlayerShortcut = useEffectEvent(async (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      (event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        ))
    )
      return;
    const key = event.key.toLowerCase();
    if (key === 'g' || key === 'h') {
      event.preventDefault();
      onAdjustSubtitleOffset(key === 'g' ? -0.05 : 0.05);
      revealControls();
      return;
    }
    if (event.repeat) return;
    if (key !== 'f' && key !== 't') return;
    event.preventDefault();
    if (key === 'f') await toggleFullscreen();
    else {
      if (document.fullscreenElement === containerRef.current && !(await toggleFullscreen()))
        return;
      onToggleExpanded();
      revealControls();
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      void handlePlayerShortcut(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused)
      void video
        .play()
        .catch(() => setControlError('Playback could not start. Press Play to try again.'));
    else video.pause();
  }

  function seekTo(time: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.max(0, Math.min(video.duration, time));
    setCurrentTime(video.currentTime);
  }

  function finishScrubbing(event: PointerEvent<HTMLDivElement>) {
    scrubbing.current = false;
    setHoveredRatio(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    revealControls();
  }

  async function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return false;
    setControlError('');
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen();
      else {
        if (!container.requestFullscreen) {
          setControlError('Fullscreen is unavailable in this browser. Use expanded view instead.');
          return false;
        }
        await container.requestFullscreen();
      }
      return true;
    } catch {
      setControlError(
        document.fullscreenElement === container
          ? 'Fullscreen could not close. Press Escape to exit.'
          : 'Fullscreen could not start. Try again or use expanded view.',
      );
      return false;
    }
  }

  const hasDuration = duration > 0;
  const playedRatio = hasDuration ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const hoverTime = hoveredRatio !== null && hasDuration ? hoveredRatio * duration : null;
  const muted = isMuted || volume === 0;

  return (
    <div
      ref={containerRef}
      className={`media-player${controlsVisible ? ' media-player--controls-visible' : ''}${isFullscreen ? ' media-player--fullscreen' : ''}`}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onFocus={revealControls}
      onBlur={revealControls}
      onClick={(event) => {
        if (event.target === videoRef.current) togglePlay();
      }}
    >
      {onToggleSidebar && (
        <div className="media-player-toolbar">
          <button
            type="button"
            className="media-player-sidebar-toggle"
            aria-label="Toggle folder videos"
            aria-expanded={sidebarOpen}
            aria-controls="folder-video-sidebar"
            title="Folder videos (P)"
            onClick={onToggleSidebar}
          >
            <ListVideo size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      {children}
      <div className="media-player-gradient" aria-hidden="true" />
      <div className="media-player-mini-progress" aria-hidden="true">
        <div
          className="media-player-mini-progress-buffer"
          style={{ width: `${bufferedRatio * 100}%` }}
        />
        <div
          className="media-player-mini-progress-played"
          style={{ width: `${playedRatio * 100}%` }}
        />
      </div>
      {controlError && (
        <p className="media-player-error" role="alert">
          {controlError}
        </p>
      )}
      <div ref={controlsRef} className="media-player-controls">
        <div
          className="media-player-progress"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={hasDuration ? Math.min(currentTime, duration) : 0}
          aria-valuetext={`${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`}
          aria-disabled={!hasDuration}
          onKeyDown={(event) => {
            if (!hasDuration || event.ctrlKey || event.altKey || event.metaKey) return;
            let nextTime: number;
            if (event.key === 'Home') nextTime = 0;
            else if (event.key === 'End') nextTime = duration;
            else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
              nextTime = currentTime + 5;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
              nextTime = currentTime - 5;
            else return;
            event.preventDefault();
            event.stopPropagation();
            seekTo(nextTime);
          }}
          onPointerDown={(event) => {
            if (!hasDuration || event.button !== 0) return;
            event.preventDefault();
            scrubbing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            const ratio = progressRatio(event.currentTarget, event.clientX);
            setHoveredRatio(ratio);
            seekTo(ratio * duration);
          }}
          onPointerMove={(event) => {
            if (!hasDuration) return;
            const ratio = progressRatio(event.currentTarget, event.clientX);
            setHoveredRatio(ratio);
            if (scrubbing.current) seekTo(ratio * duration);
          }}
          onPointerUp={finishScrubbing}
          onPointerCancel={finishScrubbing}
          onLostPointerCapture={() => {
            scrubbing.current = false;
            setHoveredRatio(null);
          }}
          onPointerLeave={() => {
            if (!scrubbing.current) setHoveredRatio(null);
          }}
        >
          <div className="media-player-progress-track">
            {hoverTime !== null && (
              <span
                className="media-player-progress-tooltip"
                style={{ '--media-player-hover-ratio': hoveredRatio } as CSSProperties}
              >
                {formatPlaybackTime(hoverTime)}
              </span>
            )}
            <div
              className="media-player-progress-buffer"
              style={{ width: `${bufferedRatio * 100}%` }}
            />
            <div
              className="media-player-progress-played"
              style={{ width: `${playedRatio * 100}%` }}
            >
              <span className="media-player-progress-thumb" />
            </div>
          </div>
        </div>
        <div className="media-player-bar">
          <div className="media-player-bar-left">
            <button
              type="button"
              className="media-player-icon-btn"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause aria-hidden="true" size={22} />
              ) : (
                <Play aria-hidden="true" size={22} />
              )}
            </button>
            <div className="media-player-volume">
              <button
                type="button"
                className="media-player-icon-btn"
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute' : 'Mute'}
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.volume === 0) {
                    video.volume = 1;
                    video.muted = false;
                  } else video.muted = !video.muted;
                }}
              >
                {muted ? (
                  <VolumeX aria-hidden="true" size={22} />
                ) : (
                  <Volume2 aria-hidden="true" size={22} />
                )}
              </button>
              <input
                className="media-player-volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                aria-label="Volume"
                onChange={(event) => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.volume = Number(event.target.value);
                  if (video.volume > 0) video.muted = false;
                }}
              />
            </div>
            <span className="media-player-time">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
          </div>
          <div className="media-player-bar-right">
            <span
              className="media-player-subtitle-delay"
              role="status"
              aria-label="Subtitle delay"
              aria-atomic="true"
              title="G: subtitles earlier · H: subtitles later (50 ms)"
            >
              Subtitles {subtitleOffset > 0 ? '+' : ''}
              {Math.round(subtitleOffset * 1000)} ms
            </span>
            {!isFullscreen && (
              <button
                type="button"
                className="media-player-icon-btn"
                aria-label={expanded ? 'Normal view' : 'Expand to full width'}
                title={expanded ? 'Normal view (T)' : 'Expand to full width (T)'}
                aria-pressed={expanded}
                onClick={onToggleExpanded}
              >
                <RectangleHorizontal aria-hidden="true" size={22} />
              </button>
            )}
            <button
              type="button"
              className="media-player-icon-btn"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? (
                <Minimize aria-hidden="true" size={22} />
              ) : (
                <Maximize aria-hidden="true" size={22} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
