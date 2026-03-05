param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")

if ($Clean) {
    if (Test-Path .\build) { Remove-Item -Recurse -Force .\build }
    if (Test-Path .\dist) { Remove-Item -Recurse -Force .\dist }
}

if (-not (Test-Path .\.venv\Scripts\python.exe)) {
    throw "Virtual environment not found. Create it with: python -m venv .venv"
}

.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller
.\.venv\Scripts\python.exe -m PyInstaller .\packaging\pyinstaller\sow_creator.spec --noconfirm

Write-Host "Portable build ready at .\dist\SOWCreator.exe"
