param([ValidateSet('rules','simulated','hermes-live')][string]$Mode = 'simulated')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Stop; do not continue with an old image." }
}
if (-not (Test-Path -LiteralPath '.env') -or -not (Test-Path -LiteralPath 'infra/.env')) {
  throw 'Create .env and infra/.env from their examples, without overwriting an existing configuration.'
}
$env:ULYSSE_ANALYSIS_MODE = $Mode
$env:ENABLE_DEMO_SCENARIOS = 'true'
$taskCompose = @('compose','-f','infra/compose.yaml','-f','infra/hermes.compose.yaml','--env-file','.env','--env-file','infra/.env','--profile','app')
if ($Mode -eq 'hermes-live') { $taskCompose += @('--profile','agent') }
Invoke-Checked docker @('info','--format','{{.ServerVersion}}')
Invoke-Checked docker ($taskCompose + @('config','--quiet'))
Invoke-Checked docker ($taskCompose + @('stop','api','worker','hermes'))
Invoke-Checked docker @('build','-t','ulysse-app:local','.')
if ($Mode -eq 'hermes-live') { Invoke-Checked docker ($taskCompose + @('build','hermes')) }
Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','600','postgres','keycloak'))
Invoke-Checked docker ($taskCompose + @('run','--rm','--no-deps','db-init'))
Invoke-Checked docker ($taskCompose + @('run','--rm','--no-deps','demo-seed'))
if ($Mode -eq 'hermes-live') { Invoke-Checked docker ($taskCompose + @('up','-d','--wait','hermes')) }
Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','600','api','worker'))
Write-Host "Demo ready at http://localhost:3000 — mode requested: $Mode. Confirm the actual run origin in Analyses."
