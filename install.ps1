# nexus-cli installer for Windows.
#
#   irm https://raw.githubusercontent.com/carlelieser/nexus-cli/main/install.ps1 | iex
#
# Downloads the prebuilt nexus.exe, puts it on PATH, and fetches the browser it
# needs. No Node, no git, no build.
$ErrorActionPreference = 'Stop'

$Repo = 'carlelieser/nexus-cli'
$Asset = 'nexus-win-x64.exe'
$InstallDir = if ($env:NEXUS_INSTALL_DIR) { $env:NEXUS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\nexus-cli' }

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  throw 'nexus-cli requires 64-bit Windows.'
}

# --- download ---------------------------------------------------------------
$Url = "https://github.com/$Repo/releases/latest/download/$Asset"
Write-Host "Downloading $Asset..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Target = Join-Path $InstallDir 'nexus.exe'
Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing

# --- PATH (persist for the user) -------------------------------------------
$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($UserPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$UserPath;$InstallDir", 'User')
  $env:Path = "$env:Path;$InstallDir"
  Write-Host "Added $InstallDir to your PATH (restart open terminals to pick it up)."
}

# --- fetch the browser ------------------------------------------------------
Write-Host 'Setting up the browser (one-time, ~150 MB)...'
& $Target setup
if ($LASTEXITCODE -ne 0) {
  throw "browser setup failed; re-run later with: nexus setup"
}

Write-Host ''
Write-Host 'Installed. Next:'
Write-Host '  1. In your browser (logged in to nexusmods.com), export cookies with the'
Write-Host '     "Get cookies.txt LOCALLY" extension and save the file.'
Write-Host '  2. nexus import --file C:\path\to\nexus.cookies.txt'
Write-Host '  3. nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604'
