param(
    [Parameter(Mandatory = $true)]
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
chcp 65001 > $null
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$Executable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Executable not found: $Executable"
}

$Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$Listener.Start()
$Port = ([Net.IPEndPoint]$Listener.LocalEndpoint).Port
$Listener.Stop()
$DataDir = Join-Path $env:TEMP ("TalentHub-ReleaseSmoke-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $DataDir | Out-Null
$Process = $null

try {
    $Process = Start-Process -FilePath $Executable -ArgumentList @(
        '--no-browser', '--port', $Port, '--data-dir', $DataDir
    ) -WindowStyle Hidden -PassThru

    $Deadline = [DateTime]::UtcNow.AddSeconds(30)
    $Health = $null
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($Process.HasExited) {
            throw "App exited during startup with code $($Process.ExitCode)."
        }
        try {
            $Health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($Health.app -eq 'talent-hub' -and $Health.status -eq 'ok') { break }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if ($null -eq $Health -or $Health.app -ne 'talent-hub') {
        throw 'App did not pass health check within 30 seconds.'
    }

    $Page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 5
    if ($Page.StatusCode -ne 200 -or $Page.Content -notmatch 'class="app-shell"') {
        throw 'App home page smoke test failed.'
    }
    Write-Host "Release smoke test passed: $Executable"
} finally {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit(5000)
    }
    if (Test-Path -LiteralPath $DataDir) {
        Remove-Item -LiteralPath $DataDir -Recurse -Force
    }
}
