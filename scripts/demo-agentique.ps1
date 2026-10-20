# UL-016 local demonstration on Docker Desktop (Windows PowerShell 5.1 or PowerShell 7).
#   rules       historical rules engine, no agent
#   simulated   agentic simulation inside the worker, no model and no Hermes
#   hermes-stub real Hermes loop with the stack's SIMULATED model endpoint (free rehearsal)
#   hermes-live real Hermes loop with OpenRouter (paid, bounded by the configured budgets)
# Stops at the first failed command. Never deletes a volume. Never prints a secret.
param([ValidateSet('rules','simulated','hermes-stub','hermes-live')][string]$Mode = 'simulated')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Stop; do not continue with an old image." }
}
function Assert-Configured {
  param([string[]]$Names)
  # Checks presence only; values are never read into the console.
  $missing = @($Names | Where-Object { -not (Select-String -LiteralPath '.env' -Pattern "^$_=\S" -Quiet) })
  if ($missing.Count -gt 0) { throw "Missing in .env (see docs/DEMO-AGENTIQUE.md): $($missing -join ', ')" }
}
if (-not (Test-Path -LiteralPath '.env') -or -not (Test-Path -LiteralPath 'infra/.env')) {
  throw 'Create .env and infra/.env from their examples, without overwriting an existing configuration.'
}
$hermes = $Mode -in @('hermes-stub','hermes-live')
if ($hermes) {
  Assert-Configured @('HERMES_SERVICE_TOKEN','AGENT_MODEL_ID','AGENT_RUN_BUDGET_USD','AGENT_SESSION_BUDGET_USD','AGENT_MONTH_BUDGET_USD','AGENT_SESSION_ID')
}
if ($Mode -eq 'hermes-live') { Assert-Configured @('OPENROUTER_API_KEY') }
$env:ULYSSE_ANALYSIS_MODE = $Mode
$env:ENABLE_DEMO_SCENARIOS = 'true'
# The simulated model endpoint exists only in hermes-stub; the worker refuses it in hermes-live.
$env:AGENT_STUB_PROVIDER_URL = if ($Mode -eq 'hermes-stub') { 'http://model-stub:8091/v1/chat/completions' } else { '' }
$taskCompose = @('compose','-f','infra/compose.yaml','-f','infra/hermes.compose.yaml','--env-file','.env','--env-file','infra/.env','--profile','app')
if ($hermes) { $taskCompose += @('--profile','agent') }
if ($Mode -eq 'hermes-stub') { $taskCompose += @('--profile','agent-stub') }
Invoke-Checked docker @('info','--format','{{.ServerVersion}}')
Invoke-Checked docker ($taskCompose + @('config','--quiet'))
Invoke-Checked docker ($taskCompose + @('stop','api','worker','hermes','model-stub'))
Invoke-Checked docker @('build','-t','ulysse-app:local','.')
# Both images must come from the same checkout: the worker checks Hermes' commit and instructions.
if ($hermes) { Invoke-Checked docker ($taskCompose + @('build','hermes')) }
Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','600','postgres','keycloak'))
Invoke-Checked docker ($taskCompose + @('run','--rm','--no-deps','db-init'))
Invoke-Checked docker ($taskCompose + @('run','--rm','--no-deps','demo-seed'))
if ($hermes) { Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','300','hermes')) }
if ($Mode -eq 'hermes-stub') { Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','300','model-stub')) }
Invoke-Checked docker ($taskCompose + @('up','-d','--wait','--wait-timeout','600','--force-recreate','api','worker'))
Write-Host "Demo ready at http://localhost:3000 - mode requested: $Mode. Confirm the actual run origin in Analyses."
