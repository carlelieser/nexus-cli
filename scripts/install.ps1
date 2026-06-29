# Install the nexus CLI from the latest GitHub release.
#   irm https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo = 'carlelieser/nexus-cli'
$binName = 'nexus'
$installDir = if ($env:NEXUS_INSTALL_DIR) { $env:NEXUS_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\nexus" }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64') {
  Write-Error "Unsupported architecture: $arch. Install via npm instead."
}

$asset = "$binName-win-x64.exe"
$url = "https://github.com/$repo/releases/latest/download/$asset"
$target = Join-Path $installDir "$binName.exe"

Write-Host "Downloading $asset..."
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -Uri $url -OutFile $target

Write-Host "Installed to $target"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $installDir) {
  $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$env:Path;$installDir"
  Write-Host "Added $installDir to your PATH."
}

Write-Host "Done. Run '$binName --help' to get started."
