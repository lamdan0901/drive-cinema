# Drive Cinema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a complete, runnable Next.js personal Drive video library with external subtitles.

**Architecture:** A single Node.js Next.js application owns Google OAuth and encrypted cookie sessions. Route handlers stream Drive bytes without buffering movies; client components browse folders and manage native video playback and subtitle cues.

**Tech Stack:** Latest stable Next.js App Router, React, TypeScript, Google identity verification library, encrypted sessions, Vitest, React Testing Library, ESLint, Docker.

**Spec:** ../specs/2026-09-30-drive-cinema-design.md

## Global Constraints

- Each user accesses only files permitted by their Google account; credentials never reach client JavaScript or logs.
- Encrypted HttpOnly cookies; Secure in production; SameSite=Lax. Fixed application origin controls OAuth callbacks and logout origin validation.
- No database, transcoding, adaptive HLS, public catalog, or shared-drive navigation in this version.
- Stream movie bodies directly; preserve upstream status and byte headers; reject multipart ranges.
- Enforce a 2 MiB subtitle limit using metadata and bounded reads.
- Resolve and pin actual latest stable dependencies during implementation; include a lockfile and exclude prereleases.
- Deliver a source ZIP without node_modules, build output, credentials, or personal media; include README, environment template, Dockerfile, and .dockerignore.
- Run lint, typecheck, tests, production build, and responsive UI inspection. Report live Google integration separately from mocked checks.

## Review Focus

- Missing or revoked refresh credentials must prompt sign-in, and concurrent refreshes must retain existing refresh tokens.
- A Drive shortcut may identify an inaccessible file, non-video, or file without download permission; show a useful error.
- Google may ignore a Range request or return 416; preserve upstream semantics instead of inventing a 206 response.
- Rapid folder or video selection must not display stale responses or retain old subtitle object URLs.
- Browser storage can be unavailable or contain invalid resume data; playback must still work.

## File structure and shared types

Use src/app for pages/routes, src/components for UI, src/lib for isolated logic, and tests for unit, route, and component checks. Configuration, Docker files, and README live at project root.

Shared types in src/lib/types.ts:
- Session: subject, optional display name, accessToken, optional refreshToken, accessExpiresAt, sessionExpiresAt; timestamps are epoch milliseconds.
- DriveFile: id, name, mimeType, optional size, parents, modifiedTime, capabilities.canDownload.
- FilePage: files: DriveFile[], optional nextPageToken.
- Cue: start: number, end: number (seconds), text: string, optional id/settings.
- SubtitleDocument: cues: Cue[], optional preserved VTT metadata.
- ApiError: status: number, code: string, safe message: string.

### Task 1: Runnable shell and configuration

**Files:** package.json, package-lock.json, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts, .gitignore, .env.example, src/lib/config.ts, src/lib/types.ts, src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, tests/config.test.ts.

**Interfaces:** getConfig(): { origin: string; googleClientId: string; googleClientSecret: string; sessionSecret: string }; configurationStatus(): { ready: boolean; missing: string[] }. Config is server-only; the client receives readiness and variable names only.

- [ ] Resolve current stable package versions from official release information and the package registry; scaffold TypeScript/App Router configuration and install exact versions. Record any network restriction rather than guessing versions.
- [ ] Write tests asserting missing environment values produce safe configuration errors, invalid origins are rejected, and a valid origin gives a fixed /api/auth/callback URL; run npm test -- tests/config.test.ts and observe failure before configuration implementation.
- [ ] Implement config validation and an accessible dark sign-in shell with readable missing-configuration guidance.
- [ ] Run config tests and npm run typecheck; require passing results and no client-secret serialization.
- [ ] Commit the runnable shell and configuration.

### Task 2: OAuth and sessions

**Files:** src/lib/auth/session.ts, src/lib/auth/oauth.ts, src/lib/auth/tokens.ts, src/lib/errors.ts, src/app/api/auth/login/route.ts, src/app/api/auth/callback/route.ts, src/app/api/auth/logout/route.ts, tests/auth.test.ts, tests/auth-routes.test.ts.

**Interfaces:** readSession(request: Request): Promise<Session | null>; setSession(response: Response, session: Session): Promise<void>; clearSession(response: Response): void; requireSession(request: Request): Promise<Session>; authorizedFetch(session: Session, url: URL, init?: RequestInit): Promise<{ response: Response; session: Session; changed: boolean }>. Use NextResponse internally when setting cookies. ApiError maps through errorResponse(error: unknown): Response, which never includes raw upstream bodies or tokens.

- [ ] Write failing tests for tampered/expired session cookies, cookie size, missing session rejection, PKCE challenge/state comparison, missing identity token, and wrong issuer/audience verification. Include hostile callback state and an origin-mismatched logout request.
- [ ] Run npm test -- tests/auth.test.ts tests/auth-routes.test.ts; confirm the intended failures.
- [ ] Implement encrypted session envelopes and protected 10-minute OAuth transaction cookies; use Google's supported library to verify ID tokens. Session TTL is seven days; access expiry is based on Google's expires_in. Preserve an existing refresh token if a token response omits it, and reject an unusable session with no refresh credentials.
- [ ] Implement offline authorization, fixed callback URLs, bounded safe errors, same-origin POST logout, and auth failure redirects. Implement one authentication retry only, with process-local in-flight refresh coordination and bounded cleanup; document that cookie sessions do not offer global revocation.
- [ ] Add and pass tests asserting two simultaneous refresh requests share one refresh operation, omitted refresh tokens are retained, revocation returns an authentication error, and responses update cookies before any streamed body starts.
- [ ] Commit authentication and sessions.

### Task 3: Drive browsing and streaming

**Files:** src/lib/drive/client.ts, src/lib/drive/files.ts, src/lib/media/range.ts, src/lib/media/stream.ts, src/app/api/drive/files/route.ts, src/app/api/drive/files/[fileId]/route.ts, src/app/api/video/[fileId]/route.ts, tests/drive.test.ts, tests/stream.test.ts.

**Interfaces:** parseFileId(input: string): string; getFile(session: Session, id: string): Promise<{ file: DriveFile; session: Session; changed: boolean }>; listFiles(session: Session, options: { parent: string; query?: string; pageToken?: string }): Promise<{ page: FilePage; session: Session; changed: boolean }>; validateRange(value: string | null): string | null; streamVideo(request: Request, id: string): Promise<Response>. The stream handler consumes auth and safe error mapping from Task 2.

- [ ] Write failing tests for IDs and known Drive link forms, escaping search input in Drive queries, pagination, inaccessible shortcuts, non-video selection, and download-disabled files. Folder listing returns folders, videos, SRT, and VTT, omitting trashed files.
- [ ] Write failing tests for closed/open/suffix byte ranges, invalid/multipart ranges, upstream 200/206/304/416, correct Content-Range/Length preservation, HEAD without downloading, conditional header forwarding, and private no-store caching.
- [ ] Run npm test -- tests/drive.test.ts tests/stream.test.ts; observe failures.
- [ ] Implement authenticated metadata/list endpoints with My Drive parent navigation and optional folder search. Forward only allowlisted request/response headers; send Accept-Encoding: identity; do not preserve Content-Length for a decoded response. HEAD uses metadata and returns no body.
- [ ] Implement direct ReadableStream forwarding with cancellation propagation, at most one auth retry, and safe quota/permission errors. Set refreshed session cookies before returning the streaming response. Avoid loading an entire media body, and never claim Range support that the upstream did not provide.
- [ ] Pass tests including a deliberately delayed upstream stream: the route returns headers before all chunks exist; cancellation aborts the upstream request. Confirm ignored Range remains 200 and unsatisfiable Range remains 416.
- [ ] Commit Drive access and streaming.

### Task 4: Subtitle processing and matching

**Files:** src/lib/subtitles/parse.ts, src/lib/subtitles/serialize.ts, src/lib/subtitles/decode.ts, src/lib/subtitles/shift.ts, src/lib/drive/download.ts, src/lib/media/match.ts, src/app/api/subtitles/[fileId]/route.ts, tests/subtitles.test.ts, tests/subtitle-route.test.ts, tests/match.test.ts.

**Interfaces:** parseSubtitles(text: string): SubtitleDocument; serializeVtt(document: SubtitleDocument): string; shiftCues(cues: Cue[], offset: number): Cue[]; decodeSubtitle(bytes: Uint8Array, encoding: 'utf-8' | 'windows-1258'): string; readBounded(response: Response, limit: number): Promise<Uint8Array>; matchSubtitles(videoName: string, files: DriveFile[]): { file: DriveFile; language: string; matched: boolean }[].

- [ ] Write failing tests with a BOM SRT containing multiline text: serialized output begins WEBVTT and uses dot timestamps; assert invalid timestamps and nonpositive cue durations are rejected. Cover CRLF, cue identifiers, VTT settings/metadata, Vietnamese text, and Windows-1258 decoding.
- [ ] Write failing tests asserting shiftCues([{start:1,end:3,text:'A'}], -2) returns [{start:0,end:1,text:'A'}], offsets do not mutate originals, cues ending before zero disappear, and nonfinite offsets fail.
- [ ] Write failing tests for stem/language matching and ambiguous matches; assert metadata or streamed payload greater than 2097152 bytes is rejected and its reader is canceled.
- [ ] Run the three test files, confirm failure, implement parser/serializer/decoder/shift/matcher and bounded authenticated subtitle endpoint with Content-Type: text/vtt; charset=utf-8. Reject non-subtitle files and never render cue content with injected HTML.
- [ ] Pass all subtitle/matching tests and commit.

### Task 5: Complete browsing and player UI

**Files:** src/components/library.tsx, src/components/file-browser.tsx, src/components/video-player.tsx, src/components/subtitle-controls.tsx, src/lib/media/preferences.ts, src/lib/media/shortcuts.ts, src/app/page.tsx, src/app/globals.css, tests/library.test.tsx, tests/player.test.tsx, tests/preferences.test.ts.

**Interfaces:** Library accepts safe user display data; VideoPlayer accepts video: DriveFile and subtitleCandidates: matching results from Task 4. readPreferences(fileId: string): { time: number; subtitleId?: string; offset: number }; writePreferences(fileId: string, value: preferences): void. Persist only validated data and never credentials.

- [ ] Write failing component tests for folder/breadcrumb navigation, next-page loading, within-folder search, Drive shortcuts, parent-folder subtitle discovery, manual subtitle choice, loading/empty/error states, and sign-out.
- [ ] Write failing tests proving an older folder response cannot overwrite a newer selection, changing video cleans up prior subtitle object URLs, uploads stay local, language/off switches update text tracks, and offsets regenerate from original cues.
- [ ] Write failing tests for unavailable/corrupt localStorage, metadata-delayed resume, throttled playback writes, selected subtitle/offset restoration, and keyboard shortcuts that ignore input/textarea/select/contenteditable controls.
- [ ] Run the three test files and confirm failure. Implement responsive UI, native video controls/fullscreen, labelled subtitle/encoding/offset controls, file-link input, and safe codec/load failure feedback. Limit local subtitle uploads to 2 MiB before reading them.
- [ ] Pass component tests and inspect desktop/mobile layouts with mock library data. Verify visible keyboard focus, contrast, long filenames, and unconfigured/signed-out states. Keep mocks confined to tests or development inspection; production always uses actual sessions.
- [ ] Commit library and player UI.

### Task 6: Deployment, full verification, and source delivery

**Files:** README.md, Dockerfile, .dockerignore, scripts/package-source.mjs, tests/integration.test.ts, docs/verification.md.

**Interfaces:** npm run lint, npm run typecheck, npm test, npm run build, npm run start, and npm run package produce documented results. Source ZIP contains a single drive-cinema/ root and everything needed for npm ci.

- [ ] Write a failing mocked route integration test covering authenticated folder listing, video metadata, a ranged video request, and matched converted subtitle, plus unauthenticated rejection and refreshed cookies; run it and observe failure where wiring is incomplete.
- [ ] Complete wiring and pass integration tests. Write README with local setup, environment generation, Google Cloud API/consent/test-user/callback configuration, read-only scope review and testing-mode token limits, and sign-in/playback troubleshooting.
- [ ] Add Node/Docker production instructions, streaming hosting constraints, cookie key rotation and revocation limitations, supported codecs and optional H.264/AAC FFmpeg conversion, browser-local subtitle/resume behavior, and project file map.
- [ ] Add a standalone Next.js Docker build and deterministic ZIP script with explicit exclusions for .env secrets, .git, node_modules, build/cache files, and personal media; test ZIP contents for those exclusions.
- [ ] Run npm run lint, npm run typecheck, npm test, and npm run build. Require successful exit codes; fix failures before moving on. Inspect the running production shell and representative player/library UI at desktop and mobile widths.
- [ ] Perform whole-project review focused on token exposure, cancellation, refresh races, stale UI requests, subtitle limits, and unsafe error content. Document actual dependency versions, executed checks, and any unavailable tooling or live Google checks.
- [ ] Commit completed source, package the ZIP, save the deliverable, and return its download link with concise setup commands and verification limits.

## Execution recommendation

Native execution is recommended: implement each task in this session, keep the test/commit gates, and review the complete project at the end. The modules share authentication, streamed-response, and subtitle interfaces, so a single implementer can keep those contracts consistent with less handoff overhead. Independent agent review can be selected if desired; no agents are dispatched without the user's choice.
