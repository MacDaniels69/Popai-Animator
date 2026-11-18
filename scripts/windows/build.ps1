# Popai Animator - one-click Windows build.
# Started by "BUILD POPAI ANIMATOR.cmd". Installs only the tools that are missing, builds the app,
# then opens the finished installer. Everything is logged to build-log.txt.
# (ASCII only on purpose: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.)

# Native tools (rustup, npm, cargo) print progress on stderr; with 'Stop' Windows PowerShell 5.1 can
# treat that as an error, so failures are detected from exit codes instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Log = Join-Path $Root 'build-log.txt'
try { Start-Transcript -Path $Log -Force | Out-Null } catch {}

function Say($msg, $color = 'Cyan') { Write-Host ''; Write-Host "==> $msg" -ForegroundColor $color }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.cargo\bin;$env:ProgramFiles\nodejs"
}
function Fail($msg) {
  Write-Host ''; Write-Host "BUILD STOPPED: $msg" -ForegroundColor Red
  Write-Host "Details are in: $Log" -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch {}
  Read-Host 'Press Enter to close'
  exit 1
}
# (named InstallPkg, not Winget: PowerShell prefers functions over programs of the same name)
function InstallPkg($id, $extra) {
  $wargs = @('install', '--id', $id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements') + $extra
  & winget.exe @wargs
  if ($LASTEXITCODE -ne 0) { Write-Host "winget finished with code $LASTEXITCODE for $id - checking whether it is usable anyway..." -ForegroundColor Yellow }
  RefreshPath
}

Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host '   Popai Animator - building the Windows app' -ForegroundColor White
Write-Host '   Please keep this window open. The first build can take a while.' -ForegroundColor Gray
Write-Host '==============================================================' -ForegroundColor DarkCyan

# --- sanity checks --------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $Root 'ui\package.json'))) { Fail 'project files not found. Extract the whole zip to a folder first (for example C:\PopaiAnimator), then double-click the BUILD file inside it.' }
if ($Root.Length -gt 80) { Write-Host "Note: the folder path is long ($Root). If the build fails, move the folder to C:\PopaiAnimator." -ForegroundColor Yellow }
$drive = (Get-Item $Root).PSDrive
if ($drive.Free -lt 12GB) { Write-Host ("Warning: only {0:N1} GB free on drive {1}:. The tools and build need about 12 GB." -f ($drive.Free / 1GB), $drive.Name) -ForegroundColor Yellow }
if (-not (Have 'winget.exe')) { Fail "the Windows package installer (winget / 'App Installer') is missing. Install 'App Installer' from the Microsoft Store, then double-click the BUILD file again." }
RefreshPath

# --- 1. Microsoft C++ build tools (needed by Rust on Windows) --------------------------------
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
function HasVC { (Test-Path $vswhere) -and [bool](& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) }
if (HasVC) { Say 'C++ build tools: already installed' 'Green' }
else {
  Say 'Installing Microsoft C++ build tools (largest download, about 1.5-2 GB). Windows may ask for permission - click Yes.'
  InstallPkg 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621')
  if (-not (HasVC)) {
    # Build Tools is present but without the C++ compiler (e.g. an earlier install was cut short):
    # add the missing parts to the existing installation with the Visual Studio Installer.
    $setup = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'
    $paths = @()
    if (Test-Path $vswhere) { $paths = @(& $vswhere -products * -all -property installationPath) | Where-Object { $_ } }
    if ((Test-Path $setup) -and $paths.Count -gt 0) {
      foreach ($ip in $paths) {
        Say "Adding the C++ compiler to the existing Build Tools in $ip (downloads about 1.5-2 GB, no progress bar - please wait)..."
        $margs = @('modify', '--installPath', "`"$ip`"", '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                   '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621', '--includeRecommended', '--quiet', '--norestart', '--nocache')
        $pr = Start-Process -FilePath $setup -ArgumentList $margs -Wait -PassThru
        Write-Host "Visual Studio Installer finished with code $($pr.ExitCode)"
        # the installer can hand work to background processes; wait until they are done
        $t = 0
        while ((Get-Process -Name 'setup', 'vs_installer', 'vs_installershell', 'vs_setup_bootstrapper' -ErrorAction SilentlyContinue) -and $t -lt 7200) { Start-Sleep 15; $t += 15 }
        if (HasVC) { break }
      }
    }
  }
  if (-not (HasVC)) { Fail 'the C++ build tools did not finish installing. Open "Visual Studio Installer" from the Start menu, click Modify on Build Tools 2022, tick "Desktop development with C++", click Modify, wait for it to finish, then double-click the BUILD file again.' }
}

# --- 2. Rust ---------------------------------------------------------------------------------
if (Have 'cargo') { Say 'Rust: already installed' 'Green' }
else {
  Say 'Installing Rust (about 200 MB)...'
  InstallPkg 'Rustlang.Rustup' @()
  if (-not (Have 'rustup')) { Fail 'Rust did not install. Restart the PC and try again.' }
}
& rustup set profile minimal
& rustup default stable-msvc
if ($LASTEXITCODE -ne 0) { Fail 'could not set up the Rust compiler' }

# --- 3. Node.js ------------------------------------------------------------------------------
if (Have 'node') { Say 'Node.js: already installed' 'Green' }
else {
  Say 'Installing Node.js (about 30 MB)...'
  InstallPkg 'OpenJS.NodeJS.LTS' @()
  if (-not (Have 'node')) { Fail 'Node.js did not install. Restart the PC and try again.' }
}

# --- 4. build --------------------------------------------------------------------------------
Set-Location (Join-Path $Root 'ui')
Say 'Downloading the interface packages (about 25 MB)...'
& npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'downloading the interface packages failed (check the internet connection)' }

Say 'Building Popai Animator (first time: 5-15 minutes, downloads about 25 MB of Rust packages)...'
& npx tauri build
if ($LASTEXITCODE -ne 0) { Fail 'the app build failed' }

# --- 5. hand over ----------------------------------------------------------------------------
$out = Join-Path $Root 'Popai Animator - Windows'
New-Item -ItemType Directory -Force $out | Out-Null
$installer = Get-ChildItem (Join-Path $Root 'ui\src-tauri\target\release\bundle\nsis') -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { Fail 'the installer was not produced' }
Copy-Item $installer.FullName (Join-Path $out 'Popai Animator Setup.exe') -Force
Copy-Item (Join-Path $Root 'ui\src-tauri\target\release\popai-animator.exe') (Join-Path $out 'Popai Animator (portable).exe') -Force

Say 'DONE! Popai Animator was built successfully.' 'Green'
Write-Host "Your files are in: $out" -ForegroundColor White
Write-Host '  - Popai Animator Setup.exe      installs the app (Start menu + desktop shortcut)' -ForegroundColor Gray
Write-Host '  - Popai Animator (portable).exe runs without installing' -ForegroundColor Gray
Write-Host 'If Windows shows "Windows protected your PC", click More info, then Run anyway.' -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch {}
Start-Process explorer.exe $out
Start-Process (Join-Path $out 'Popai Animator Setup.exe')
Read-Host 'Press Enter to close this window'
