'use client';
import { useEffect, useRef, useState } from 'react';
import type { DriveFile, SubtitleCandidate, SubtitleDocument } from '@/lib/types';
import { parseSubtitles } from '@/lib/subtitles/parse';
import { serializeVtt } from '@/lib/subtitles/serialize';
import { shiftCues } from '@/lib/subtitles/shift';
import { decodeSubtitle, SUBTITLE_LIMIT } from '@/lib/subtitles/decode';
import { readPreferences, writePreferences } from '@/lib/media/preferences';
import { playerShortcut } from '@/lib/media/shortcuts';
import { SubtitleControls } from './subtitle-controls';
export function VideoPlayer({
  video,
  subtitleCandidates,
  onClose,
}: {
  video: DriveFile;
  subtitleCandidates: SubtitleCandidate[];
  onClose: () => void;
}) {
  const [preferences] = useState(() => readPreferences(video.id));
  const [selected, setSelected] = useState(preferences.subtitleId ?? 'off');
  const [offset, setOffset] = useState(preferences.offset);
  const [encoding, setEncoding] = useState<'utf-8' | 'windows-1258'>('utf-8');
  const [local, setLocal] = useState<{ name: string; bytes: Uint8Array }>();
  const [document, setDocument] = useState<SubtitleDocument | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const media = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLTrackElement>(null);
  const autoChosen = useRef(!!preferences.subtitleId);
  const previousCandidates = useRef(subtitleCandidates);
  const lastWrite = useRef(0);
  const fileSequence = useRef(0);
  const metadataReady = useRef(false);
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
  }, [selected, subtitleCandidates]);
  useEffect(() => {
    if (autoChosen.current || !subtitleCandidates.length) return;
    autoChosen.current = true;
    const matches = subtitleCandidates.filter((c) => c.matched);
    if (matches.length === 1) setSelected(matches[0].file.id);
  }, [subtitleCandidates]);
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
  }, [selected, local, encoding]);
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
    if (url) showTrack();
    else if (media.current) for (const t of media.current.textTracks) t.mode = 'disabled';
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (seq !== fileSequence.current) return;
      setLocal({ name: file.name, bytes });
      autoChosen.current = true;
      setSelected('local');
    } catch (e) {
      if (seq === fileSequence.current)
        setError(e instanceof Error ? e.message : 'Could not open subtitle.');
    }
  }
  return (
    <section
      className="player-panel"
      aria-label="Video player"
      onKeyDown={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
        const action = playerShortcut(e.key, e.target);
        const el = media.current;
        if (!action || !el) return;
        e.preventDefault();
        if (action === 'toggle') {
          if (el.paused)
            void el
              .play()
              .catch(() =>
                setPlaybackError('Playback could not start. Use the video controls to try again.'),
              );
          else el.pause();
        } else
          el.currentTime = Math.max(
            0,
            Math.min(
              Number.isFinite(el.duration) ? el.duration : Infinity,
              el.currentTime + (action === 'forward' ? 5 : -5),
            ),
          );
      }}
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
      <video
        ref={media}
        src={'/api/video/' + encodeURIComponent(video.id)}
        controls
        playsInline
        preload="metadata"
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
        Space / K to play · ← → to seek 5 seconds · Local subtitles stay on this device
      </p>
    </section>
  );
}
