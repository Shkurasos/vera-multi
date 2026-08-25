# deploy.ps1 — автодеплой Vera Multi на Fly.io.
#
# Пред-условия (одноразово, вручную):
#   1) iwr https://fly.io/install.ps1 -useb | iex
#   2) fly auth login   (откроет браузер, потребуется карта на аккаунте Fly)
#
# Дальше просто:  .\deploy.ps1                 # первый раз — создаст всё
#                 .\deploy.ps1 -SkipInit       # последующие деплои
#
# Параметры:
#   -AppName      имя приложения на Fly (по умолчанию берётся из fly.toml)
#   -Region       регион (ams|fra|waw|arn|…). По умолчанию — из fly.toml.
#   -VolumeSize   размер persistent-volume в GB (по умолчанию 3, free tier)

[CmdletBinding()]
param(
  [string]$AppName,
  [string]$Region,
  [int]$VolumeSize = 3,
  [switch]$SkipInit
)

$ErrorActionPreference = 'Continue'
# Игнорируем stderr от flyctl (warnings), успех определяем по $LASTEXITCODE.
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Die($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)  { Write-Host "✅ $msg" -ForegroundColor Green }
function Info($m)  { Write-Host "→  $m" -ForegroundColor Cyan }

# 0. flyctl доступен?
$fly = Get-Command fly -ErrorAction SilentlyContinue
if (-not $fly) { Die "flyctl не найден в PATH. Установите: iwr https://fly.io/install.ps1 -useb | iex" }

# 0.1 Логин?
$whoami = (& fly auth whoami 2>&1 | Where-Object { $_ -notmatch '^Warning' } | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or -not $whoami) {
  Die "Не залогинены в Fly. Выполните: fly auth login"
}
Ok "Fly: $whoami"

# 0.2 fly.toml и Dockerfile на месте
if (-not (Test-Path './fly.toml'))    { Die "fly.toml не найден в $(Get-Location)" }
if (-not (Test-Path './Dockerfile'))  { Die "Dockerfile не найден в $(Get-Location)" }

# Читаем app/region из fly.toml, если параметры не заданы
$tomlText = Get-Content './fly.toml' -Raw
if (-not $AppName) {
  $m = [regex]::Match($tomlText, '(?m)^\s*app\s*=\s*"([^"]+)"')
  if (-not $m.Success) { Die "app не найден в fly.toml, укажите -AppName" }
  $AppName = $m.Groups[1].Value
}
if (-not $Region) {
  $m = [regex]::Match($tomlText, '(?m)^\s*primary_region\s*=\s*"([^"]+)"')
  $Region = if ($m.Success) { $m.Groups[1].Value } else { 'ams' }
}
Info "App=$AppName  Region=$Region"

if (-not $SkipInit) {
  # 1. Создать приложение (идемпотентно)
  Info "Проверяю приложение…"
  & fly status --app $AppName 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Info "Создаю приложение '$AppName'…"
    & fly apps create $AppName --org personal
    if ($LASTEXITCODE -ne 0) { Die "fly apps create упал (имя занято? укажите другое через -AppName)" }
    Ok "Приложение создано"
  } else {
    Ok "Приложение уже существует"
  }

  # 2. Volume для /data (идемпотентно)
  Info "Проверяю volume 'vera_data'…"
  $vols = & fly volumes list --app $AppName 2>$null
  if ($LASTEXITCODE -ne 0 -or -not ($vols -match 'vera_data')) {
    Info "Создаю volume vera_data ($VolumeSize GB, регион $Region)…"
    & fly volumes create vera_data --app $AppName --region $Region --size $VolumeSize --yes
    if ($LASTEXITCODE -ne 0) { Die "fly volumes create упал" }
    Ok "Volume создан"
  } else {
    Ok "Volume уже существует"
  }

  # 3. JWT_SECRET (только если ещё не задан)
  Info "Проверяю JWT_SECRET…"
  $secrets = & fly secrets list --app $AppName 2>$null
  if (-not ($secrets -match 'JWT_SECRET')) {
    $rand = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
    & fly secrets set "JWT_SECRET=$rand" --app $AppName | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "fly secrets set упал" }
    Ok "JWT_SECRET сгенерирован и сохранён"
  } else {
    Ok "JWT_SECRET уже установлен"
  }
}

# 4. Деплой
Info "Запускаю fly deploy…"
& fly deploy --app $AppName --ha=false
if ($LASTEXITCODE -ne 0) { Die "fly deploy упал — смотрите вывод выше" }

Ok "Деплой завершён"
Write-Host ""
Write-Host "🌐 https://$AppName.fly.dev" -ForegroundColor Yellow
Write-Host "   Логи:      fly logs --app $AppName"
Write-Host "   Статус:    fly status --app $AppName"
Write-Host "   Установщики: положите файлы в Server/public/downloads/ и повторите deploy.ps1 -SkipInit"
