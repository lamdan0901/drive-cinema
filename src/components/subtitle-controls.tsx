'use client';
import type { SubtitleCandidate } from '@/lib/types';
const languages: Record<string, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  th: 'ไทย',
  und: 'Subtitle',
};
export function SubtitleControls({
  candidates,
  selected,
  setSelected,
  offset,
  setOffset,
  encoding,
  setEncoding,
  localName,
  onFile,
  busy,
}: {
  candidates: SubtitleCandidate[];
  selected: string;
  setSelected: (id: string) => void;
  offset: number;
  setOffset: (n: number) => void;
  encoding: 'utf-8' | 'windows-1258';
  setEncoding: (s: 'utf-8' | 'windows-1258') => void;
  localName?: string;
  onFile: (f: File) => void;
  busy: boolean;
}) {
  return (
    <div className="subtitle-controls">
      <div className="control-group">
        <label htmlFor="subtitle-track">Subtitles</label>
        <select
          id="subtitle-track"
          aria-label="Subtitle track"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="off">Off</option>
          {candidates.map((c) => (
            <option key={c.file.id} value={c.file.id}>
              {languages[c.language] ?? c.language} · {c.file.name}
              {c.matched ? ' (matched)' : ''}
            </option>
          ))}
          {localName && <option value="local">Local · {localName}</option>}
        </select>
      </div>
      <div className="control-group offset-control">
        <label htmlFor="subtitle-offset">Timing offset</label>
        <div>
          <input
            id="subtitle-offset"
            type="number"
            step="0.1"
            min="-86400"
            max="86400"
            aria-label="Subtitle offset in seconds"
            value={offset}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && Math.abs(n) <= 86400) setOffset(n);
            }}
          />
          <span>seconds</span>
        </div>
        <small>
          {offset < 0
            ? `Earlier by ${Math.abs(offset)} seconds`
            : offset > 0
              ? `Later by ${offset} seconds`
              : 'Original timing'}
        </small>
      </div>
      <div className="attach">
        <label className="button" htmlFor="subtitle-upload">
          ＋ Attach subtitle
          <input
            id="subtitle-upload"
            className="visually-hidden"
            type="file"
            accept=".srt,.vtt"
            aria-label="Attach subtitle file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <small>{busy ? 'Loading subtitles…' : 'SRT or VTT, up to 2 MiB'}</small>
      </div>
      {localName && (
        <div className="control-group encoding-control">
          <label htmlFor="subtitle-encoding">Local file encoding</label>
          <select
            id="subtitle-encoding"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as 'utf-8' | 'windows-1258')}
          >
            <option value="utf-8">UTF-8</option>
            <option value="windows-1258">Windows-1258 (Vietnamese)</option>
          </select>
        </div>
      )}
    </div>
  );
}
