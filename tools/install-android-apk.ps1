param(
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'debug',
  [string]$SdkRoot = '',
  [string]$ApkPath = '',
  [switch]$GrantPermissions
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $ApkPath) {
  $relativeApk = if ($Variant -eq 'release') {
    'mobile\android\app\build\outputs\apk\release\app-release.apk'
  } else {
    'mobile\android\app\build\outputs\apk\debug\app-debug.apk'
  }
  $ApkPath = Join-Path $repoRoot $relativeApk
}

if (-not (Test-Path -LiteralPath $ApkPath)) {
  throw "APK not found: $ApkPath"
}

$candidates = @()
if ($SdkRoot) { $candidates += (Join-Path $SdkRoot 'platform-tools\adb.exe') }
if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
$candidates += 'E:\AndroidDev\SDK\platform-tools\adb.exe'
$candidates += 'adb.exe'

$adb = $candidates | Where-Object { $_ -eq 'adb.exe' -or (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $adb) {
  throw 'adb.exe not found. Set ANDROID_SDK_ROOT or pass -SdkRoot.'
}

$arguments = @('install', '-r')
if ($GrantPermissions) {
  $arguments += '-g'
}
$arguments += $ApkPath

Write-Host "Using adb: $adb"
Write-Host "Installing $Variant APK with replace mode: $ApkPath"
& $adb @arguments
if ($LASTEXITCODE -ne 0) {
  throw "adb install failed with exit code $LASTEXITCODE"
}
