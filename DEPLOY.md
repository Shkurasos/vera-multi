# Deploy на Render Free (без карты)

Render.com даёт бесплатный Docker-хостинг без карты. HTTPS-сертификат
Render выдаёт сам, что нужно нашим `Secure`-cookie (refresh + CSRF).
Минус Free: контейнер засыпает после 15 минут без запросов — решаем
внешним пингом от UptimeRobot (тоже бесплатный, без карты).

## 1. Залить проект на GitHub

Если репо ещё нет:
```powershell
cd "C:\Users\Ярослав\Desktop\Проеты\Vera_Multi"
git init
git add .
git commit -m "vera multi: initial deploy"
```
Создай пустой репозиторий на github.com (например `vera-multi`), затем:
```powershell
git remote add origin https://github.com/<твой-логин>/vera-multi.git
git branch -M main
git push -u origin main
```

## 2. Подключить репо к Render

1. https://render.com → Sign up через GitHub (карту не просит).
2. **New → Blueprint**.
3. Connect GitHub → выбрать репо `vera-multi`.
4. Render найдёт `render.yaml`: 1 web service.
5. Apply. Первый билд 5–10 минут.

Публичный URL: `https://vera-multi.onrender.com`. `JWT_SECRET` Render
сгенерирует сам (см. `generateValue: true` в `render.yaml`).

## 3. Крипто-кошелёк (NOWPayments)

В приложении есть внутренняя валюта **ВП** (1 руб = 2 ВП). Пополнение
идёт через шлюз NOWPayments: юзер платит криптой (USDT/TRC-20, BTC, TON,
и т.д.), NOWPayments шлёт нам IPN-webhook, сервер начисляет ВП.

Регистрировать свой ончейн-кошелёк вручную не нужно — NOWPayments сам
выдаёт адрес получателя под каждый инвойс. Тебе нужен только
**payout wallet** (куда шлюз выводит поступления) и API-ключи.

### 3.1. Аккаунт и API-ключ
1. https://nowpayments.io → Sign up (карту не просит).
2. Верифицировать email.
3. **Store settings → Payment settings → Outcome wallet**:
   добавь адрес своего криптокошелька, куда будут приходить выплаты.
   Минимум — USDT (TRC-20): достаточно установить Trust Wallet или
   любой TRC-20-адрес из Bybit/OKX. Можно добавить несколько монет.
4. **Store settings → API keys → Create API key** → скопируй ключ.
   Это `NOWPAYMENTS_API_KEY`.

### 3.2. IPN-секрет (подпись webhook'ов)
1. **Store settings → IPN Settings**.
2. IPN callback URL: `https://vera-multi.onrender.com/api/wallet/webhook`
3. Сгенерируй IPN Secret Key → скопируй. Это `NOWPAYMENTS_IPN_SECRET`.

Сервер проверяет подпись `x-nowpayments-sig` (HMAC-SHA512) — без
корректного секрета фейковые уведомления о «оплате» будут отбиваться 401.

### 3.3. Добавить ключи в Render
1. В Render → сервис `vera-multi` → **Environment**.
2. Найди `NOWPAYMENTS_API_KEY` и `NOWPAYMENTS_IPN_SECRET` (они помечены
   `sync: false`, т.е. Render показал их пустыми — вводи вручную).
3. Save Changes → Render передеплоит автоматически.

Пока ключи пустые, `/api/wallet/topup` работает в **mock-режиме** —
удобно для локальных тестов, но реальных денег не берёт.

### 3.4. Тест
1. Открой веб-приложение → Магазин → «Пополнить ВП».
2. Введи сумму (от 50 ВП = 25 ₽) → откроется инвойс NOWPayments.
3. Проверить: в NOWPayments **Sandbox** есть тестовый режим (отдельный
   API-хост `api-sandbox.nowpayments.io`) — для боевого тестирования
   лучше отправить минимальный USDT-платёж на реальный инвойс.

## 4. UptimeRobot — чтобы не засыпал

1. https://uptimerobot.com → Register (free, без карты).
2. Add New Monitor:
   - Type: **HTTP(s)**
   - URL: `https://vera-multi.onrender.com/api/downloads`
   - Interval: **5 minutes**
3. Create.

Пинг каждые 5 минут не даст контейнеру уснуть.

## 5. Обновления

`git push` в main → Render сам пересобирает. Данные в `/tmp/vera`
теряются при редеплое (Free-тариф без диска) — для продакшна нужен
Starter-план (7 $/мес) с persistent disk.

## 6. Установщики

Кладёшь `.exe/.dmg/.AppImage` в `Server/public/downloads/`, коммитишь,
пушишь. Крупные (>100 MB) — через GitHub Releases с внешним URL.

## Env-переменные (справочник)

| Переменная | Обяз. в prod | Что делает |
|---|---|---|
| `JWT_SECRET` | да | Подпись access-JWT. Render генерирует сам. |
| `NOWPAYMENTS_API_KEY` | нет | Реальные крипто-инвойсы. Без него — mock. |
| `NOWPAYMENTS_IPN_SECRET` | нет | Проверка подписи webhook'ов от NOWPayments. |
| `CORS_ORIGIN` | нет | CSV whitelist Origin. `RENDER_EXTERNAL_URL` добавляется автоматически. |
| `DATA_DIR` / `UPLOADS_DIR` / `DB_FILE` | нет | Пути хранения. На Free — `/tmp/vera`. |
| `PUBLIC_URL` | нет | Явный публичный URL (нужен для self-ping). |
| `KEEPALIVE_INTERVAL_MS` | нет | Период self-ping, по умолчанию 10 мин. |

## Free-лимиты Render

- 512 MB RAM, 750 ч/мес (24/7 хватает), 100 GB трафика.
- Без persistent disk: `vera.json` и `uploads/` живут только до
  редеплоя. Для стабильного хранения — Starter ($7/мес) + disk.

