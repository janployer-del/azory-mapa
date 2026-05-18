$ErrorActionPreference = "Stop"

$mapRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $mapRoot

if (-not $env:NOTION_TOKEN) {
    $userToken = [Environment]::GetEnvironmentVariable("NOTION_TOKEN", "User")
    if ($userToken) {
        $env:NOTION_TOKEN = $userToken
    }
}

if (-not $env:NOTION_TOKEN) {
    throw "Promenna NOTION_TOKEN neni nastavena ani v aktualni PowerShell relaci, ani jako uzivatelska promenna Windows."
}

$backupScript = Join-Path $PSScriptRoot "backup-map.ps1"
$pythonScript = Join-Path $PSScriptRoot "sync-marked-notion-points.py"

if (-not (Test-Path -LiteralPath $backupScript)) {
    throw "Backup skript nebyl nalezen: $backupScript"
}

if (-not (Test-Path -LiteralPath $pythonScript)) {
    throw "Sync skript nebyl nalezen: $pythonScript"
}

$backupPath = & powershell -ExecutionPolicy Bypass -File $backupScript
Write-Output "BACKUP $backupPath"

python $pythonScript @args
