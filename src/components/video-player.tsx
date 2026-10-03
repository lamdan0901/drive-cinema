'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DriveFile, SubtitleCandidate, SubtitleDocument } from '@/lib/types';
import { parseSubtitles } from '@/lib/subtitles/parse';
import { serializeVtt } from '@/lib/subtitles/serialize';
import { shiftCues } from '@/lib/subtitles/shift';
import { decodeSubtitle, SUBTITLE_LIMIT } from '@/lib/subtitles/decode';
import {
  readPreferences,
  writePreferences,
  readSubtitleDelay,
  writeSubtitleDelay,
} from '@/lib/media/preferences';
import { SubtitleControls } from './subtitle-controls';
import { MediaPlayer } from './media-player';
function disableSubtitleTracks(video: HTMLVideoElement) {
  for (const track of video.textTracks) track.mode = 'disabled';
}
export function VideoPlayer({
  video,
  subtitleCandidates,
  onClose,
  sidebar,
  sidebarOpen = false,
  onToggleSidebar,
}: {
  video: DriveFile;
  subtitleCandidates: SubtitleCandidate[];
  onClose: () => void;
  sidebar?: ReactNode;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [preferences] = useState(() => readPreferences(video.id));
  const [subtitle, setSubtitle] = useState(() => {
    const selected = preferences.subtitleId === 'local' ? 'off' : (preferences.subtitleId ?? 'off');
    return { selected, key: selected, offset: readSubtitleDelay(video.id, selected) };
  });
  const { selected, offset, key: subtitleKey } = subtitle;
  const [encoding, setEncoding] = useState<'utf-8' | 'windows-1258'>('utf-8');
  const [local, setLocal] = useState<{ name: string; bytes: Uint8Array; key: string }>();
  const [document, setDocument] = useState<SubtitleDocument | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const media = useRef<HTMLVideoElement>(null);
  const wasExpanded = useRef(false);
  useLayoutEffect(() => {
    if (expanded === wasExpanded.current) return;
    wasExpanded.current = expanded;
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    if (expanded) media.current?.scrollIntoView({ block: 'center', behavior });
    else window.scrollTo({ top: 0, behavior });
  }, [expanded]);
  const track = useRef<HTMLTrackElement>(null);
  const autoChosen = useRef(!!preferences.subtitleId);
  const previousCandidates = useRef(subtitleCandidates);
  const lastWrite = useRef(0);
  const fileSequence = useRef(0);
  const metadataReady = useRef(false);
  const setSelected = useCallback(
    (id: string) => {
      let key = id;
      if (id === 'local') {
        if (!local) throw new Error('Attach a local subtitle before selecting it.');
        key = local.key;
      }
      setSubtitle({ selected: id, key, offset: readSubtitleDelay(video.id, key) });
    },
    [local, video.id],
  );
  function setOffset(offset: number) {
    setSubtitle((current) => ({ ...current, offset }));
  }
  function adjustOffset(delta: number) {
    setSubtitle((current) => ({
      ...current,
      offset: Math.max(-86400, Math.min(86400, Math.round((current.offset + delta) * 1000) / 1000)),
    }));
  }
  useEffect(() => {
    writeSubtitleDelay(video.id, subtitleKey, offset);
  }, [video.id, subtitleKey, offset]);
  const latest = useRef({ selected, offset });
  useEffect(() => {
    latest.current = { selected, offset };
  }, [selected, offset]);
  useEffect(() => {
    if (
      selected !== 'local' &&
      previousCandidates.current.some((c) => c.file.id === selected) &&
      !subtitleCandidates.some((c) => c.file.id === selected)
    )
      setSelected('off');
    previousCandidates.current = subtitleCandidates;
  }, [selected, subtitleCandidates, setSelected]);
  useEffect(() => {
    if (autoChosen.current || !subtitleCandidates.length) return;
    autoChosen.current = true;
    const matches = subtitleCandidates.filter((c) => c.matched);
    if (matches.length === 1) setSelected(matches[0].file.id);
  }, [subtitleCandidates, setSelected]);
  useEffect(() => {
    const controller = new AbortController();
    setDocument(null);
    setError('');
    setBusy(selected !== 'off');
    if (selected === 'off') {
      setBusy(false);
      return;
    }
    (async () => {
      try {
        let text: string;
        if (selected === 'local') {
          if (!local) {
            setSelected('off');
            return;
          }
          text = decodeSubtitle(local.bytes, encoding);
        } else {
          const r = await fetch('/api/subtitles/' + encodeURIComponent(selected), {
            signal: controller.signal,
          });
          if (!r.ok) {
            const p = await r.json();
            throw new Error(p.error ?? 'Could not load subtitles.');
          }
          text = await r.text();
        }
        const parsed = parseSubtitles(text);
        if (!controller.signal.aborted) setDocument(parsed);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load subtitles.');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [selected, local, encoding, setSelected]);
  useEffect(() => {
    if (!document) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(
      new Blob([serializeVtt({ ...document, cues: shiftCues(document.cues, offset) })], {
        type: 'text/vtt',
      }),
    );
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [document, offset]);
  function showTrack() {
    if (track.current?.track) track.current.track.mode = 'showing';
  }
  useEffect(() => {
    const el = media.current;
    if (url) showTrack();
    else if (el) disableSubtitleTracks(el);
  }, [url]);
  useEffect(() => {
    const el = media.current;
    const sequence = fileSequence;
    return () => {
      sequence.current++;
      if (el && metadataReady.current)
        writePreferences(video.id, {
          time: el.currentTime,
          offset: latest.current.offset,
          subtitleId: latest.current.selected === 'local' ? 'off' : latest.current.selected,
        });
    };
  }, [video.id]);
  function save(force = false) {
    const el = media.current;
    if (!el || !metadataReady.current) return;
    if (force || Date.now() - lastWrite.current >= 3000) {
      lastWrite.current = Date.now();
      writePreferences(video.id, {
        time: el.currentTime,
        offset,
        subtitleId: selected === 'local' ? 'off' : selected,
      });
    }
  }
  useEffect(() => {
    if (metadataReady.current && media.current)
      writePreferences(video.id, {
        time: media.current.currentTime,
        offset,
        subtitleId: selected === 'local' ? 'off' : selected,
      });
  }, [selected, offset, video.id]);
  async function attach(file: File) {
    const seq = ++fileSequence.current;
    setError('');
    try {
      if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('Choose an SRT or VTT subtitle file.');
      if (file.size > SUBTITLE_LIMIT) throw new Error('Subtitle files must be 2 MiB or smaller.');
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      const key =
        'local:' + Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (seq !== fileSequence.current) return;
      setLocal({ name: file.name, bytes, key });
      autoChosen.current = true;
      setSubtitle({ selected: 'local', key, offset: readSubtitleDelay(video.id, key) });
    } catch (e) {
      if (seq === fileSequence.current)
        setError(e instanceof Error ? e.message : 'Could not open subtitle.');
    }
  }
  return (
    <section
      className={`player-panel${expanded ? ' player-panel--expanded' : ''}`}
      aria-label="Video player"
    >
      <div className="player-heading">
        <div>
          <span className="eyebrow">NOW SHOWING</span>
          <h2>{video.name.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ')}</h2>
        </div>
        <button className="text-button" onClick={onClose} aria-label="Close video">
          Close ×
        </button>
      </div>
      <MediaPlayer
        videoRef={media}
        subtitleOffset={offset}
        onAdjustSubtitleOffset={adjustOffset}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((value) => !value)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
      >
        <video
          ref={media}
          src={'/api/video/' + encodeURIComponent(video.id)}
          playsInline
          preload="auto"
          tabIndex={0}
          aria-label={video.name}
          onLoadedMetadata={() => {
            metadataReady.current = true;
            const el = media.current!;
            if (
              preferences.time > 0 &&
              Number.isFinite(el.duration) &&
              preferences.time < el.duration - 5
            )
              el.currentTime = preferences.time;
          }}
          onPlay={() => {
            metadataReady.current = true;
            setPlaybackError('');
          }}
          onTimeUpdate={() => save()}
          onPause={() => save(true)}
          onEnded={() => {
            writePreferences(video.id, {
              time: 0,
              offset,
              subtitleId: selected === 'local' ? 'off' : selected,
            });
            metadataReady.current = false;
          }}
          onError={() =>
            setPlaybackError(
              'This video could not be played. Check Drive permissions or quota, then try an MP4 with H.264 video and AAC audio.',
            )
          }
        >
          {url && (
            <track
              key={url}
              ref={track}
              kind="subtitles"
              src={url}
              srcLang="und"
              label="Selected subtitle"
              default
              onLoad={showTrack}
            />
          )}
        </video>
        {sidebar}
      </MediaPlayer>
      {playbackError && (
        <p className="error-message" role="alert">
          {playbackError}{' '}
          <a className="inline-link" href="/api/auth/login">
            Sign in again
          </a>
        </p>
      )}
      <SubtitleControls
        candidates={subtitleCandidates}
        selected={selected}
        setSelected={(id) => {
          autoChosen.current = true;
          setSelected(id);
        }}
        offset={offset}
        setOffset={setOffset}
        adjustOffset={adjustOffset}
        encoding={encoding}
        setEncoding={setEncoding}
        localName={local?.name}
        onFile={(f) => void attach(f)}
        busy={busy}
      />
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <p className="player-hint">
        Space / K to play · M to mute / unmute · ← → to seek 5 seconds · J / L to seek 10 seconds ·
        ↑ ↓ for volume (20%) · F for fullscreen · T for full width · P for folder videos · G / H for
        subtitles earlier / later (50 ms) · Local subtitles stay on this device
      </p>
    </section>
  );
}
