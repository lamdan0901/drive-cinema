# Drive Cinema

A personal Google Drive video library built with **Next.js 16.3.7**, **React 19.3.0**, and TypeScript. Browse your folders, play a video, and select a matching Drive subtitle or attach an SRT/VTT from your computer. The server streams the original Drive bytes, with HTTP Range support for seeking.

## Quick start

Requires Node.js **22.12+** (Node 24 LTS recommended) and npm. Extract this archive and open a terminal in `drive-cinema`.

```bash
npm ci
```

Copy `.env.example` to `.env.local` (PowerShell: `Copy-Item .env.example .env.local`). Generate a session encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fill in `.env.local`:

```dotenv
APP_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
SESSION_SECRET=the-64-hex-character-key-you-generated
```

Complete the Google setup below, then run:

```bash
npm run dev
```

Open <http://localhost:3000>. Use **Continue with Google**, open a folder, and select a video. On Windows you can run all npm commands in PowerShell. Restart the server after changing environment values.

## Google Cloud setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. Enable the **Google Drive API** under APIs & Services.
3. Configure Google Auth Platform / OAuth consent: set your app name, audience, developer contact, and required scopes. This application requests `openid`, `profile`, and `https://www.googleapis.com/auth/drive` to browse, stream, upload, rename, and move existing files/folders to Trash. If you previously signed in with read-only access, sign in again to grant the new permission.
4. If your external app is in **Testing**, add your own Google account under test users. Sign in using that account.
5. Create an OAuth client of type **Web application**. Register this exact authorized redirect URI:

   ```text
   http://localhost:3000/api/auth/callback
   ```

6. Copy the client ID and secret into `.env.local`. For production, add `https://your-domain.example/api/auth/callback` and set `APP_ORIGIN=https://your-domain.example` with no path/query.

An API key or a Google Drive share link alone cannot replace these OAuth credentials. You do not need to connect Google Drive to ChatGPT to run this application.

The Drive scope grants read and write access to files your account can access, including downloads, renaming, and deletion. It is a restricted scope. External production apps may require Google verification and, depending on their use of restricted data, a security assessment. Keep a personal testing app limited to your test accounts. Google normally expires refresh tokens after seven days for external apps in Testing when Drive scopes are requested; sign in again when that happens. Workspace policy may also prevent an account from authorizing the app.

See Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), [scope list](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), and [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

## How to use it

- Browse **My Drive** using folders and breadcrumbs. Search is limited to the current folder. **Load more** retrieves the next page.
- The floating **Upload** button at the bottom right opens the native file picker. Select one or more files to start uploading and show the progress popup. You can also drag files anywhere over the app: a drop overlay shows the destination, and releasing the files starts their uploads. Files upload into the folder selected when they were added, even if you navigate elsewhere. Progress, **Cancel**, and **Retry** are available per file; retry checks Drive's saved progress before continuing. Hide the popup without stopping uploads, then use **Show uploads** beside the Upload button to reopen it. Completed uploads refresh the folder and video sidebar. Uploads and retry state last for the current page session; keep the tab open until they finish.
- Folder navigation, the selected video, and submitted searches are saved in the URL. Reload or bookmark the page to return to the same location; browser Back/Forward also follows your navigation. Closing the player keeps the current folder.
- Use **Rename** or **Delete** beside a folder or file. Delete asks for confirmation and moves the item (including folder contents) to Google Drive Trash; restore it in Drive if needed. Actions are disabled when your account lacks the required file permissions.
- Use **Pin** beside a folder to add it to **Pinned folders**, above the normal folder view. Pins remain available as you navigate and survive reloads on this browser, separately for each Google account. **Unpin** removes only the shortcut.
- Paste a Google Drive file/folder link or file ID into **Have a link?** to jump to it. Permission and download capability are checked using the signed-in account.
- Put subtitles beside the video. Filename matching recognizes stems and language suffixes:

  ```text
  Movies/
    Movie.Name.2026.mp4
    Movie.Name.2026.vi.srt
    Movie.Name.2026.en.vtt
  ```

- The subtitle menu shows matching files first and other SRT/VTT files from the parent folder. One unique match is selected automatically. Multiple matches remain selectable.
- **Attach subtitle** opens a local SRT/VTT, up to **2 MiB**. It stays in browser memory; it is never uploaded to Drive or the application server. Reattach a local file after reloading.
- Positive timing offsets show subtitles later; negative offsets show them earlier. Use **Earlier**, **Later**, or **G/H** to adjust by **50 ms**, enter an exact delay in seconds, or **Reset** to restore original timing. Holding G/H continues adjusting; typing and modified keys are ignored. The playback bar shows the current delay, including in fullscreen. The original cues are retained, so repeated adjustments do not accumulate drift.
- Drive subtitles use UTF-8. For a local legacy Vietnamese subtitle, select **Windows-1258** if UTF-8 decoding fails. Other legacy encodings should be converted to UTF-8 first.
- Custom overlay controls from Immersive-Video-Playlist include playback, volume, a buffered seek bar, and hover timestamps. Controls hide during playback and reappear on interaction; they stay visible while using the keyboard.
- Three view modes: normal layout, **Expand to full width** (the rectangle button), and **Fullscreen** (the corner button). Expanding centers the video in the viewport; returning to **Normal view** scrolls to the top. Exiting fullscreen returns to your previous layout without restarting playback or subtitles.
- Press **P** or use the small light-gray button at the top right to show or hide a floating sidebar with all videos in the current folder, including later pages. The button sits just above the video outside fullscreen, and over the video in fullscreen. Select a video to play it. Complete folder lists are cached in memory for one hour during the current page session; successful rename or Trash operations invalidate affected folder lists.
- While a video is open, **F** toggles fullscreen and **T** switches between full-width and normal view. T leaves fullscreen before switching the page view. P, F, and T ignore text fields, modified keys, held-key repeats, and composition.
- While a video is open, shortcuts work across the page: **Space/K** toggles playback, **M** toggles mute/unmute, **Left/Right** seeks five seconds, **J/L** seeks backward/forward ten seconds, and **Up/Down** lowers/raises volume by **20 percentage points**. Text fields retain their normal behavior; modified keys and composition are ignored. Holding seek or volume keys repeats the adjustment. The seek bar also supports **Home/End**.
- Resume position and the selected Drive subtitle are stored on this browser/device. Subtitle delay is saved in local storage separately for every video–subtitle pair and restored when switching tracks or reopening a video. Local files are identified by a SHA-256 content fingerprint, so reattaching the same file restores its delay and different files with the same name retain separate delays. No playback history is stored in Drive. Changing browser or clearing site data removes these preferences.

## Video compatibility

The player uses the actual uploaded file, **not** Google's preview player or its transcoded copy. MP4 with **H.264 video + AAC audio** is the recommended starting point. MP4 is a container: a file named `.mp4` can still contain an unsupported codec. MKV, HEVC, DTS, and some multichannel audio formats depend on browser/platform support.

There is no transcoding or quality selection in this version. Convert an incompatible file locally before uploading it, for example:

```bash
ffmpeg -i input.mkv -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 192k -ac 2 -movflags +faststart output.mp4
```

`+faststart` moves MP4 metadata to the start, which helps initial playback. Conversion can take considerable time; it is optional and happens outside this app.

## Production deployment

Use a **long-running Node.js host** or container behind an HTTPS reverse proxy. All media travels through this server, so plan for its bandwidth/egress and concurrent connections. Avoid a host with short function-duration limits or response-size caps. Disable reverse-proxy response buffering on video routes and allow long requests; do not cache private API responses. Google Drive has download quotas and anti-abuse controls, so this is a personal library, not a public video CDN.

```bash
npm ci
npm run build
npm run start
```

Set the four environment variables in your host's secret settings. Do not put secrets in `NEXT_PUBLIC_*` variables. Production cookies use `Secure`, so use HTTPS for production sign-in. `APP_ORIGIN` must equal the URL you actually use and the origin of the registered callback.

Docker:

```bash
docker build -t drive-cinema .
docker run --rm -p 3000:3000 --env-file .env.production drive-cinema
```

Create `.env.production` with an **HTTPS** public origin and credentials, and put the container behind TLS. Building does not require credentials; supply them at runtime. For direct HTTP localhost testing, use `npm run dev` instead. The Docker image runs as a non-root user and includes Next.js standalone output.

## Sessions and privacy

Tokens are encrypted with AES-256-GCM in an HttpOnly, SameSite=Lax cookie. Google identity tokens are verified server-side; the OAuth transaction uses state, nonce, and PKCE. Client components receive only display data and media metadata. API responses are private/no-store.

Sessions last seven days. Access tokens refresh server-side, preserving the refresh token when Google omits it from a refresh response. Within one process, concurrent refresh requests share a bounded, short-lived refresh result. Multiple server replicas do not share that coordinator; this MVP is best deployed as a single instance. Never log cookies or Authorization headers in your hosting proxy.

**Sign out** clears the browser's cookies; it does not revoke Google's app grant or invalidate a copied cookie centrally. To revoke the grant, remove the app in your Google account's third-party connections. Rotating `SESSION_SECRET` invalidates all existing sessions. There is no session database or individual centralized revocation in this version.

The app requests Drive read and write access. Rename changes the name in Drive; Delete moves the selected file/folder to Drive Trash after confirmation. The app does not permanently delete files. Local subtitle content is not uploaded. Local-storage preferences contain file IDs, folder names/paths, and playback positions, so clear site data on a shared device. Files must allow downloads; Drive preview-only sharing cannot be bypassed.

## Troubleshooting

| Symptom                 | What to check                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Finish your setup       | Fill all `.env.local` values. The session key must be 64 hex characters. Restart the server.                                                     |
| `redirect_uri_mismatch` | Google client type is Web application; callback URI exactly matches `APP_ORIGIN` plus `/api/auth/callback`, including scheme and port.           |
| App access blocked      | Add your account as a test user; enable Drive API; check Workspace admin policies and OAuth consent configuration.                               |
| Repeated sign-in prompt | Testing-mode refresh token expired or access was revoked. Also check HTTPS/cookie settings and ensure all replicas use the same session key.     |
| Video does not play     | Check the file's download permission, account access, Drive quota, and codecs. Google preview playback does not establish browser compatibility. |
| Seeking is slow         | Drive latency, bandwidth, and original-file layout matter. Try an MP4 with `+faststart`; check host buffering and response limits.               |
| Missing subtitles       | Put them in the video's parent folder, use `.srt`/`.vtt`, UTF-8, and a matching stem. You can choose them manually or attach a local file.       |
| Garbled Vietnamese      | Attach locally and try Windows-1258, or convert the subtitle to UTF-8.                                                                           |

## Development and checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run package
```

The package command produces `dist/drive-cinema-source.zip` using an allowlist; it excludes credentials, dependencies, build output, hidden workspace data, and personal media. No git installation is required to package source.

`tests/` covers encrypted sessions, OAuth transactions, refresh coordination, metadata access, Drive pagination, Range behavior, streamed-body cancellation, subtitle parsing/limits/timing, stale UI responses, resume/storage failures, and route integration. Google responses are mocked in automated tests; they do not contact your account. See `docs/verification.md` for executed checks and remaining integration limits.

The two I/O components locally disable the React `set-state-in-effect` lint rule to synchronize async requests and object URLs; normal hook-order, dependency, and ref rules remain enabled.

## Source map

| Path                | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `src/app`           | App Router pages and HTTP endpoints                |
| `src/components`    | Folder browser, player, subtitle controls          |
| `src/lib/auth`      | Google OAuth, encryption, token refresh            |
| `src/lib/drive`     | Metadata, folder listing, bounded subtitle reads   |
| `src/lib/media`     | Range streaming, matching, keyboard/resume helpers |
| `src/lib/subtitles` | SRT/VTT parsing, decoding, serialization, offset   |
| `tests`             | Unit, component, integration and archive tests     |
| `scripts`           | Source archive generator                           |
| `Dockerfile`        | Standalone Node.js deployment                      |

API routes: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` (POST), `/api/drive/files`, `/api/drive/files/[fileId]`, `/api/video/[fileId]` (GET/HEAD), and `/api/subtitles/[fileId]`.

Shared-drive navigation, server-side progress sync, multiple server replicas with coordinated sessions, thumbnails/posters, transcoding, and public distribution are outside this version's scope.
