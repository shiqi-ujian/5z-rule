# 腾讯文档收集表 常驻轮询（仿 5z_build/watch.ps1）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$log = Join-Path $root '5z_build\feedback-bridge\collect.log'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '[ERROR] Node.js not found'; exit 1 }
Write-Host "收集表轮询已启动。日志: $log - Ctrl+C 停止。"
while ($true) {
  try {
    node 5z_build\feedback-bridge\collect-docs.mjs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  } catch {
    "`n[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 轮询失败: $_" | Out-File -FilePath $log -Append -Encoding utf8
  }
  Start-Sleep -Seconds 1800
}
