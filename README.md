# nexus-cli

Download Nexus Mods from the command line on a free account.

## Install

```sh
npm install -g nexus-cli
```

Requires Node.js 20+.

## Usage

Import your logged-in session from your browser (once):

```sh
nexus import --from chrome
```

Download a mod:

```sh
nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604
```

Download a collection:

```sh
nexus download https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123
```

Run `nexus --help` for all commands and flags.
