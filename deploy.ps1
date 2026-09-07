#Requires -Version 5.1
<#
  Deploy: npm install, prisma generate, db:push (mit Backup), optional Seed, npm run build.
  Aufruf: deploy.bat
           deploy.bat -SkipDbPush
           deploy.bat -Seed
           deploy.bat -SkipInstall
#>
param(
    [switch] $SkipDbPush,
    [switch] $SkipInstall,
    [switch] $Seed,
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot 'package.json'))) {
    throw "package.json nicht gefunden. Skript im Projektroot ausführen."
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $ProjectRoot 'deploy-logs'
$null = New-Item -ItemType Directory -Force -Path $logDir
$script:LogFile = Join-Path $logDir "deploy-$ts.log"

function Get-StreamText($obj) {
    if ($obj -is [System.Management.Automation.ErrorRecord]) {
        if ($null -ne $obj.TargetObject -and "$($obj.TargetObject)" -ne '') {
            return "$($obj.TargetObject)"
        }
        if ($obj.ErrorDetails -and $obj.ErrorDetails.Message) {
            return $obj.ErrorDetails.Message.Trim()
        }
        if ($obj.Exception -and $obj.Exception.Message) {
            return $obj.Exception.Message.Trim()
        }
        return $null
    }
    return "$obj"
}

function Write-LogOnly([string] $Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -Path $script:LogFile -Encoding UTF8
}

function Write-StepHeader([string] $Title) {
    $line = "============================================================"
    Write-Host ""
    Write-Host $line -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host $line -ForegroundColor Cyan
    Write-LogOnly $line
    Write-LogOnly $Title
    Write-LogOnly $line
}

function Invoke-TeeCommand {
    param(
        [string] $Title,
        [string] $FilePath,
        [string[]] $Arguments = @()
    )
    Write-StepHeader $Title
    Write-LogOnly "EXE: $FilePath $($Arguments -join ' ')"

    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            $txt = Get-StreamText $_
            if ($null -ne $txt -and $txt -ne '') {
                Write-Host $txt
                Add-Content -Path $script:LogFile -Value $txt -Encoding UTF8
            }
        }
    }
    finally {
        $ErrorActionPreference = $oldPref
    }

    if ($LASTEXITCODE -ne 0) {
        $msg = "Schritt fehlgeschlagen (Exit $LASTEXITCODE): $FilePath $($Arguments -join ' ')"
        Write-LogOnly "FEHLER: $msg"
        Write-Host $msg -ForegroundColor Red
        throw $msg
    }
}

Write-Host ""
Write-Host "Deploy: $ProjectRoot"
Write-Host "Log:    $script:LogFile"
Write-LogOnly "Deploy gestartet. SkipInstall=$SkipInstall SkipDbPush=$SkipDbPush Seed=$Seed SkipBuild=$SkipBuild"

Write-StepHeader "Node & npm Versionen"
foreach ($pair in @(
        @{ exe = "node"; args = @("--version") },
        @{ exe = "npm"; args = @("--version") }
    )) {
    Write-LogOnly "EXE: $($pair.exe) $($pair.args -join ' ')"
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $pair.exe @($pair.args) 2>&1 | ForEach-Object {
            $txt = Get-StreamText $_
            if ($null -ne $txt -and $txt -ne '') {
                Write-Host $txt
                Add-Content -Path $script:LogFile -Value $txt -Encoding UTF8
            }
        }
    }
    finally {
        $ErrorActionPreference = $oldPref
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Version-Befehl fehlgeschlagen: $($pair.exe)"
    }
}

if (-not $SkipInstall) {
    Invoke-TeeCommand "npm install" "npm" @("install")
}
else {
    Write-Host ""
    Write-Host "(npm install uebersprungen: -SkipInstall)" -ForegroundColor Yellow
    Write-LogOnly "npm install uebersprungen (SkipInstall)"
}

Invoke-TeeCommand "Prisma generate" "npx" @("prisma", "generate")

if (-not $SkipDbPush) {
    Invoke-TeeCommand "Prisma db push (npm run db:push = Backup + push)" "npm" @("run", "db:push")
}
else {
    Write-Host ""
    Write-Host "(db push uebersprungen: -SkipDbPush)" -ForegroundColor Yellow
    Write-LogOnly "db push uebersprungen (SkipDbPush)"
}

if ($Seed) {
    Invoke-TeeCommand "Datenbank seeden (npm run db:seed)" "npm" @("run", "db:seed")
}

if (-not $SkipBuild) {
    Invoke-TeeCommand "Production-Build" "npm" @("run", "build")
}
else {
    Write-Host ""
    Write-Host "(Build uebersprungen: -SkipBuild)" -ForegroundColor Yellow
    Write-LogOnly "Build uebersprungen (SkipBuild)"
}

Write-LogOnly "Deploy erfolgreich abgeschlossen."
Write-Host ""
Write-Host "Fertig. Log: $script:LogFile" -ForegroundColor Green
Write-Host ""
