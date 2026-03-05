param(
    [string]$WixExe = "wix"
)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")

if (-not (Test-Path .\dist\SOWCreator.exe)) {
    throw "Portable executable not found. Run scripts/build_portable.ps1 first."
}

$wix3Bin = "C:\Program Files (x86)\WiX Toolset v3.14\bin"
$candle = Join-Path $wix3Bin "candle.exe"
$light = Join-Path $wix3Bin "light.exe"

if (Get-Command $WixExe -ErrorAction SilentlyContinue) {
    & $WixExe build .\packaging\wix\sow_creator.wxs -out .\dist\SOWCreator.msi
    if ($LASTEXITCODE -ne 0) {
        throw "WiX v4 build failed with exit code $LASTEXITCODE"
    }
}
elseif ((Test-Path $candle) -and (Test-Path $light)) {
    $wixBuildDir = ".\build\wix"
    if (-not (Test-Path $wixBuildDir)) {
        New-Item -ItemType Directory -Path $wixBuildDir | Out-Null
    }
    & $candle -nologo -out "$wixBuildDir\" .\packaging\wix\sow_creator.wxs
    if ($LASTEXITCODE -ne 0) {
        throw "WiX candle compilation failed with exit code $LASTEXITCODE"
    }
    # Some environments cannot run ICE validation reliably; build MSI without ICE checks.
    & $light -nologo -sval -out .\dist\SOWCreator.msi "$wixBuildDir\sow_creator.wixobj"
    if ($LASTEXITCODE -ne 0) {
        throw "WiX light linking failed with exit code $LASTEXITCODE"
    }
}
else {
    throw "No compatible WiX CLI found. Install WiX v4 (wix) or WiX v3 candle/light."
}

Write-Host "MSI build ready at .\dist\SOWCreator.msi"
