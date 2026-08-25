# Deploy на Render Free (без карты)

Render.com даёт бесплатный Docker-хостинг и 1 GB persistent disk без карты.
Минус: контейнер засыпает после 15 минут без запросов. Решаем через
внешний пинг от UptimeRobot (тоже бесплатный, без карты) — сервер будет
жить 24/7.

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

1. https://render.com → Sign up (можно через GitHub, карту не просит).
2. New → **Blueprint**.
3. Connect GitHub → выбрать репо `vera-multi`.
4. Render найдёт `render.yaml`: 1 web service + disk 1 GB.
5. Apply. Первый билд 5–10 минут.

Публичный URL: `https://vera-multi.onrender.com`. `JWT_SECRET` Render
сгенерирует сам (см. `generateValue: true`).

## 3. UptimeRobot — чтобы не засыпал

1. https://uptimerobot.com → Register (free, без карты).
2. Add New Monitor:
   - Type: **HTTP(s)**
   - URL: `https://vera-multi.onrender.com/api/downloads`
   - Interval: **5 minutes**
3. Create.

Пинг каждые 5 минут не даст контейнеру уснуть.

## 4. Обновления

`git push` в main → Render сам пересобирает. Данные в `/data` переживают редеплой.

## 5. Установщики

Кладёшь `.exe/.dmg/.AppImage` в `Server/public/downloads/`, коммитишь, пушишь.
Крупные (>100 MB) — через GitHub Releases с внешним URL.

## Free-лимиты Render

- 1 GB диск, 512 MB RAM, 750 ч/мес (24/7 хватает), 100 GB трафика.
