#Requires -Version 5.1
<#
.SYNOPSIS
  Verify Lumina AI Grok agent definitions and print session launch commands.

.EXAMPLE
  .\scripts\rebuild_agents.ps1
  .\scripts\rebuild_agents.ps1 -ListOnly
#>

param(
    [switch]$ListOnly,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$RequiredDocs = @(
    'AGENTS.md',
    '.grok\GROK.md'
)

$DashboardAgents = @(
    @{ File = 'lumina-planner.md';    Name = 'Lumina Planner';     Tag = '@Lumina Planner' },
    @{ File = 'backend-architect.md';  Name = 'Backend Architect';  Tag = '@Backend Architect' },
    @{ File = 'core-coder.md';         Name = 'Core Coder';         Tag = '@Core Coder' },
    @{ File = 'ui-ux-engineer.md';     Name = 'UI UX Engineer';     Tag = '@UI & UX Engineer' },
    @{ File = 'data-automation.md';    Name = 'Data Automation';    Tag = '@Data & Automation' },
    @{ File = 'qa-tester.md';          Name = 'QA Tester';          Tag = '@QA & Tester' },
    @{ File = 'reviewer-optimizer.md'; Name = 'Reviewer Optimizer'; Tag = '@Reviewer & Optimizer' }
)

$SkillAgents = @(
    'orchestrator', 'analyst', 'impl', 'ui', 'test', 'reviewer', 'security', 'quickfix'
)

Write-Host ''
Write-Host '=== Lumina AI - Grok Agent rebuild check ===' -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host ''

$ok = $true

foreach ($doc in $RequiredDocs) {
    $path = Join-Path $Root $doc
    if (Test-Path $path) {
        Write-Host "[OK] $doc" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $doc" -ForegroundColor Red
        $ok = $false
    }
}

Write-Host ''
Write-Host '--- Dashboard Agents ---' -ForegroundColor Yellow
foreach ($a in $DashboardAgents) {
    $path = Join-Path $Root (".grok\agents\" + $a.File)
    if (Test-Path $path) {
        Write-Host ("[OK] {0}  ({1})  {2}" -f $a.Name, $a.File, $a.Tag) -ForegroundColor Green
        Write-Host ("     start: grok --agent `"{0}`"" -f $a.Name) -ForegroundColor DarkGray
    } else {
        Write-Host ("[MISSING] {0}" -f $a.File) -ForegroundColor Red
        $ok = $false
    }
}

Write-Host ''
Write-Host '--- Skill / Slash Agents ---' -ForegroundColor Yellow
foreach ($name in $SkillAgents) {
    $agentPath = Join-Path $Root (".grok\agents\" + $name + ".md")
    $skillPath = Join-Path $Root (".grok\skills\" + $name + "\SKILL.md")
    if (Test-Path $agentPath) {
        Write-Host ("[OK] agent: {0}.md" -f $name) -ForegroundColor Green
    } else {
        Write-Host ("[MISSING] agent: {0}.md" -f $name) -ForegroundColor Red
        $ok = $false
    }
    if (Test-Path $skillPath) {
        Write-Host ("     skill: /{0}" -f $name) -ForegroundColor DarkGray
    } else {
        Write-Host ("     skill optional missing: .grok/skills/{0}/SKILL.md" -f $name) -ForegroundColor DarkYellow
    }
}

Write-Host ''
Write-Host '--- How to use ---' -ForegroundColor Yellow
Write-Host '1. In Grok TUI, open /config-agents to confirm project agents are loaded'
Write-Host '2. Pin independent sessions (recommended):'
Write-Host '     grok --agent "Lumina Planner"'
Write-Host '     grok --agent "Backend Architect"'
Write-Host '     grok --agent "Core Coder"'
Write-Host '     grok --agent "UI UX Engineer"'
Write-Host '     grok --agent "Data Automation"'
Write-Host '     grok --agent "QA Tester"'
Write-Host '     grok --agent "Reviewer Optimizer"'
Write-Host '3. Same-session slash skills:'
Write-Host '     /orchestrator  /analyst  /impl  /ui  /test  /reviewer  /security  /quickfix'
Write-Host '4. Rules: AGENTS.md | Global: .grok/GROK.md'

if ($Launch) {
    Write-Host ''
    Write-Host 'Launch mode: run the grok --agent commands above in interactive terminals.' -ForegroundColor Cyan
    Write-Host '(This script does not auto-spawn multiple TUI sessions.)'
}

if ($ListOnly) {
    exit 0
}

Write-Host ''
if ($ok) {
    Write-Host 'Result: all agent definition files present.' -ForegroundColor Green
    exit 0
} else {
    Write-Host 'Result: missing files. Fix and re-run.' -ForegroundColor Red
    exit 1
}
