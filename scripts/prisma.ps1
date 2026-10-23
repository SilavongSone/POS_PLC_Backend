# Runs Prisma CLI commands that need the native schema engine (migrate, db push, db pull, migrate diff)
# inside a Linux container. Windows Smart App Control blocks Prisma's unsigned schema-engine-windows.exe.
# `prisma generate` and `prisma format` work natively and do not need this.
#
# Usage (from backend/):  .\scripts\prisma.ps1 migrate dev --name add_customers
#                         .\scripts\prisma.ps1 migrate status

$ErrorActionPreference = "Stop"
$backend = Split-Path -Parent $PSScriptRoot

$docker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $docker) { $docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe" }
if (-not (Test-Path $docker)) { throw "Docker not found. Install Docker Desktop and start it." }

# Read DATABASE_URL from .env and point localhost at the Docker host.
$line = Get-Content (Join-Path $backend ".env") | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL not found in backend/.env" }
$url = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim('"', "'", ' ')
$url = $url -replace '@(localhost|127\.0\.0\.1)([:/])', '@host.docker.internal$2'

$tty = if ([Console]::IsInputRedirected) { @() } else { @("-it") }

& $docker run --rm @tty `
  -v "${backend}\prisma:/work/prisma" `
  -v "${backend}\scripts\prisma-in-docker.sh:/prisma-in-docker.sh:ro" `
  -v "plc-pos-prisma-cli:/cli" `
  -e "DATABASE_URL=$url" `
  node:24-slim sh /prisma-in-docker.sh @args
exit $LASTEXITCODE
