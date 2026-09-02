param(
    [switch]$SkipInstaller,
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
chcp 65001 > $null
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# 唯一版本源：app/__init__.py 的 __version__，并推导 PyInstaller 版本元组
$InitContent = Get-Content -LiteralPath (Join-Path $Root 'app\__init__.py') -Raw -Encoding UTF8
$Version = [regex]::Match($InitContent, '__version__\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $Version) { throw '无法从 app\__init__.py 读取 __version__。' }
$VersionParts = @($Version -split '\.')
while ($VersionParts.Count -lt 4) { $VersionParts += '0' }
$VersionTuple = '(' + ($VersionParts -join ', ') + ')'

# 由模板生成 PyInstaller 版本资源文件（该文件为构建产物，已 gitignore）
$VersionInfoTemplate = Get-Content -LiteralPath (Join-Path $Root 'packaging\version_info.txt.template') -Raw -Encoding UTF8
$VersionInfo = $VersionInfoTemplate.Replace('__VERSION_TUPLE__', $VersionTuple).Replace('__VERSION__', $Version)
[System.IO.File]::WriteAllText((Join-Path $Root 'packaging\version_info.txt'), $VersionInfo, $Utf8NoBom)

$ReleaseRoot = Join-Path $Root "release\$Version"
$DistRoot = Join-Path $ReleaseRoot 'portable'
$WorkRoot = Join-Path $ReleaseRoot 'build'

foreach ($path in @($DistRoot, $WorkRoot)) {
    if (Test-Path -LiteralPath $path) {
        throw "Release path already exists; refusing to overwrite: $path"
    }
}

python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'PyInstaller is missing. Run: python -m pip install -r requirements-build.txt'
}

python -X utf8 packaging\create_icon.py
if ($LASTEXITCODE -ne 0) { throw 'App icon generation failed.' }

$FrontendDir = Join-Path $Root 'frontend'
Push-Location $FrontendDir
try {
    if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'node_modules'))) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally {
    Pop-Location
}

python -X utf8 -m PyInstaller --distpath $DistRoot --workpath $WorkRoot packaging\talent_hub.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }

$PortableDir = Join-Path $DistRoot 'TalentHub'
$Exe = Join-Path $PortableDir 'TalentHub.exe'
if (-not (Test-Path -LiteralPath $Exe)) { throw "Build artifact not found: $Exe" }
Write-Host "Portable app created: $Exe"

python -X utf8 packaging\generate_notices.py --output $PortableDir
if ($LASTEXITCODE -ne 0) { throw 'Third-party notice generation failed.' }

if (-not $SkipSmoke) {
    & (Join-Path $Root 'scripts\verify_windows_release.ps1') -Executable $Exe
    if ($LASTEXITCODE -ne 0) { throw 'Portable app smoke test failed.' }
}

if (-not $SkipInstaller) {
    $IsccCandidates = @(
        @(
            (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
            (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 7\ISCC.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe'),
            (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
            (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
    )

    if ($IsccCandidates.Count -eq 0) {
        Write-Warning 'Inno Setup 7/6 not found. Installer skipped; portable app is available.'
    } else {
        & $IsccCandidates[0] "/DMyAppVersion=$Version" (Join-Path $Root 'packaging\talent-hub.iss')
        if ($LASTEXITCODE -ne 0) { throw 'Inno Setup build failed.' }
        Write-Host "Installer created: $ReleaseRoot"
    }
}
