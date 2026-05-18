param(
    [string]$OutputPath = "D:\Codex\Azory\Mapa\azory2026-prezentace.html"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "generate-azory-presentation.mjs"
& node $scriptPath $OutputPath
