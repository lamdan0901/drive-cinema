# Drive Cinema — project design

## Goal and agreed scope

Deliver the complete source of a personal video library built with the latest stable Next.js App Router, React, and TypeScript. Each signed-in user browses their own Google Drive, streams a video, and attaches subtitles. Provide a downloadable source ZIP, exact dependency versions and lockfile, environment template, tests, and setup instructions.

Assumptions: this is a private personal library; one Node.js application serves both the UI and streaming API. There is no public media catalog, billing, transcoding, or adaptive HLS streaming in this version.

## Architecture and alternatives

Use Next.js route handlers with the Node.js runtime for OAuth, Drive browsing, streaming, and subtitle conversion. An encrypted HttpOnly session cookie holds Google token data, with access-token refresh handled on the server. This keeps the project self-contained without requiring a database. Keep the cookie payload minimal and within browser size limits; signing out clears it. Document key rotation and the fact that individual sessions cannot be centrally revoked without server-side storage.

A separate streaming backend would offer independent scaling but adds deployment and authentication complexity. Public object storage with HLS is a better fit for a public streaming service, but moves media out of Drive and requires a processing pipeline. The single Next.js application best matches the approved personal-library scope.

## Authentication and access

Use Google's authorization-code flow with PKCE, a random state, and short-lived protected OAuth transaction cookies. Configure a fixed callback URL from the application origin. Request identity scopes and Drive read-only access, with offline access to support token refresh. Validate the returned identity token using Google's supported verification library. Never expose access or refresh tokens to client JavaScript or logs.

Use secure cookies in production, SameSite=Lax, and an encryption secret supplied through environment variables. Authenticated routes derive credentials only from the current session. Sign-out is a POST action protected by an origin check. Token refresh updates session cookies before response streaming starts; handle concurrent requests without deleting previously issued refresh tokens. Expired or revoked credentials prompt sign-in again.

Google Cloud setup must enable Drive API, configure the OAuth consent screen, add test users when appropriate, and register the exact local and production callback URLs. The README explains Drive read-only scope review requirements and testing-mode refresh-token limitations for external apps. Each user can access only files permitted by their Google account.

## Library interface

Provide a responsive, minimal dark interface with a sign-in screen, folder breadcrumbs, paginated folder listing, video search within the current folder, and clear loading, empty, and error states. Support My Drive navigation in version one; shared-drive navigation is outside this scope. Accept a Drive file link or ID as a shortcut, with metadata and download permission checked before playback.

Display file names and available size/type metadata. A selected video opens the player and lists matching subtitles from its parent folder. Automatic matching compares normalized filename stems, recognizes language suffixes such as .vi and .en, and leaves ambiguous choices to the user. Users may manually choose any SRT/VTT subtitle in that folder or upload a local file.

## Streaming contract

GET /api/video/[fileId] validates the session and file ID, retrieves metadata and download capability, then requests the Drive blob with alt=media. Support HEAD for metadata without downloading the video. Forward one valid byte Range and applicable conditional headers. Preserve upstream 200, 206, 304, and 416 semantics and relevant content headers, including Content-Range, Content-Length, Content-Type, ETag, Last-Modified, and Accept-Ranges when present.

Stream the response body directly instead of buffering the movie. Use identity transfer encoding when preserving byte lengths, propagate cancellation, and avoid caching private media in shared caches. Reject malformed and multipart ranges predictably. A Drive quota or permission error receives a safe JSON error before streaming begins. Retry authentication failures at most once after a refresh; do not retry after body transmission begins.

The application uses the original Drive file bytes, not Drive's preview transcoding. MP4 with browser-compatible video and audio codecs is the primary target. MIME type alone does not guarantee codec compatibility. Report playback failures clearly and include an optional FFmpeg conversion example in the README.

## Subtitles and player

GET /api/subtitles/[fileId] downloads an authenticated subtitle, enforcing a 2 MiB limit using metadata and a bounded read. Convert SRT to WebVTT while retaining multiline cues and supported formatting. Validate timestamps and reject malformed input with a useful error. Accept valid VTT directly. Decode UTF-8 (including BOM); provide a Windows-1258 option for local subtitle files when needed.

Local subtitles remain in browser memory and are not uploaded to Drive. Use object URLs and revoke them when replaced or unmounted. The player provides native media controls, fullscreen, language selection, subtitles off, and subtitle offset in seconds. Implement offset by rebuilding shifted cues from the original timestamps; negative offsets clip cues at zero and omit cues ending before zero. Avoid injecting subtitle content as HTML.

Remember playback position and selected subtitle/offset per video in local browser storage. Throttle writes and restore only after video metadata loads. Provide keyboard shortcuts for play/pause and short seeks, excluding editable fields. Controls have accessible names, visible focus indicators, and readable contrast.

## Modules and routes

- app/: pages, layout, and API route handlers.
- components/: folder browser, player, subtitle controls, and authentication UI.
- lib/auth/: OAuth transaction handling, encrypted sessions, identity verification, and token refresh.
- lib/drive/: authenticated metadata, folder listing, and bounded file download.
- lib/media/: range validation, streaming response handling, and filename matching.
- lib/subtitles/: parsing, conversion, decoding, and cue shifting.
- tests/: unit and route-level tests using mocked Google responses.

API endpoints: /api/auth/login, /api/auth/callback, /api/auth/logout, /api/drive/files, /api/drive/files/[fileId], /api/video/[fileId], and /api/subtitles/[fileId].

## Setup and deployment

Include .env.example for application origin, Google client ID and secret, and session encryption secret. Provide clear missing-configuration feedback without exposing values. Resolve the latest stable Next.js package at implementation time, pin actual installed versions, and commit the lockfile; exclude prereleases.

Document local npm install/dev commands, lint/typecheck/test/build commands, Google configuration, and a Node.js or Docker deployment. A long-running Node.js host is the preferred streaming deployment because the entire movie passes through the application; hosting request-duration, response-size, and egress constraints must be considered. Include a Dockerfile and .dockerignore. The source ZIP excludes node_modules, build outputs, credentials, and personal media.

## Verification and acceptance

Verify token secrecy, unauthenticated rejection, OAuth state/PKCE handling, session tampering/expiry, token refresh, paginated folder browsing, download permission failures, and safe error responses. Test normal, open-ended, suffix, invalid, and unsatisfiable Range behavior; verify streaming without full buffering and cancellation. Test subtitle conversion, multiline/BOM input, malformed cues, offset clipping, size limits, and filename matching.

Run lint, TypeScript checking, automated tests, and a production build. Inspect the responsive sign-in/library/player UI with representative mocked data. A live Google login and real Drive playback require the user's Google Cloud credentials; distinguish those unverified integrations from tests with mocked upstream responses. Deliver full runnable source, the README, and honest verification results.
