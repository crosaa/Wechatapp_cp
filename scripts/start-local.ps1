$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pidFile = Join-Path $root 'server\server.pid'
$logFile = Join-Path $root 'server\server.log'
$errorFile = Join-Path $root 'server\server-error.log'

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($node) { $node.Source } else { 'D:\app\微信web开发者工具\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) {
  throw 'Node.js 22.5 or newer was not found.'
}

$listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $process = Start-Process -FilePath $nodePath -ArgumentList 'server/server.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorFile -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 1
      if ($health.ok) { break }
    } catch {}
    Start-Sleep -Milliseconds 150
  }
}

Start-Process 'http://127.0.0.1:3000/admin/'
Write-Host 'Product admin is running: http://127.0.0.1:3000/admin/'
Write-Host 'Local demo password: admin123'
