# nexus-cli — Specification

A CLI for downloading mods and collections from [Nexus Mods](https://www.nexusmods.com) via browser automation. Authentication is **imported from the user's existing browser** (e.g. Chrome): the user logs into Nexus normally — clearing any Cloudflare challenge and 2FA in a browser that already passes them — and the CLI reads and decrypts those cookies, then replays them into a Camoufox context for downloads.

> **Why import instead of an in-CLI login?** Driving a fresh automated browser through Nexus's interactive Cloudflare challenge proved unreliable even with a human solving it manually. The user's real browser already holds a valid, challenge-cleared session, so importing its cookies is far more robust. The captured cookies, replayed with Camoufox's consistent fingerprint (locale pinned to match the session), pass Cloudflare on subsequent download navigations.

---

## 1. Goals & non-goals

**Goals**

- Import an authenticated Nexus session from the user's existing browser, persist it, and reuse it.
- Download a single mod by id, or every mod in a collection, to a local folder.
- Work with free (non-premium) accounts by driving the website rather than the premium API.
- Be resilient to incidental site changes by isolating all site knowledge behind adapters.

**Non-goals (this version)**

- No mod installation, extraction, load-order resolution, or dependency management. Output is **raw archive files only**.
- No Nexus official API integration.
- No GUI. CLI only.
- No multi-account management beyond a single active session.
- No in-CLI interactive login (superseded by cookie import — see §1 intro).

---

## 2. Commands

### `nexus import`

Reads Nexus cookies from the user's existing browser, decrypts them, and persists them as the session. The user must already be logged into Nexus in that browser.

- **Flags**
  - `--from <browser>` — source browser to import from (default `chrome`; currently only `chrome` is supported).
  - `--validate` / `--no-validate` — when enabled (default), launches a headless Camoufox context, seeds the cookies, and confirms they authenticate (the account page loads instead of redirecting to sign-in) before saving. Also resolves the username.
- **Output**: confirmation of how many cookies were imported, and for which Nexus username (when validation resolves one).
- **Exit codes**: `0` imported, `1` no usable cookies found / cookies do not authenticate / unsupported browser.

**Cookie decryption (Chrome / macOS):** Chrome's cookie store is a SQLite DB (copied to a temp file since it is locked while Chrome runs). The `v10` AES key is derived via PBKDF2 (SHA-1, 1003 iterations, salt `saltysalt`) from the "Chrome Safe Storage" entry in the macOS Keychain; values are AES-128-CBC decrypted (IV = 16 spaces), and the 32-byte SHA-256 domain-hash prefix newer Chrome prepends is stripped. Cookies using app-bound (`v20`) encryption cannot be read; if no `v10` cookies remain, the command fails with a clear message.

### `nexus logout`

Clears the persisted cookies and session metadata.

- **Output**: confirmation, or a notice that no session existed.
- **Exit codes**: `0` always (idempotent).

### `nexus download`

Downloads a single mod or an entire collection.

- **Parameters / flags**
  - `--game <domain>` — Nexus game domain (e.g. `skyrimspecialedition`, `cyberpunk2077`). **Required.**
  - `--mod <id>` — numeric mod id. Mutually exclusive with `--collection`.
  - `--collection <slug-or-id>` — collection identifier. Mutually exclusive with `--mod`.
  - `--out <dir>` — output directory (default: `./downloads/<game>/`).
  - `--concurrency <n>` — number of simultaneous file downloads (default `2`).
  - `--dry-run` — resolve and list everything that _would_ be downloaded without fetching files.
  - `--optional` — for collections, also download files the collection marks optional (default: required files only).
  - `--headful` — show the browser window (off by default; useful for debugging).
- **Behavior**
  - On start, restores the saved session into a Camoufox context (seeds cookies) and warms it past Cloudflare by first loading the account page — which also validates the session. If no session is saved or it has expired, fails fast and tells the user to run `nexus import`.
  - With `--mod`: scrapes the mod's files page and downloads its main file(s).
  - With `--collection`: fetches the collection's pinned files from the Nexus GraphQL API and downloads each one **by its exact `fileId`** (a collection curates specific files/versions, not just mods). Optional files are skipped unless `--optional` is given. Each file is fetched via the same manual/slow-download flow as `--mod`.
- **Exit codes**: `0` all requested files downloaded, `1` one or more failed (summary printed), `2` invalid/missing/expired session.

---

## 3. Architecture

Layered, with the **adapter pattern** isolating all Nexus- and browser-specific knowledge from the application logic. Each module has a single responsibility (SRP).

```
src/
  cli/                 # argument parsing, command dispatch, user-facing output
    commands/
      import.ts
      logout.ts
      download.ts
    output.ts          # one-line user-facing messages
    wiring.ts          # composition root (the only place adapters are constructed)
  app/                 # use-cases / orchestration (no I/O details)
    importSession.ts
    restoreSession.ts
    downloadMod.ts
    downloadCollection.ts
    backoff.ts         # adaptive pacing policy (pure)
    retry.ts           # retry-with-backoff + throttle detection (pure)
  adapters/
    browser/           # Camoufox driver — launch, navigate, seed cookies, download
      CamoufoxBrowser.ts
      Browser.ts       # interface the app depends on
    cookies/           # read + decrypt cookies from an installed browser
      CookieSource.ts  # interface
      ChromeCookieSource.ts
    nexus/             # site knowledge: URLs, page scraping, GraphQL, selectors
      NexusSite.ts     # interface
      NexusWebAdapter.ts
    session/           # cookie persistence
      SessionStore.ts  # interface
      FileSessionStore.ts
    download/          # file fetching (via browser context) + writing to disk
      Downloader.ts    # interface
      BrowserDownloader.ts
  core/                # pure domain types & helpers
    types.ts           # Mod, Collection, GameDomain, Session, Cookie, etc.
    errors.ts
  config/
    paths.ts           # XDG/OS-appropriate config + download locations
```

**Dependency direction**: `cli → app → adapters (via interfaces) → core`. The `app` layer depends only on interfaces (`Browser`, `CookieSource`, `NexusSite`, `SessionStore`, `Downloader`), never on concrete implementations — so the browser engine, cookie source, or scraping strategy can be swapped without touching use-cases.

### Download mechanics

All file fetching runs **through the Camoufox browser context** rather than a separate HTTP client. The download use-case restores the saved session into a `BrowserSession` (via `setCookies`) and warms the context past Cloudflare by loading the account page.

- **Resolving what to fetch.** For `--mod`, the files page is scraped for main file(s). For `--collection`, members come from the Nexus **GraphQL API** (`api-router.nexusmods.com/graphql`, operation `CollectionRevisionMods`): the collection page renders members client-side, so they are absent from static HTML. The request is executed _inside the page_ via `fetch` (so the session cookies and `nexusmods.com` origin apply); the response yields each pinned `(game, modId, fileId, optional)` tuple, so collection downloads target exact files without re-scraping per-mod files pages.
- **Fetching a file (free "Slow download" flow).** For each file, navigate to its manual-download URL (`?tab=files&file_id=<id>`, **not** the `&nmm=1` mod-manager link) and click the _Slow download_ button. That button lives inside the `<mod-file-download>` web component's **open shadow root**, and its download URL is computed in JS on click — so there is no static URL to fetch; the click is required. Playwright's role/text selectors pierce open shadow roots, so the button is reachable.

Carrying the session cookies _and_ the Camoufox fingerprint with every request is the most robust option against Cloudflare — at the cost of speed and limited parallelism. `--concurrency` defaults to a conservative `2`.

### Navigation strategy

`goto` uses Playwright's `waitUntil: 'commit'` (resolves when the response starts) rather than `domcontentloaded`, then calls `settleChallenge()`, which polls until **(a)** no Cloudflare challenge markers are present and **(b)** the document is parsed (`readyState !== 'loading'`). This means:

- **No challenge** → returns on the first poll, no artificial delay.
- **Challenge present** → waits (up to 25s) for Camoufox to clear the non-interactive "just a moment" interstitial.

Blocking on `domcontentloaded` for heavy pages (notably the account page) caused multi-second stalls; `commit` + a readiness poll avoids waiting on trailing subresources while still guaranteeing the parsed static HTML (e.g. files-page rows) is present before scraping.

### Key interfaces (sketch)

```ts
interface Browser {
  launch(opts: { headful: boolean }): Promise<BrowserSession>;
}
interface BrowserSession {
  goto(url: string): Promise<void>; // navigates and settles any Cloudflare interstitial
  setCookies(cookies: Cookie[]): Promise<void>; // seed an imported session
  isLoggedIn(): Promise<boolean>; // validate session (loads the account page)
  html(): Promise<string>; // current page HTML, for scraping
  postJson(url, body, headers?): Promise<unknown>; // authenticated in-page fetch (GraphQL)
  resolveUsername(): Promise<string | null>;
  download(url: string, outPath: string): Promise<DownloadOutcome>; // drives the slow-download click
  close(): Promise<void>;
}

interface CookieSource {
  readonly browser: string;
  read(domainSuffix: string): Promise<Cookie[]>; // decrypts on read
}

interface NexusSite {
  modFilesUrl(game: string, modId: number): string;
  collectionUrl(game: string, ref: string): string;
  collectionMembersQuery(game: string, ref: string): JsonRequest; // GraphQL request
  parseCollectionMembers(json: unknown): CollectionMember[]; // → {game, modId, fileId, optional}[]
  fileDownloadUrl(game: string, modId: number, fileId: number): string;
  resolveDownloadLinks(html: string): DownloadTarget[];
  looksLikeAuthWall(html: string): boolean;
}

interface SessionStore {
  save(s: Session): Promise<void>;
  load(): Promise<Session | null>;
  clear(): Promise<void>;
}

interface Downloader {
  // Drives the authenticated browser context to fetch a file natively,
  // so cookies and the Camoufox fingerprint travel with the request.
  fetch(target: DownloadTarget, outDir: string, session: BrowserSession): Promise<string>;
}
```

### Scraping notes (site-specific, isolated in `NexusWebAdapter`)

- **Files page** (`--mod`): each file is a `<dt id="file-expander-header-<id>" data-name=".." data-version="..">` row inside a category section. The category is the visible header (`Main files` / `Optional files` / `Old files` / `Miscellaneous`) or the section container id (`file-container-<cat>-files`). Only **main** files are downloaded. The per-file download links are rendered client-side and absent from static HTML, so the download URL is _constructed_ from the scraped file id rather than scraped.
- **Collection** (`--collection`): the member list is **not** scraped from HTML — it comes from the GraphQL `CollectionRevisionMods` operation (slug = the collection ref), parsed from `data.collectionRevision.modFiles[]`. Each entry yields `fileId`, `optional`, and `file.mod.{modId, game.domainName}`.
- **Auth/Cloudflare detection** (`looksLikeAuthWall`): keyed on the language-independent Cloudflare challenge markers (`cdn-cgi/challenge-platform`, `cf_chl_opt`) — **not** on the localized "just a moment" text, and **not** on the `.../auth` sign-out form that normal logged-in pages legitimately contain.

---

## 4. Session & data storage

- **Cookies / session**: stored in the OS config dir (`~/.config/nexus-cli/session.json` on Linux, `~/Library/Application Support/nexus-cli/` on macOS, `%APPDATA%` on Windows) with restrictive file permissions (`600`). Contains the imported cookies, the resolved username, and an import timestamp.
- **Expiry**: a download attempt that gets redirected to login or trips the auth wall is treated as an expired session — fail with exit code `2` and prompt the user to re-run `nexus import`. No proactive expiry check.
- **Downloads**: written to `--out` (default `./downloads/<game>/`). Filenames come from the browser's reported `suggestedFilename` (server `Content-Disposition`), falling back to a slugified mod name + file id. Partial downloads go to a `.part` file and are renamed on completion; an existing completed file is skipped unless re-downloaded.
- **File selection**: for a mod with multiple files, only files Nexus categorizes as **main** are downloaded. Optional, miscellaneous, and old-version files are ignored. (A future `--files <category>` flag can widen this; out of scope now.)

---

## 5. Error handling

- All recoverable failures are surfaced as typed errors in `core/errors.ts` (`AuthError`, `ScrapeError`, `DownloadError`, `NetworkError`) and rendered as concise one-line messages by the CLI layer — no stack traces unless `--verbose`.
- Network/file fetches retry with backoff (default 3 attempts) before being counted as failed.
- Collection downloads are **best-effort**: a single mod failure does not abort the batch; failures are collected and reported in a final summary, and the process exits `1`.
- **Adaptive pacing**: collection downloads start with no inter-mod delay and the configured `--concurrency`. When the site signals throttling — HTTP 429, a Cloudflare challenge/interstitial, or repeated timeouts — the runner backs off: it inserts and progressively increases a delay between members and reduces effective concurrency, then slowly relaxes after a run of clean successes. This keeps small collections fast while staying polite on large ones. The backoff policy lives in the `app` layer so it is independent of the browser adapter.

---

## 6. Tech stack

| Concern            | Choice                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js (LTS)                                                                                     |
| Language           | TypeScript (strict)                                                                               |
| Build/bundler      | Vite (library/CLI build)                                                                          |
| Package manager    | npm                                                                                               |
| CLI arg parsing    | yargs                                                                                             |
| Browser automation | Camoufox (via `camoufox-js`, driving `playwright-core` pinned to `1.49.1`)                        |
| Cookie decryption  | Node `crypto` (PBKDF2 + AES-128-CBC); macOS Keychain via `security`; SQLite via the `sqlite3` CLI |
| Testing            | vitest                                                                                            |

> **playwright-core is pinned to `1.49.1`.** Newer versions send an `isMobile` viewport field that Camoufox's patched Firefox (Juggler) rejects on launch (`setDefaultViewport` error). `1.49.1` predates that field. Camoufox is launched with a `user_data_dir` so it returns a fully-configured `BrowserContext` — we never call `newContext()` ourselves (that path triggers the same viewport error). Launch options pin `os: 'macos'`, `humanize: true`, and `locale: 'en-US'`; `geoip` is **off** (when it resolved to a different region than the imported session, the fingerprint/cookie mismatch caused a hard Cloudflare challenge).

---

## 7. Constraints

- Clean code; small, focused modules.
- Single Responsibility Principle per module.
- Adapter pattern around every external dependency (browser, site, filesystem session, network).
- Favor reusability and maintainability: the `app` layer must remain free of Nexus-specific and Camoufox-specific details.

---

## 8. Testing

- **Runner**: vitest.
- **Scrapers** (`NexusWebAdapter`): unit-tested against checked-in HTML **fixtures** — saved snapshots of mod files pages and collection pages. Deterministic, no live dependency. Fixtures live under `test/fixtures/` and are refreshed manually when the site changes. Run with `npm test`.
- **Adapters** (`Browser`, `CookieSource`, `SessionStore`, `Downloader`): the `app` use-cases (`importSession`, `downloadMod`, `downloadCollection`) are tested against in-memory fakes of each interface. The `backoff` policy and `FileSessionStore` (including `600` permissions) have their own unit tests.
- **Live smoke tests**: a small, **opt-in** suite (gated behind an env var such as `NEXUS_LIVE_TESTS=1` and a valid session) hits Nexus for real to catch site drift the fixtures would miss. Excluded from the default `npm test` run and from CI unless explicitly enabled.

---

## 9. Decisions log

- **Auth**: **import cookies from the user's existing browser** (Chrome) instead of an in-CLI interactive login. Driving a fresh automated browser through Nexus's Cloudflare challenge was unreliable even with a human solving it; the user's real browser already holds a challenge-cleared session. (Superseded the original `nexus login` design.)
- **Cookie decryption**: read Chrome's SQLite store directly and decrypt `v10` cookies via the macOS Keychain key. App-bound (`v20`) cookies are unsupported (clear failure); a file-import fallback is a possible future addition.
- **Cloudflare**: pass it by replaying the imported session with a consistent Camoufox fingerprint — `locale` pinned to match the session, `geoip` off (a region mismatch caused hard challenges). The context is warmed on the account page before deep navigation, and `goto` waits out the non-interactive interstitial.
- **Download mechanism**: fetch through the Camoufox browser context (cookies + fingerprint travel natively), not a separate HTTP client. Free downloads require clicking the **Slow download** button inside the `<mod-file-download>` web component's open shadow root — its URL is JS-computed, so the click is mandatory.
- **Collections via GraphQL**: member files come from the `CollectionRevisionMods` GraphQL operation, not HTML scraping (the page renders members client-side). A collection pins **exact files** (`fileId` + `optional` flag), so we download those directly rather than re-deriving each mod's main file.
- **Collection output**: raw archive files only — no installation/extraction/load-order. Required files by default; `--optional` widens to optional ones.
- **Multi-file mods**: main file(s) only by default (for `--mod`).
- **Navigation**: `goto` uses `waitUntil: 'commit'` + a readiness/challenge poll, not `domcontentloaded`, to avoid multi-second stalls on heavy pages while still settling Cloudflare.
- **Rate limiting**: adaptive backoff — fast by default, slow down only when throttled/challenged.
- **Testing**: HTML fixtures for scrapers + in-memory fakes for use-cases + opt-in live smoke tests.
- **playwright-core**: pinned to `1.49.1` for Camoufox/Juggler compatibility (see §6).

### Still open

- Camoufox concurrency model: separate contexts vs. separate pages for `--concurrency` (currently sequential per browser session).
- Exact throttle-detection signals and backoff curve constants.
- Cookie sources beyond Chrome (Firefox/Edge/Safari) and a file-import fallback for app-bound (`v20`) Chrome cookies.
- The **Slow download** flow is verified for a free account on a single-file mod and collection resolution (476 files) via dry-run; a full real collection download, multi-main-file mods, and the slow-download timer (when present) still need live coverage.
