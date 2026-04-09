# Check Ollama API; avoid running "ollama serve" when the desktop app already uses port 11434.
$ErrorActionPreference = 'Stop'
$uri = 'http://127.0.0.1:11434/api/version'

try {
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3
    Write-Host ''
    Write-Host 'OK: Ollama is already running on 127.0.0.1:11434' -ForegroundColor Green
    Write-Host ('    ' + $r.Content.Trim())
    Write-Host ''
    Write-Host 'Do NOT run "ollama serve" - port 11434 is already in use (this is correct).' -ForegroundColor Cyan
    Write-Host 'Use Map assistant with Provider: Ollama - local.' -ForegroundColor Cyan
    Write-Host ''
    exit 0
} catch {
    Write-Host ''
    Write-Host 'Ollama is not responding on port 11434.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Fix: Open "Ollama" from the Windows Start menu (or system tray).' -ForegroundColor White
    $app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\Ollama.exe'
    if (Test-Path $app) {
        Write-Host "Or run: Start-Process '$app'" -ForegroundColor Gray
    }
    Write-Host 'Then run this script again, or use: ollama serve   (only if nothing else uses 11434)' -ForegroundColor Gray
    Write-Host ''
    exit 1
}
