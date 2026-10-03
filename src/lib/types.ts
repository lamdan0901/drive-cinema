export interface Session {
  subject: string;
  name?: string;
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number;
  sessionExpiresAt: number;
}
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  modifiedTime?: string;
  capabilities?: { canDownload?: boolean };
}
export interface FilePage {
  files: DriveFile[];
  nextPageToken?: string;
}
export interface Cue {
  start: number;
  end: number;
  text: string;
  id?: string;
  settings?: string;
}
export interface SubtitleDocument {
  cues: Cue[];
  metadata?: string[];
}
export interface SubtitleCandidate {
  file: DriveFile;
  language: string;
  matched: boolean;
}
