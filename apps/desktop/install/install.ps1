# Installs or updates Rook on Windows, in PowerShell:
#   irm https://rook.team/install.ps1 | iex
#
# It downloads the installer of the latest release and runs it silently: Rook goes into your
# user's programs, with no admin rights, and opens. For testing before a release: CORVO_EXE, the
# installer (a URL or a local file); then the app is not opened.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Latest = 'https://github.com/corvo-technology/rook-releases/releases/latest/download'
  if ([Environment]::OSVersion.Version.Major -lt 10 -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'Rook runs on 64-bit Windows 10 or 11.'
  }
  # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $src = if ($env:CORVO_EXE) { $env:CORVO_EXE } else { "$Latest/corvo-win-x64.exe" }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("corvo-" + [Guid]::NewGuid().ToString('N') + '.exe')
  try {
    Write-Host 'Downloading Rook...'
    if ($src -match '^https?://') { Invoke-WebRequest -UseBasicParsing -Uri $src -OutFile $tmp }
    else { Copy-Item -LiteralPath $src -Destination $tmp }

    # An open Rook is asked to quit first, so its files can be replaced.
    $running = Get-Process Corvo -ErrorAction SilentlyContinue
    if ($running) {
      Write-Host 'Closing the running app...'
      $running | ForEach-Object { [void]$_.CloseMainWindow() }
      $running | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue
      if (Get-Process Corvo -ErrorAction SilentlyContinue) { throw 'The app did not close. Quit Rook and run this again.' }
    }

    Start-Process -FilePath $tmp -ArgumentList '/S' -Wait
    Write-Host 'Rook is installed.'
    if (-not $env:CORVO_EXE) {
      $exe = Join-Path $env:LOCALAPPDATA 'Programs\Corvo\Corvo.exe'
      if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}
