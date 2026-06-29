# Nexus CLI

Enables automated downloads of individual mods and collections from [Nexus](https://nexusmods.com) without a premium
subscription.

![nexus downloading a collection](https://raw.githubusercontent.com/carlelieser/nexus-cli/main/docs/demo.png)

> **Note:** this does not unlock premium download speeds. It uses the same free
> "slow download" the website gives you — it just saves you from clicking
> through every mod and collection by hand.

## Install

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.ps1 | iex
```

Node.JS:

```sh
npm install -g @carlelieser/nexus-cli
```

### Manual

[latest release](https://github.com/carlelieser/nexus-cli/releases/latest):
`nexus-macos-arm64`, `nexus-macos-x64`, `nexus-linux-x64`, or `nexus-win-x64.exe`.

## Usage

Log in to [Nexus](https://users.nexusmods.com/) in your browser and run the following command to import your session.

```sh
nexus import --from chrome
```

Download an individual mod:

```sh
nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604
```

Download an entire collection:

```sh
nexus download https://www.nexusmods.com/games/skyrimspecialedition/collections/llafgc
```

Hand the download off to your mod manager:

```sh
nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604 --nmm
# Works on collections, too!
nexus download https://www.nexusmods.com/games/skyrimspecialedition/collections/llafgc --nmm
```

Run `nexus --help` for all commands and flags.
