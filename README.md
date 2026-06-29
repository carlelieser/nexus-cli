# nexus-cli

Download Nexus Mods from the command line, even on a free (non-premium) account.

`nexus` reuses the session from your normal browser — where you've already
logged in and cleared Cloudflare — so it can fetch files the way the website
does, including the free "slow download". No premium API key required.

---

## Install

You don't need Node, git, or any developer tools. One command installs
everything (the `nexus` program and the browser it drives).

**macOS / Linux** — paste into a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/carlelieser/nexus-cli/main/install.sh | sh
```

**Windows** — paste into PowerShell:

```powershell
irm https://raw.githubusercontent.com/carlelieser/nexus-cli/main/install.ps1 | iex
```

The installer downloads the right build for your machine, puts `nexus` on your
PATH, and fetches the bundled browser (~150 MB, once). When it finishes, open a
**new** terminal window so PATH changes take effect.

> Prefer to do it by hand, or building from source? See
> [Manual install](#manual-install).

---

## First-time setup: give nexus your Nexus session

`nexus` needs the cookies from a browser where you're **logged in to
nexusmods.com**. The simplest, most reliable way is to export them to a file.

1. **Install a cookie-export extension.** Use
   **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)**
   (available for Chrome and Firefox). It runs entirely on your machine — nothing
   is uploaded.
2. **Go to <https://www.nexusmods.com>** and make sure you're signed in.
3. **Click the extension icon**, then **Export** (cookies.txt format). Save the
   file somewhere you can find it, e.g. your Downloads folder as
   `nexus.cookies.txt`.
4. **Import it:**

   ```sh
   nexus import --file ~/Downloads/nexus.cookies.txt
   ```

   On Windows:

   ```powershell
   nexus import --file $HOME\Downloads\nexus.cookies.txt
   ```

You should see `✓ imported N cookie(s)`. You only do this once — the session is
saved. Redo it if downloads start failing with an auth error (cookies expire).

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

| Command                      | Purpose                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `nexus setup`                | Download the bundled browser. Run by the installer; re-run if it ever goes missing. |
| `nexus import --file <path>` | Import your logged-in session from an exported cookie file.                         |
| `nexus download <url>`       | Download a mod or collection.                                                       |
| `nexus logout`               | Clear the saved session.                                                            |

Run `nexus <command> --help` for all options.

---

## Troubleshooting

**`nexus: command not found` right after installing** — open a new terminal so
the updated PATH is loaded. If it persists, the installer prints the exact line
to add to your shell profile.

**Downloads fail with an auth error** — your cookies expired. Re-export them
(steps above) and run `nexus import --file …` again.

**"browser not found" / setup didn't finish** — run `nexus setup` to (re)fetch
the browser.

**Importing from `nexus import` (without `--file`) doesn't work** — reading
cookies straight out of Chrome only works on macOS and breaks on recent Chrome
versions that encrypt them. The `--file` export above is the supported path on
every OS.

---

## Manual install

Requires Node 20+ and a clone of this repo.

```sh
git clone https://github.com/carlelieser/nexus-cli
cd nexus-cli
npm install
npm run build
node ./dist/cli/index.js setup     # fetch the browser
npm link                           # optional: put `nexus` on PATH
```

To build the standalone binaries yourself (requires [Bun](https://bun.sh)):

```sh
npm run build:binaries             # outputs to ./release
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
