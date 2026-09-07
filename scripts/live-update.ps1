#Requires -Version 5.1
<#
  FIB HR Live Update

  Beispiele:
    scripts\live-update.bat
    scripts\live-update.bat -SkipDbPush
    scripts\live-update.bat -SkipInstall -SkipBuild
    scripts\live-update.bat -Force -NoPause

  Standard-AppDir:
    $env:FIB_APP_DIR, sonst C:\inetpub\vhosts\nerovfib.de\httpdocs
#>
param(
    [string] $AppDir = $env:FIB_APP_DIR,
    [string] $Remote = 'origin',
    [string] $Branch = 'main',
    [switch] $SkipInstall,
    [switch] $SkipDbPush,
    [switch] $SkipBuild,
    [switch] $Force,
    [switch] $NoPause
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = 'C:\inetpub\vhosts\nerovfib.de\httpdocs'
}

$AppDir = [System.IO.Path]::GetFullPath($AppDir)
$StartedAt = Get-Date
$Stamp = $StartedAt.ToString('yyyy-MM-dd_HH-mm-ss')
$LogDir = Join-Path $AppDir 'deploy-logs'
$LogFile = Join-Path $LogDir "live-update-$Stamp.log"
$BuildLog = Join-Path $LogDir "build-$Stamp.log"
$StaticBackup = Join-Path $env:TEMP "fib_next_static_$Stamp"
$BackupMessage = "Backup before GitHub update ($Stamp)"
$MergeMessage = "Merge GitHub updates into live production ($Stamp)"
$PreviousCommit = ''
$TargetCommit = ''

function Pause-IfNeeded {
    if (-not $NoPause) {
        Write-Host ''
        Read-Host 'Enter drücken zum Schließen'
    }
}

function Write-LogOnly([string] $Message = '') {
    if (-not (Test-Path $LogDir)) {
        $null = New-Item -ItemType Directory -Force -Path $LogDir
    }
    if ($Message -eq '') {
        Add-Content -Path $LogFile -Value '' -Encoding UTF8
    }
    else {
        Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" -Encoding UTF8
    }
}

function Write-Line([string] $Message = '', [ConsoleColor] $Color = [ConsoleColor]::Gray) {
    if ($Message -eq '') {
        Write-Host ''
        Write-LogOnly ''
        return
    }
    Write-Host $Message -ForegroundColor $Color
    Write-LogOnly $Message
}

function Write-Header {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host ' FIB HR Live Update' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host " App:    $AppDir" -ForegroundColor DarkGray
    Write-Host " Branch: $Remote/$Branch" -ForegroundColor DarkGray
    Write-Host " Log:    $LogFile" -ForegroundColor DarkGray
    Write-Host ''
}

function Write-Step([int] $Number, [int] $Total, [string] $Title) {
    Write-Line ''
    Write-Line '============================================================' DarkCyan
    Write-Line ("[{0}/{1}] {2}" -f $Number, $Total, $Title) Cyan
    Write-Line '============================================================' DarkCyan
}

function Get-StreamText($Value) {
    if ($Value -is [System.Management.Automation.ErrorRecord]) {
        if ($null -ne $Value.TargetObject -and "$($Value.TargetObject)" -ne '') {
            return "$($Value.TargetObject)"
        }
        if ($Value.ErrorDetails -and $Value.ErrorDetails.Message) {
            return $Value.ErrorDetails.Message.Trim()
        }
        if ($Value.Exception -and $Value.Exception.Message) {
            return $Value.Exception.Message.Trim()
        }
        return $null
    }
    return "$Value"
}

function Invoke-Webhook([string] $Severity, [string] $Title, [string] $Description, [string] $SourceLog = $LogFile) {
    $webhookScript = Join-Path $AppDir 'scripts\send-webhook.js'
    if (-not (Test-Path $webhookScript)) {
        return
    }
    try {
        & node $webhookScript $Severity $Title $Description $SourceLog >> $LogFile 2>&1
    }
    catch {
        Write-LogOnly "Webhook konnte nicht gesendet werden: $($_.Exception.Message)"
    }
}

function Invoke-LoggedCommand {
    param(
        [string] $Title,
        [string] $FilePath,
        [string[]] $Arguments = @(),
        [string] $ExtraLogPath = ''
    )

    Write-Line ''
    Write-Line "-- $Title" Yellow
    Write-Line ("$ {0} {1}" -f $FilePath, ($Arguments -join ' ')) DarkGray

    $tempLog = Join-Path $env:TEMP ("fib_step_{0}_{1}.log" -f $Stamp, (Get-Random))
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            $text = Get-StreamText $_
            if ($null -ne $text -and $text -ne '') {
                Write-Host $text
                Add-Content -Path $tempLog -Value $text -Encoding UTF8
                Add-Content -Path $LogFile -Value $text -Encoding UTF8
                if ($ExtraLogPath) {
                    Add-Content -Path $ExtraLogPath -Value $text -Encoding UTF8
                }
            }
        }
    }
    finally {
        $ErrorActionPreference = $oldPref
    }

    $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    Remove-Item -LiteralPath $tempLog -Force -ErrorAction SilentlyContinue

    if ($exitCode -ne 0) {
        Write-Line "[FEHLER] $Title ist fehlgeschlagen. Exitcode: $exitCode" Red
        throw "$Title fehlgeschlagen (Exit $exitCode)"
    }

    Write-Line "[OK] $Title" Green
}

function Get-GitOutput([string[]] $Arguments) {
    $output = & git @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "git $($Arguments -join ' ') fehlgeschlagen: $output"
    }
    return ($output | Out-String).Trim()
}

function Test-GitAncestor([string] $Ancestor, [string] $Descendant) {
    & git merge-base --is-ancestor $Ancestor $Descendant > $null 2>&1
    return $LASTEXITCODE -eq 0
}

function Backup-NextStatic {
    Write-Line ''
    Write-Line '-- Next.js Static-Chunks sichern' Yellow

    if (Test-Path $StaticBackup) {
        Remove-Item -LiteralPath $StaticBackup -Recurse -Force -ErrorAction SilentlyContinue
    }

    $source = Join-Path $AppDir '.next\static'
    if (-not (Test-Path $source)) {
        Write-Line 'Keine .next\static-Dateien zum Sichern vorhanden.' DarkGray
        return
    }

    $null = New-Item -ItemType Directory -Force -Path $StaticBackup
    & robocopy $source $StaticBackup /E /NFL /NDL /NJH /NJS /NC /NS | ForEach-Object {
        if ($_ -ne '') {
            Write-Host $_
            Add-Content -Path $LogFile -Value $_ -Encoding UTF8
        }
    }
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "Next.js Static-Chunks sichern fehlgeschlagen (Robocopy Exit $code)"
    }
    Write-Line "[OK] Next.js Static-Chunks gesichert" Green
}

function Restore-NextStatic {
    Write-Line ''
    Write-Line '-- Alte Next.js Static-Chunks wiederherstellen' Yellow

    if (-not (Test-Path $StaticBackup)) {
        Write-Line 'Keine gesicherten Static-Chunks vorhanden.' DarkGray
        return
    }

    $target = Join-Path $AppDir '.next\static'
    $null = New-Item -ItemType Directory -Force -Path $target
    & robocopy $StaticBackup $target /E /XC /XN /XO /NFL /NDL /NJH /NJS /NC /NS | ForEach-Object {
        if ($_ -ne '') {
            Write-Host $_
            Add-Content -Path $LogFile -Value $_ -Encoding UTF8
        }
    }
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "Alte Next.js Static-Chunks wiederherstellen fehlgeschlagen (Robocopy Exit $code)"
    }
    Write-Line "[OK] Alte Next.js Static-Chunks wiederhergestellt" Green
}

function Test-PrismaClientGenerated {
    # Production (start.js) loads the client via a plain require() without a
    # TypeScript loader, so a JavaScript entry MUST exist. A TS-only client would
    # crash at runtime (tsx), so we deliberately do not accept client.ts here.
    $candidates = @(
        Join-Path $AppDir 'src\generated\prisma\client.js'
        Join-Path $AppDir 'src\generated\prisma\index.js'
        Join-Path $AppDir 'src\generated\prisma\default.js'
    )
    $entry = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $entry) {
        throw 'Prisma JavaScript-Client fehlt: client.js, index.js oder default.js wurde nicht erzeugt. Auf dem Server "npm install" und "npx prisma generate" ausführen.'
    }
    $relative = $entry
    if ($entry.StartsWith($AppDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $entry.Substring($AppDir.Length).TrimStart('\', '/')
    }
    Write-Line "Prisma Client: $relative" DarkGray
}

function Test-BuildArtifacts {
    $buildId = Join-Path $AppDir '.next\BUILD_ID'
    if (-not (Test-Path $buildId)) {
        throw 'Next.js Build fehlt: .next\BUILD_ID wurde nicht gefunden.'
    }
    if (-not (Test-Path (Join-Path $AppDir 'start.js'))) {
        throw 'start.js fehlt im App-Verzeichnis.'
    }
    Test-PrismaClientGenerated
    Write-Line "Build-ID: $((Get-Content -Raw $buildId).Trim())" DarkGray
}

function Complete-Success([string] $Description) {
    $duration = [Math]::Round(((Get-Date) - $StartedAt).TotalSeconds)
    Write-Line ''
    Write-Line '============================================================' Green
    Write-Line 'UPDATE ERFOLGREICH ABGESCHLOSSEN' Green
    Write-Line '============================================================' Green
    Write-Line "Dauer: ${duration}s" DarkGray
    Write-Line "Log:   $LogFile" DarkGray
    Invoke-Webhook 'success' 'Live Update abgeschlossen' $Description $LogFile
}

try {
    if (-not (Test-Path $AppDir)) {
        throw "Projektordner wurde nicht gefunden: $AppDir"
    }
    $null = New-Item -ItemType Directory -Force -Path $LogDir
    Set-Location $AppDir
    Write-Header

    Write-LogOnly '============================================================'
    Write-LogOnly 'FIB HR Live Update gestartet'
    Write-LogOnly "App: $AppDir"
    Write-LogOnly "Remote: $Remote/$Branch"
    Write-LogOnly "SkipInstall=$SkipInstall SkipDbPush=$SkipDbPush SkipBuild=$SkipBuild Force=$Force"
    Write-LogOnly '============================================================'
    Invoke-Webhook 'info' 'Live Update gestartet' 'Das Produktionsupdate wurde gestartet.' $LogFile

    if (-not (Test-Path (Join-Path $AppDir '.git'))) {
        throw 'Der Projektordner ist kein Git-Repository.'
    }

    Write-Step 1 11 'Umgebung prüfen'
    Invoke-LoggedCommand 'Git Version' 'git' @('--version')
    Invoke-LoggedCommand 'Node Version' 'node' @('-v')
    Invoke-LoggedCommand 'NPM Version' 'npm' @('-v')

    Write-Step 2 11 'Aktueller Stand'
    $currentBranch = Get-GitOutput @('branch', '--show-current')
    $PreviousCommit = Get-GitOutput @('rev-parse', '--short', 'HEAD')
    Write-Line "Lokaler Branch: $currentBranch" DarkGray
    Write-Line "Lokaler Commit: $(Get-GitOutput @('log', '-1', '--oneline'))" DarkGray
    $status = Get-GitOutput @('status', '--short')
    if ($status) {
        Write-Line 'Lokale Änderungen vorhanden:' Yellow
        Write-Line $status Gray
    }
    else {
        Write-Line 'Arbeitsverzeichnis ist sauber.' Green
    }

    Write-Step 3 11 'GitHub Updates holen'
    Invoke-LoggedCommand "Fetch $Remote/$Branch" 'git' @('fetch', $Remote, $Branch, '--prune')
    $TargetCommit = Get-GitOutput @('rev-parse', '--short', "$Remote/$Branch")
    Write-Line "Remote Commit: $(Get-GitOutput @('log', '-1', '--oneline', "$Remote/$Branch"))" DarkGray

    Write-Step 4 11 'Update-Bedarf prüfen'
    $remoteCommits = Get-GitOutput @('log', '--oneline', "HEAD..$Remote/$Branch")
    if (-not $remoteCommits -and -not $Force) {
        Write-Line "Keine neuen GitHub-Updates vorhanden. $Remote/$Branch ist bereits enthalten." Green
        Invoke-LoggedCommand 'Finaler Git Status' 'git' @('status', '--short')
        Complete-Success 'Kein Update nötig. Die Live-Version enthält bereits alle Remote-Commits.'
        Pause-IfNeeded
        exit 0
    }
    if ($remoteCommits) {
        Write-Line 'Neue GitHub-Commits:' Cyan
        Write-Line $remoteCommits Gray
    }
    else {
        Write-Line 'Keine neuen Commits, Force-Modus führt Build/Checks trotzdem aus.' Yellow
    }

    Write-Step 5 11 'Lokale Änderungen sichern'
    $status = Get-GitOutput @('status', '--porcelain')
    if ($status) {
        Write-Line 'Lokale Änderungen werden als Sicherheits-Commit gesichert:' Yellow
        Write-Line $status Gray
        Invoke-LoggedCommand 'Lokale Änderungen vormerken' 'git' @('add', '-A')
        Invoke-LoggedCommand 'Sicherheits-Commit erstellen' 'git' @('commit', '-m', $BackupMessage)
    }
    else {
        Write-Line 'Keine lokalen Änderungen vorhanden.' Green
    }

    Write-Step 6 11 'GitHub Updates mergen'
    if ($remoteCommits) {
        if (Test-GitAncestor 'HEAD' "$Remote/$Branch") {
            Invoke-LoggedCommand 'Fast-forward Merge ausführen' 'git' @('merge', '--ff-only', "$Remote/$Branch")
        }
        else {
            Invoke-LoggedCommand 'Merge-Commit ausführen' 'git' @('merge', '--no-ff', '--no-edit', "$Remote/$Branch")
            if ($LASTEXITCODE -ne 0) {
                Invoke-LoggedCommand 'Merge-Commit mit Message erstellen' 'git' @('commit', '-m', $MergeMessage)
            }
        }
    }
    else {
        Write-Line 'Merge übersprungen, Force-Modus ohne neue Commits.' Yellow
    }

    Write-Step 7 11 'Pakete installieren'
    if ($SkipInstall) {
        Write-Line 'npm install übersprungen.' Yellow
    }
    else {
        Invoke-LoggedCommand 'npm install' 'npm' @('install')
    }

    Write-Step 8 11 'Next.js Static-Chunks sichern'
    Write-Line '.next wird vor dem Build nicht gelöscht, damit aktive Clients alte Chunk-Dateien noch laden können.' DarkGray
    Backup-NextStatic

    Write-Step 9 11 'Datenbank und Prisma aktualisieren'
    if ($SkipDbPush) {
        Write-Line 'Datenbank-Update übersprungen.' Yellow
        Invoke-LoggedCommand 'Prisma Client generieren' 'npx' @('prisma', 'generate')
    }
    else {
        Invoke-LoggedCommand 'Datenbank-Backup erstellen' 'npm' @('run', 'db:backup')
        Invoke-LoggedCommand 'Prisma db push ausführen' 'npx' @('prisma', 'db', 'push')
        Invoke-LoggedCommand 'Prisma Client generieren' 'npx' @('prisma', 'generate')
        Invoke-LoggedCommand 'Dienstnummern normalisieren' 'npm' @('run', 'db:normalize-badges')
    }

    Write-Step 10 11 'Projekt bauen'
    if ($SkipBuild) {
        Write-Line 'Build übersprungen.' Yellow
    }
    else {
        Invoke-Webhook 'info' 'Build gestartet' 'Der Produktionsbuild wurde gestartet.' $LogFile
        Invoke-LoggedCommand 'npm run build' 'npm' @('run', 'build') $BuildLog
        Restore-NextStatic
        Invoke-Webhook 'success' 'Build erfolgreich' 'Der Produktionsbuild wurde erfolgreich abgeschlossen.' $BuildLog
    }

    Write-Step 11 11 'Abschluss prüfen'
    Test-BuildArtifacts
    Write-Line "Vorher: $PreviousCommit" DarkGray
    Write-Line "Ziel:   $TargetCommit" DarkGray
    Write-Line "Jetzt:  $(Get-GitOutput @('rev-parse', '--short', 'HEAD'))" DarkGray
    Invoke-LoggedCommand 'Finaler Git Status' 'git' @('status', '--short')

    Complete-Success 'Das Produktionsupdate wurde erfolgreich abgeschlossen.'
    Remove-Item -LiteralPath $StaticBackup -Recurse -Force -ErrorAction SilentlyContinue
    Pause-IfNeeded
    exit 0
}
catch {
    $message = $_.Exception.Message
    Write-Line ''
    Write-Line '============================================================' Red
    Write-Line 'UPDATE FEHLGESCHLAGEN' Red
    Write-Line '============================================================' Red
    Write-Line "Grund: $message" Red
    Write-Line "Log:   $LogFile" DarkGray

    if ($PreviousCommit) {
        Write-Line ''
        Write-Line 'Rollback-Hinweis:' Yellow
        Write-Line "  git reset --hard $PreviousCommit" Gray
        Write-Line 'Nur ausführen, wenn du die bereits gemergten Änderungen wirklich zurücksetzen willst.' Gray
    }

    Invoke-Webhook 'error' 'Live Update fehlgeschlagen' "Das Produktionsupdate ist fehlgeschlagen: $message" $LogFile
    Pause-IfNeeded
    exit 1
}
