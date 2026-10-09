# Registers Dot Notifier as a Sparse Package (Package with External Location)
# to grant UserNotificationListener capability without requiring MSIX packaging.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$manifestPath = Join-Path $repoRoot "src-tauri\AppxManifest.xml"
$targetDir = Join-Path $repoRoot "src-tauri\target\debug"

if (-not (Test-Path $targetDir)) {
    $targetDir = Join-Path $repoRoot "src-tauri"
}

Write-Host "Registering Sparse Package from $manifestPath with ExternalLocation $targetDir..." -ForegroundColor Cyan

try {
    Add-AppxPackage -Register $manifestPath -ExternalLocation $targetDir
    Write-Host "Sparse Package successfully registered with Windows!" -ForegroundColor Green
    Write-Host "Package identity 'DotNotifier.App' is now active." -ForegroundColor Green
} catch {
    Write-Warning "Registration failed: $_"
    Write-Host "Note: If Windows requires Developer Mode, enable Developer Mode in Windows Settings > System > For developers." -ForegroundColor Yellow
}
