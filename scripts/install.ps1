# Install the nexus CLI from the latest GitHub release.
#   irm https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo = 'carlelieser/nexus-cli'
$installDir = if ($env:NEXUS_INSTALL_DIR) { $env:NEXUS_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\nexus" }

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  Write-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE. Install via npm instead."
}

$name = 'nexus-win-x64'
$url = "https://github.com/$repo/releases/latest/download/$name.zip"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "$name.zip"

Write-Host "Downloading $name..."
Invoke-WebRequest -Uri $url -OutFile $tmp

# Replace any prior install so upgrades are clean.
if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Expand-Archive -Path $tmp -DestinationPath $installDir -Force
Remove-Item $tmp

# The zip contains a top-level nexus-win-x64\ folder; the launcher lives there.
$appDir = Join-Path $installDir $name

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $appDir) {
  $newPath = if ($userPath) { "$userPath;$appDir" } else { $appDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$env:Path;$appDir"
  Write-Host "Added $appDir to your PATH."
}

Write-Host "Done. Run 'nexus --help' to get started."
