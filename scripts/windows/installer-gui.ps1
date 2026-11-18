# Popai Animator - installer window.
# Runs build.ps1 hidden in the background and shows its progress: a checklist of steps, an overall
# progress bar, the live network speed and (optionally) the details. No terminal needed.
# Started by "BUILD POPAI ANIMATOR.cmd".
# (ASCII only on purpose: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Here = $PSScriptRoot
$Root = Split-Path -Parent (Split-Path -Parent $Here)
$OutF = Join-Path $env:TEMP 'popai-build-out.txt'
$ErrF = Join-Path $env:TEMP 'popai-build-err.txt'
$Details = Join-Path $Root 'build-details.txt'
$Final = Join-Path $Root 'Popai Animator - Windows'

function RGB($r, $g, $b) { [System.Drawing.Color]::FromArgb($r, $g, $b) }
$BG = RGB 24 26 31; $PANEL = RGB 32 35 42; $TXT = RGB 223 227 234; $DIM = RGB 140 148 160
$RED = RGB 230 36 44; $GREEN = RGB 105 219 124; $YELLOW = RGB 255 209 102
$GLYPH = @{ wait = [string][char]0x25CB; run = [string][char]0x25B6; ok = [string][char]0x2714; fail = [string][char]0x2716 }

# ---------------------------------------------------------------- window
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Popai Animator - Installer'
$form.ClientSize = New-Object System.Drawing.Size(560, 560)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = $BG
$form.ForeColor = $TXT
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$ico = Join-Path $Root 'ui\src-tauri\icons\icon.ico'
if (Test-Path $ico) { try { $form.Icon = New-Object System.Drawing.Icon($ico) } catch {} }

function Lbl($text, $x, $y, $w, $h, $color = $TXT, $size = 9.5, $bold = $false, $font = 'Segoe UI') {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.Location = New-Object System.Drawing.Point($x, $y); $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = $color; $l.BackColor = [System.Drawing.Color]::Transparent
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $l.Font = New-Object System.Drawing.Font($font, $size, $style)
  $form.Controls.Add($l); return $l
}

$logoPath = Join-Path $Here 'popai-logo.png'
if (Test-Path $logoPath) {
  $pic = New-Object System.Windows.Forms.PictureBox
  $pic.Image = [System.Drawing.Image]::FromFile($logoPath)
  $pic.SizeMode = 'Zoom'; $pic.Location = New-Object System.Drawing.Point(20, 14); $pic.Size = New-Object System.Drawing.Size(200, 88)
  $pic.BackColor = [System.Drawing.Color]::Transparent
  $form.Controls.Add($pic)
}
$null = Lbl 'Windows app builder' 236 34 300 26 $TXT 13 $true
$null = Lbl 'Installs the tools that are missing, then builds Popai Animator on this PC.' 236 62 310 40 $DIM 9

# checklist
$STEPS = @(
  @{ id = 'check'; name = 'Checking this PC'; size = ''; w = 2 },
  @{ id = 'cpp'; name = 'Microsoft C++ build tools'; size = 'about 1.5-2 GB, first time only'; w = 35 },
  @{ id = 'rust'; name = 'Rust compiler'; size = 'about 200 MB'; w = 12 },
  @{ id = 'node'; name = 'Node.js'; size = 'about 30 MB'; w = 3 },
  @{ id = 'npm'; name = 'Interface packages'; size = 'about 25 MB'; w = 6 },
  @{ id = 'build'; name = 'Building Popai Animator'; size = '5-15 minutes'; w = 42 }
)
$panel = New-Object System.Windows.Forms.Panel
$panel.Location = New-Object System.Drawing.Point(20, 116); $panel.Size = New-Object System.Drawing.Size(520, 222); $panel.BackColor = $PANEL
$form.Controls.Add($panel)
$UI = @{}
$y = 10
foreach ($s in $STEPS) {
  $g = New-Object System.Windows.Forms.Label
  $g.Text = $GLYPH.wait; $g.Location = New-Object System.Drawing.Point(12, $y); $g.Size = New-Object System.Drawing.Size(24, 26)
  $g.Font = New-Object System.Drawing.Font('Segoe UI Symbol', 12); $g.ForeColor = $DIM; $panel.Controls.Add($g)
  $n = New-Object System.Windows.Forms.Label
  $n.Text = $s.name; $n.Location = New-Object System.Drawing.Point(40, ($y + 1)); $n.Size = New-Object System.Drawing.Size(220, 20)
  $n.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold); $n.ForeColor = $DIM; $panel.Controls.Add($n)
  $d = New-Object System.Windows.Forms.Label
  $d.Text = $s.size; $d.Location = New-Object System.Drawing.Point(40, ($y + 19)); $d.Size = New-Object System.Drawing.Size(470, 16)
  $d.Font = New-Object System.Drawing.Font('Segoe UI', 8.5); $d.ForeColor = $DIM; $panel.Controls.Add($d)
  $UI[$s.id] = @{ g = $g; n = $n; d = $d; state = 'wait'; size = $s.size; w = $s.w }
  $y += 35
}

$act = Lbl 'Starting...' 20 350 520 36 $TXT 9.5
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 390); $bar.Size = New-Object System.Drawing.Size(520, 18); $bar.Style = 'Continuous'; $bar.Maximum = 1000
$form.Controls.Add($bar)
$busy = New-Object System.Windows.Forms.ProgressBar
$busy.Location = New-Object System.Drawing.Point(20, 411); $busy.Size = New-Object System.Drawing.Size(520, 5); $busy.Style = 'Marquee'; $busy.MarqueeAnimationSpeed = 30
$form.Controls.Add($busy)
$net = Lbl '' 20 422 360 20 $DIM 9
$clock = Lbl '' 380 422 160 20 $DIM 9
$clock.TextAlign = 'TopRight'

$more = New-Object System.Windows.Forms.LinkLabel
$more.Text = 'Show details'; $more.Location = New-Object System.Drawing.Point(20, 448); $more.Size = New-Object System.Drawing.Size(120, 20)
$more.LinkColor = $DIM; $more.ActiveLinkColor = $TXT; $more.BackColor = [System.Drawing.Color]::Transparent
$form.Controls.Add($more)
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.ReadOnly = $true; $box.ScrollBars = 'Vertical'; $box.WordWrap = $false
$box.Location = New-Object System.Drawing.Point(20, 474); $box.Size = New-Object System.Drawing.Size(520, 200)
$box.BackColor = RGB 17 19 24; $box.ForeColor = RGB 180 188 200; $box.Font = New-Object System.Drawing.Font('Consolas', 8.5)
$box.Visible = $false
$form.Controls.Add($box)

function Btn($text, $x, $w) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text; $b.Location = New-Object System.Drawing.Point($x, 510); $b.Size = New-Object System.Drawing.Size($w, 34)
  $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderColor = RGB 70 76 88; $b.BackColor = $PANEL; $b.ForeColor = $TXT
  $form.Controls.Add($b); return $b
}
$btnA = Btn 'Cancel' 400 140      # right button: Cancel / Close
$btnB = Btn '' 230 160            # middle button: Install now / Try again
$btnC = Btn '' 20 150             # left button: Open folder / Open details
$btnB.Visible = $false; $btnC.Visible = $false

function Layout {
  $extra = if ($box.Visible) { 210 } else { 0 }
  $form.ClientSize = New-Object System.Drawing.Size(560, (560 + $extra))
  foreach ($b in @($btnA, $btnB, $btnC)) { $b.Top = 510 + $extra }
  $more.Text = if ($box.Visible) { 'Hide details' } else { 'Show details' }
}
$more.Add_LinkClicked({ $box.Visible = -not $box.Visible; Layout })

# ---------------------------------------------------------------- state
$script:proc = $null
$script:pos = @{ out = 0L; err = 0L }
$script:part = @{ out = ''; err = '' }
$script:phase = 'idle'     # running / done / failed / cancelled
$script:current = $null
$script:compiled = 0
$script:started = Get-Date
$script:lastNet = $null
$script:lastNetTime = $null
$script:netStart = $null
$script:failMsg = ''
$script:lines = New-Object System.Collections.Generic.List[string]

function SetStep($id, $state, $text) {
  $u = $UI[$id]; if (-not $u) { return }
  $u.state = $state
  switch ($state) {
    'run' { $u.g.Text = $GLYPH.run; $u.g.ForeColor = $YELLOW; $u.n.ForeColor = $TXT; $u.d.ForeColor = $YELLOW; $script:current = $id }
    'ok' { $u.g.Text = $GLYPH.ok; $u.g.ForeColor = $GREEN; $u.n.ForeColor = $TXT; $u.d.ForeColor = $DIM }
    'fail' { $u.g.Text = $GLYPH.fail; $u.g.ForeColor = $RED; $u.n.ForeColor = $TXT; $u.d.ForeColor = $RED }
    default { $u.g.Text = $GLYPH.wait; $u.g.ForeColor = $DIM; $u.n.ForeColor = $DIM; $u.d.ForeColor = $DIM }
  }
  if ($text) { $u.d.Text = $text } elseif ($state -eq 'wait') { $u.d.Text = $u.size }
}
function Overall {
  $sum = 0.0
  foreach ($s in $STEPS) {
    $u = $UI[$s.id]
    if ($u.state -eq 'ok') { $sum += $u.w }
    elseif ($u.state -eq 'run' -and $s.id -eq 'build') { $sum += $u.w * [Math]::Min(0.97, $script:compiled / 380.0) }
  }
  $v = [int]($sum * 10); if ($v -gt 1000) { $v = 1000 }; if ($v -lt 0) { $v = 0 }
  $bar.Value = $v
}
function Clean($t) { ($t -replace '[^\x20-\x7E]', ' ').Trim() }
function AddLine($t) {
  $script:lines.Add($t); if ($script:lines.Count -gt 400) { $script:lines.RemoveRange(0, 100) }
  if ($box.Visible) { $box.AppendText($t + "`r`n") }
}
function Handle($line, $isErr) {
  $t = Clean $line
  if (-not $t) { return }
  if ($t.StartsWith('@@STEP|')) {
    $p = $t.Split('|'); $txt = if ($p.Count -gt 3) { $p[3] } else { '' }
    SetStep $p[1] $p[2] $txt
    if ($p[2] -eq 'run') { $act.Text = $UI[$p[1]].n.Text + ': ' + $txt }
    return
  }
  if ($t.StartsWith('@@FAIL|')) { $script:failMsg = $t.Substring(7); return }
  if ($t.StartsWith('@@DONE|')) { $script:phase = 'done-pending'; return }
  AddLine $t
  if ($t -match '^Compiling (\S+)') { $script:compiled++; $act.Text = "Compiling $($Matches[1])  ($($script:compiled) of about 380 parts)"; return }
  if ($t -match '^Downloaded |^Downloading crates') { $act.Text = 'Downloading Rust packages...'; return }
  if ($t -match '^Finished ') { $act.Text = 'Compiled - packing the installer...'; return }
  if ($t -match '^Running makensis|^Info Target|Bundling') { $act.Text = 'Packing the installer...'; return }
  if ($t.StartsWith('==> ')) { $act.Text = $t.Substring(4); return }
  if ($t.Length -lt 150 -and $t -notmatch '^[\-\\|/ ]+$' -and $t -notmatch '^\[') { if ($script:current -ne 'build') { $act.Text = $t } }
}
function ReadNew($which, $path) {
  if (-not (Test-Path $path)) { return }
  try {
    $fs = New-Object System.IO.FileStream($path, 'Open', 'Read', 'ReadWrite, Delete')
    try {
      $len = $fs.Length; $p = $script:pos[$which]
      if ($len -le $p) { return }
      $fs.Seek($p, 'Begin') | Out-Null
      $n = [int][Math]::Min($len - $p, 1048576)
      $buf = New-Object byte[] $n
      $got = $fs.Read($buf, 0, $n)
      $script:pos[$which] = $p + $got
      $text = $script:part[$which] + [System.Text.Encoding]::Default.GetString($buf, 0, $got)
    } finally { $fs.Close() }
    $parts = $text -split "`r`n|`n|`r"
    $script:part[$which] = $parts[$parts.Count - 1]
    for ($i = 0; $i -lt $parts.Count - 1; $i++) { Handle $parts[$i] ($which -eq 'err') }
  } catch {}
}
function NetBytes {
  $s = 0L
  foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($n.OperationalStatus -eq 'Up' -and $n.NetworkInterfaceType -ne 'Loopback') { try { $s += $n.GetIPv4Statistics().BytesReceived } catch {} }
  }
  return $s
}
function Mb($b) { '{0:N1} MB' -f ($b / 1MB) }

function StartBuild {
  foreach ($f in @($OutF, $ErrF)) { try { Set-Content -Path $f -Value '' -NoNewline } catch {} }
  $script:pos = @{ out = 0L; err = 0L }; $script:part = @{ out = ''; err = '' }
  $script:compiled = 0; $script:failMsg = ''; $script:current = $null; $script:lines.Clear(); $box.Clear()
  foreach ($s in $STEPS) { SetStep $s.id 'wait' '' }
  $script:started = Get-Date; $script:netStart = NetBytes; $script:lastNet = $script:netStart; $script:lastNetTime = Get-Date
  $bar.Value = 0; $busy.Visible = $true; $act.ForeColor = $TXT; $act.Text = 'Starting...'
  $btnA.Text = 'Cancel'; $btnB.Visible = $false; $btnC.Visible = $false
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $inner = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Here 'build.ps1') + '" -Gui > "' + $OutF + '" 2> "' + $ErrF + '"'
  $psi.Arguments = '/s /c "' + $inner + '"'
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.WorkingDirectory = $Root
  $script:proc = [System.Diagnostics.Process]::Start($psi)
  $script:phase = 'running'
}
function SaveDetails {
  try {
    $o = if (Test-Path $OutF) { Get-Content $OutF -Raw } else { '' }
    $e = if (Test-Path $ErrF) { Get-Content $ErrF -Raw } else { '' }
    Set-Content -Path $Details -Value ("=== output ===`r`n" + $o + "`r`n=== messages ===`r`n" + $e)
  } catch {}
}
function Finish($ok) {
  ReadNew 'out' $OutF; ReadNew 'err' $ErrF
  $busy.Visible = $false; SaveDetails
  if ($ok) {
    $script:phase = 'done'; $bar.Value = 1000
    foreach ($s in $STEPS) { if ($UI[$s.id].state -ne 'ok') { SetStep $s.id 'ok' '' } }
    $act.ForeColor = $GREEN; $act.Text = 'Done! Popai Animator is ready. Install it, or open the folder with the portable version.'
    $btnA.Text = 'Close'; $btnB.Text = 'Install Popai Animator'; $btnB.Visible = $true; $btnC.Text = 'Open folder'; $btnC.Visible = $true
  } else {
    $script:phase = 'failed'
    if ($script:current) { SetStep $script:current 'fail' '' }
    $msg = if ($script:failMsg) { $script:failMsg } else { 'the build stopped unexpectedly' }
    $act.ForeColor = $RED; $act.Text = 'Stopped: ' + $msg
    $btnA.Text = 'Close'; $btnB.Text = 'Try again'; $btnB.Visible = $true; $btnC.Text = 'Open details'; $btnC.Visible = $true
    if (-not $box.Visible) { $box.Visible = $true; $box.Text = ($script:lines | Select-Object -Last 120) -join "`r`n"; $box.SelectionStart = $box.Text.Length; $box.ScrollToCaret(); Layout }
  }
}
function StopBuild {
  if ($script:proc -and -not $script:proc.HasExited) {
    try { Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', $script:proc.Id, '/T', '/F') -WindowStyle Hidden -Wait } catch {}
  }
}

# ---------------------------------------------------------------- events
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$script:tick = 0
$timer.Add_Tick({
  if ($script:phase -ne 'running' -and $script:phase -ne 'done-pending') { return }
  ReadNew 'out' $OutF; ReadNew 'err' $ErrF
  Overall
  $script:tick++
  $el = (Get-Date) - $script:started
  $clock.Text = 'Elapsed {0:D2}:{1:D2}:{2:D2}' -f [int][Math]::Floor($el.TotalHours), $el.Minutes, $el.Seconds
  if ($script:tick % 2 -eq 0) {
    $nb = NetBytes; $now = Get-Date; $dt = ($now - $script:lastNetTime).TotalSeconds
    if ($dt -gt 0) {
      $sp = ($nb - $script:lastNet) / $dt; if ($sp -lt 0) { $sp = 0 }
      $net.Text = ('Network: {0}/s  -  {1} received since start (whole PC)' -f (Mb $sp), (Mb ($nb - $script:netStart)))
    }
    $script:lastNet = $nb; $script:lastNetTime = $now
  }
  if ($script:proc -and $script:proc.HasExited) {
    Start-Sleep -Milliseconds 300
    ReadNew 'out' $OutF; ReadNew 'err' $ErrF
    Finish ($script:phase -eq 'done-pending' -and (Test-Path (Join-Path $Final 'Popai Animator Setup.exe')))
  }
})
$btnA.Add_Click({
  if ($script:phase -eq 'running') {
    $r = [System.Windows.Forms.MessageBox]::Show('Stop the build? You can start it again later; finished downloads are kept.', 'Popai Animator', 'YesNo', 'Question')
    if ($r -eq 'Yes') { StopBuild; $script:phase = 'cancelled'; $busy.Visible = $false; $act.ForeColor = $YELLOW; $act.Text = 'Stopped by you.'; $btnA.Text = 'Close'; $btnB.Text = 'Start again'; $btnB.Visible = $true }
  } else { $form.Close() }
})
$btnB.Add_Click({
  if ($script:phase -eq 'done') { $setup = Join-Path $Final 'Popai Animator Setup.exe'; if (Test-Path $setup) { Start-Process $setup } }
  else { StartBuild }
})
$btnC.Add_Click({
  if ($script:phase -eq 'done') { Start-Process explorer.exe $Final }
  else { SaveDetails; Start-Process notepad.exe $Details }
})
$form.Add_FormClosing({
  param($sender, $e)
  if ($script:phase -eq 'running') {
    $r = [System.Windows.Forms.MessageBox]::Show('The build is still running. Stop it and close?', 'Popai Animator', 'YesNo', 'Warning')
    if ($r -ne 'Yes') { $e.Cancel = $true; return }
    StopBuild
  }
  $timer.Stop()
})
$form.Add_Shown({ Layout; $timer.Start(); StartBuild })

[void]$form.ShowDialog()
