$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pidFile = Join-Path $root 'server\server.pid'

if (Test-Path -LiteralPath $pidFile) {
  $serverPid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
  Stop-Process -Id $serverPid -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
  Write-Host 'Local product service stopped.'
} else {
  Write-Host 'No running local product service was found.'
}
