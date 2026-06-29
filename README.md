# nexus-cli

Download Nexus Mods from the command line, even on a free (non-premium) account.

`nexus` reuses the session from your normal browser — where you've already
logged in and cleared Cloudflare — so it can fetch files the way the website
does, including the free "slow download". No premium API key required.

---

## Install

Requires [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install -g nexus-cli
```

---

## First-time setup: give nexus your Nexus session

`nexus` reads the cookies from a browser where you're **logged in to
nexusmods.com** and saves them as a reusable session.

```sh
nexus import --from chrome
```

Supported browsers: `chrome`, `brave`, `edge`, `opera`, `vivaldi`, `arc`,
`firefox`, `safari`. On macOS this may prompt once for Keychain or Full Disk
Access (Safari).

You should see `✓ imported N cookie(s)`. You only do this once — the session is
saved. Redo it if downloads start failing with an auth error (cookies expire).

### Alternative: import from an exported cookie file

If reading the browser directly doesn't work for you, export the cookies with a
browser extension such as **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)**
(while signed in to nexusmods.com), then:

```sh
nexus import --file ~/Downloads/nexus.cookies.txt
```

---

## Download mods

A single mod (downloads its main file(s)):

```sh
nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604
```

A whole collection:

```sh
nexus download https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123
```

Useful flags:

| Flag                | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `--out <dir>`       | Where to save files (defaults to a per-game folder).     |
| `--optional`        | Also download files a collection marks optional.         |
| `--dry-run`         | List what would be downloaded without fetching anything. |
| `--concurrency <n>` | How many mods to fetch at once in a collection.          |
| `--verbose`         | Print full error details.                                |

Press **Ctrl+C** any time to stop; the current file is cleaned up.

---

## Commands

| Command                         | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `nexus import --from <browser>` | Read your logged-in session from an installed browser. |
| `nexus import --file <path>`    | Import your session from an exported cookie file.      |
| `nexus download <url>`          | Download a mod or collection.                          |
| `nexus logout`                  | Clear the saved session.                               |

Run `nexus <command> --help` for all options.

---

## Troubleshooting

**Downloads fail with an auth error** — your cookies expired. Re-run
`nexus import --from <browser>` (or re-export and `nexus import --file …`).

**`nexus import --from <browser>` reads no cookies** — make sure you're logged
in to nexusmods.com in that browser, and that the browser is closed if it locks
its cookie database. Otherwise use the `--file` path above.

---

## From source

Requires Node 20+ and a clone of this repo.

```sh
git clone https://github.com/carlelieser/nexus-cli
cd nexus-cli
npm install
npm run build
npm link            # optional: put `nexus` on PATH
```

---

## How it works

`nexus` launches a stealth browser (Camoufox), seeds it with your imported
cookies, and drives the site's own "slow download" button to obtain a signed CDN
URL — then streams the file directly from Node. All Nexus-specific knowledge
(page structure, the GraphQL API for collections) is isolated in the adapter
layer; the core download logic is browser- and site-agnostic.

This is an **unofficial** tool, not affiliated with Nexus Mods. Use it within
their terms of service.
