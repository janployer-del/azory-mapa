$ErrorActionPreference = "Stop"

$mapRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $mapRoot "index.html"
$backupDir = Join-Path $mapRoot "backup"

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Zdrojovy soubor mapy nebyl nalezen: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
$backupPath = Join-Path $backupDir "index-$timestamp.html"

Copy-Item -LiteralPath $sourcePath -Destination $backupPath -Force

Write-Output $backupPath
