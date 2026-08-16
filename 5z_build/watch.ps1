# 5z 规则自动监视：监听 incoming/ 目录，出现新 CHM 后自动执行一键更新（解压→构建→检查→同步→提交→推送）
$root = Split-Path -Parent $PSScriptRoot
$incoming = Join-Path $root 'incoming'
$log = Join-Path $PSScriptRoot 'watch.log'
if (-not (Test-Path $incoming)) { New-Item -ItemType Directory -Path $incoming | Out-Null }

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

# 等待文件写完：连续 1 秒大小不变视为稳定（最多等 60 秒）
function Wait-Stable($file) {
  $lastSize = -1
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path $file)) { return $false }
    $sz = (Get-Item $file).Length
    if ($sz -eq $lastSize) { return $true }
    $lastSize = $sz
  }
  return $true
}

Write-Log "开始监视 $incoming （把新 CHM 丢进来即自动更新上线，Ctrl+C 退出）"

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $incoming
$watcher.Filter = '*.chm'
$watcher.IncludeSubdirectories = $false

while ($true) {
  $evt = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Created -bor [System.IO.WatcherChangeTypes]::Changed, 1000)
  if ($evt.TimedOut) { continue }
  $chm = Join-Path $incoming $evt.Name
  if (-not (Test-Path $chm)) { continue }
  if (-not (Wait-Stable $chm)) { continue }
  Write-Log "检测到新 CHM: $($evt.Name)，开始自动更新..."
  Push-Location $root
  node "$PSScriptRoot\update.mjs" $chm *>> $log
  $code = $LASTEXITCODE
  Pop-Location
  Write-Log "更新结束，exit=$code"
}
